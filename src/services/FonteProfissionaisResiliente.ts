import type { Profissional } from '../domain/entities/Profissional';
import type { FiltroCandidatos, ProfissionalRepository } from '../domain/ports/ProfissionalRepository';
import type { FonteProfissionais } from '../events/EventTypes';

// Valores escolhidos por nós. O timeout fica abaixo dos 2 s exigidos para a recomendação.
export const TIMEOUT_PADRAO_MS = 1500;
export const CAPACIDADE_CACHE_PADRAO = 20000;

export interface ResultadoBusca {
  profissionais: Profissional[];
  fonte: FonteProfissionais;
  erro?: string;
}

export interface OpcoesFonteResiliente {
  // Tempo máximo de espera pelo repositório antes do fallback.
  timeoutMs: number;
  // Nº máximo de profissionais mantidos no cache de fallback.
  capacidadeCache: number;
  aoFalhar?: (erro: unknown, operacao: string) => void;
}

// Tolerância a falhas do repositório de profissionais: timeout na consulta e, se falhar,
// usa o que foi lido da última vez (resultado parcial) ou devolve vazio. Nunca lança erro.
export class FonteProfissionaisResiliente {
  private readonly cache = new Map<string, Profissional>();
  private readonly opcoes: OpcoesFonteResiliente;

  constructor(
    private readonly repositorio: ProfissionalRepository,
    opcoes: Partial<OpcoesFonteResiliente> = {},
  ) {
    this.opcoes = { timeoutMs: TIMEOUT_PADRAO_MS, capacidadeCache: CAPACIDADE_CACHE_PADRAO, ...opcoes };
  }

  async buscarCandidatos(filtro: FiltroCandidatos): Promise<ResultadoBusca> {
    try {
      const profissionais = await this.comTimeout(this.repositorio.buscarCandidatos(filtro));
      this.memorizar(profissionais);
      return { profissionais, fonte: 'REPOSITORIO' };
    } catch (erro) {
      this.opcoes.aoFalhar?.(erro, 'buscarCandidatos');
      const doCache = [...this.cache.values()].filter(
        (p) =>
          filtro.papeis.some((papel) => p.atuaComo(papel)) &&
          p.disponivelEntre(filtro.disponivelDe, filtro.disponivelAte) &&
          (filtro.precoMinMaximo === undefined || p.precoMin <= filtro.precoMinMaximo),
      );
      return {
        profissionais: doCache,
        fonte: doCache.length > 0 ? 'CACHE' : 'INDISPONIVEL',
        erro: mensagem(erro),
      };
    }
  }

  async buscarPorIds(ids: readonly string[]): Promise<ResultadoBusca> {
    try {
      const profissionais = await this.comTimeout(this.repositorio.buscarPorIds(ids));
      this.memorizar(profissionais);
      return { profissionais, fonte: 'REPOSITORIO' };
    } catch (erro) {
      this.opcoes.aoFalhar?.(erro, 'buscarPorIds');
      const doCache = ids.map((id) => this.cache.get(id)).filter((p): p is Profissional => p !== undefined);
      return { profissionais: doCache, fonte: doCache.length > 0 ? 'CACHE' : 'INDISPONIVEL', erro: mensagem(erro) };
    }
  }

  private memorizar(profissionais: readonly Profissional[]): void {
    for (const p of profissionais) {
      this.cache.delete(p.id);
      this.cache.set(p.id, p);
    }
    // Map preserva ordem de inserção: remove os mais antigos (LRU simples).
    while (this.cache.size > this.opcoes.capacidadeCache) {
      const maisAntigo = this.cache.keys().next().value as string;
      this.cache.delete(maisAntigo);
    }
  }

  private comTimeout<T>(promessa: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const limite = new Promise<never>((_, rejeitar) => {
      timer = setTimeout(
        () => rejeitar(new Error(`Repositório de profissionais excedeu ${this.opcoes.timeoutMs}ms`)),
        this.opcoes.timeoutMs,
      );
    });
    return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
  }
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

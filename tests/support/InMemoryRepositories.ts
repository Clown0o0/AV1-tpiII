import type { Convite } from '../../src/domain/entities/Convite';
import type { Profissional } from '../../src/domain/entities/Profissional';
import type { Projeto } from '../../src/domain/entities/Projeto';
import type { Recomendacao } from '../../src/domain/entities/Recomendacao';
import type { FiltroCandidatos, ProfissionalRepository } from '../../src/domain/ports/ProfissionalRepository';
import type { ProjetoRepository } from '../../src/domain/ports/ProjetoRepository';

/** Substitui o banco nos testes. `indisponivel = true` simula queda do repositório. */
export class InMemoryProfissionalRepository implements ProfissionalRepository {
  indisponivel = false;
  atrasoMs = 0;
  consultas = 0;

  constructor(public profissionais: Profissional[] = []) {}

  async buscarCandidatos(filtro: FiltroCandidatos): Promise<Profissional[]> {
    await this.simularInfra();
    return this.profissionais.filter(
      (p) =>
        filtro.papeis.some((papel) => p.atuaComo(papel)) &&
        p.disponivelEntre(filtro.disponivelDe, filtro.disponivelAte) &&
        (filtro.precoMinMaximo === undefined || p.precoMin <= filtro.precoMinMaximo),
    );
  }

  async buscarPorIds(ids: readonly string[]): Promise<Profissional[]> {
    await this.simularInfra();
    return this.profissionais.filter((p) => ids.includes(p.id));
  }

  private async simularInfra(): Promise<void> {
    this.consultas += 1;
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    if (this.indisponivel) throw new Error('conexão recusada');
  }
}

export class InMemoryProjetoRepository implements ProjetoRepository {
  readonly projetos = new Map<string, Projeto>();
  readonly recomendacoes = new Map<string, Recomendacao>();
  readonly convites = new Map<string, Convite>();
  falharComErroGenerico = false;

  async salvar(projeto: Projeto): Promise<void> {
    this.verificar();
    this.projetos.set(projeto.id, projeto);
  }

  async buscarPorId(id: string): Promise<Projeto | null> {
    this.verificar();
    return this.projetos.get(id) ?? null;
  }

  async salvarRecomendacao(recomendacao: Recomendacao): Promise<void> {
    this.recomendacoes.set(recomendacao.id, recomendacao);
  }

  async buscarRecomendacao(id: string): Promise<Recomendacao | null> {
    return this.recomendacoes.get(id) ?? null;
  }

  async buscarRecomendacaoVigente(projetoId: string): Promise<Recomendacao | null> {
    const candidatas = [...this.recomendacoes.values()].filter((r) => r.projetoId === projetoId && r.status !== 'OBSOLETA');
    return candidatas.at(-1) ?? null;
  }

  async salvarConvite(convite: Convite): Promise<void> {
    this.convites.set(convite.id, convite);
  }

  async buscarConvite(id: string): Promise<Convite | null> {
    return this.convites.get(id) ?? null;
  }

  async listarConvites(recomendacaoId: string): Promise<Convite[]> {
    return [...this.convites.values()].filter((c) => c.recomendacaoId === recomendacaoId);
  }

  private verificar(): void {
    if (this.falharComErroGenerico) throw new Error('falha inesperada no banco');
  }
}

/** Logger que apenas acumula as linhas (evita ruído no output dos testes). */
export class LoggerMemoria {
  readonly linhas: Array<{ objeto: Record<string, unknown>; mensagem: string }> = [];
  info(objeto: Record<string, unknown>, mensagem: string): void {
    this.linhas.push({ objeto, mensagem });
  }
}

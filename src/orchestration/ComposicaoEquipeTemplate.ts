import type { Profissional } from '../domain/entities/Profissional';
import type { PapelTecnico, Projeto, TipoEstrategia } from '../domain/entities/Projeto';
import type { VetorCompetencias } from '../domain/entities/Competencia';
import type { CandidatoPontuado, RecomendacaoStrategy } from '../strategies/RecomendacaoStrategy';

// Membro já definido que deve permanecer fixo durante a rodada (ex.: numa substituição).
export interface MembroFixo {
  papel: PapelTecnico;
  profissionalId: string;
  custo: number;
}

export interface EntradaComposicao {
  projeto: Projeto;
  profissionais: readonly Profissional[];
  estrategia: RecomendacaoStrategy;
  // Início da janela de trabalho (normalmente "agora").
  dataReferencia: Date;
  // Papéis a (re)compor. Padrão: todos os papéis do projeto.
  papeisAlvo?: readonly PapelTecnico[];
  membrosFixos?: readonly MembroFixo[];
  // Profissionais que não podem ser sugeridos para um papel (ex.: já rejeitados).
  excluidosPorPapel?: ReadonlyMap<PapelTecnico, ReadonlySet<string>>;
}

export interface PapelNormalizado {
  papel: PapelTecnico;
  pesoOriginal: number;
  // Peso normalizado entre os papéis alvo (somam 1).
  peso: number;
  perfilDesejado: VetorCompetencias;
  orcamentoPapel: number;
  candidatos: Profissional[];
}

export interface EntradaNormalizada {
  projeto: Projeto;
  estrategia: RecomendacaoStrategy;
  dataReferencia: Date;
  orcamentoDisponivel: number;
  papeis: PapelNormalizado[];
  universo: Profissional[];
  avisos: string[];
}

export interface RankingPapel {
  papel: PapelNormalizado;
  ranking: CandidatoPontuado[];
}

export interface SelecaoPapel {
  papel: PapelTecnico;
  escolhido: CandidatoPontuado;
  custo: number;
  alternativas: Array<{ candidato: CandidatoPontuado; custo: number }>;
}

export interface ResultadoComposicao {
  estrategia: TipoEstrategia;
  selecionados: SelecaoPapel[];
  papeisSemCandidato: PapelTecnico[];
  custoTotal: number;
  orcamentoDisponivel: number;
  parcial: boolean;
  avisos: string[];
}

// Template Method. O fluxo é sempre validar -> normalizar -> aplicar estratégia -> pós-processar;
// as subclasses só implementam as etapas. compor() não pode ser sobrescrito (o construtor barra).
export abstract class ComposicaoEquipeTemplate {
  protected constructor() {
    if (this.compor !== ComposicaoEquipeTemplate.prototype.compor) {
      throw new TypeError(`${new.target.name} não pode sobrescrever o fluxo compor() do ComposicaoEquipeTemplate`);
    }
  }

  compor(entrada: EntradaComposicao): ResultadoComposicao {
    this.validarRestricoesOrcamentarias(entrada);
    const normalizada = this.normalizarEntrada(entrada);
    const rankings = this.aplicarEstrategia(normalizada);
    return this.posProcessar(rankings, normalizada);
  }

  protected abstract validarRestricoesOrcamentarias(entrada: EntradaComposicao): void;
  protected abstract normalizarEntrada(entrada: EntradaComposicao): EntradaNormalizada;
  protected abstract aplicarEstrategia(entrada: EntradaNormalizada): RankingPapel[];
  protected abstract posProcessar(rankings: RankingPapel[], entrada: EntradaNormalizada): ResultadoComposicao;
}

Object.defineProperty(ComposicaoEquipeTemplate.prototype, 'compor', { writable: false, configurable: false });

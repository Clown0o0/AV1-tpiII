import { randomUUID } from 'node:crypto';
import { ErroValidacao } from '../errors';
import { Competencia, type VetorCompetencias } from './Competencia';
import type { Visitante } from './Visitante';

export const PAPEIS_TECNICOS = [
  'DIRETOR',
  'DIRETOR_FOTOGRAFIA',
  'SONOPLASTA',
  'EDITOR',
  'ROTEIRISTA',
  'EFEITOS_VISUAIS',
] as const;
export type PapelTecnico = (typeof PAPEIS_TECNICOS)[number];

export const TIPOS_CAPTACAO = ['DOCUMENTARIO', 'FICCAO', 'ANIMACAO'] as const;
export type TipoCaptacao = (typeof TIPOS_CAPTACAO)[number];

export const TIPOS_ESTRATEGIA = ['COSSENO', 'FILTRAGEM_COLABORATIVA', 'ORCAMENTO_REDUZIDO'] as const;
export type TipoEstrategia = (typeof TIPOS_ESTRATEGIA)[number];

// Perfil usado quando o produtor não diz o que espera do papel. Nomes e níveis foram escolhidos
// por nós (o enunciado não define); dá para sobrescrever com `competenciasDesejadas`.
export const PERFIL_PADRAO_POR_PAPEL: Readonly<Record<PapelTecnico, VetorCompetencias>> = {
  DIRETOR: { direcao: 1, narrativa: 0.8, lideranca: 0.9 },
  DIRETOR_FOTOGRAFIA: { fotografia: 1, iluminacao: 0.9, camera: 0.8 },
  SONOPLASTA: { captacao_som: 1, mixagem: 0.8, trilha: 0.5 },
  EDITOR: { edicao: 1, ritmo: 0.8, color_grading: 0.5 },
  ROTEIRISTA: { roteiro: 1, narrativa: 0.9, pesquisa: 0.6 },
  EFEITOS_VISUAIS: { vfx: 1, composicao: 0.9, animacao_3d: 0.7 },
};

export interface PapelRequerido {
  papel: PapelTecnico;
  // Peso de importância relativa do papel (> 0).
  peso: number;
  competenciasDesejadas?: VetorCompetencias;
}

export interface DadosProjeto {
  id?: string;
  titulo: string;
  produtorId: string;
  produtorEmail?: string | null;
  genero: string;
  duracaoEstimadaMin: number;
  orcamentoTotal: number;
  dataEntrega: Date;
  tipoCaptacao: TipoCaptacao;
  localizacao: string;
  papeis: PapelRequerido[];
  estrategia?: TipoEstrategia;
  criadoEm?: Date;
}

export interface AlteracoesProjeto {
  orcamentoTotal?: number;
  dataEntrega?: Date;
  estrategia?: TipoEstrategia;
}

export interface ResultadoAlteracao {
  // Variação relativa do orçamento (0.1 = 10%).
  variacaoOrcamento: number;
  // Diferença absoluta, em dias, da data de entrega.
  variacaoPrazoDias: number;
  estrategiaAlterada: boolean;
}

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export class Projeto {
  readonly id: string;
  readonly titulo: string;
  readonly produtorId: string;
  readonly produtorEmail: string | null;
  readonly genero: string;
  readonly duracaoEstimadaMin: number;
  readonly tipoCaptacao: TipoCaptacao;
  readonly localizacao: string;
  readonly papeis: readonly PapelRequerido[];
  readonly criadoEm: Date;
  private _orcamentoTotal: number;
  private _dataEntrega: Date;
  private _estrategia: TipoEstrategia;

  constructor(dados: DadosProjeto) {
    Projeto.validar(dados);
    this.id = dados.id ?? randomUUID();
    this.titulo = dados.titulo.trim();
    this.produtorId = dados.produtorId;
    this.produtorEmail = dados.produtorEmail ?? null;
    this.genero = dados.genero.trim().toLowerCase();
    this.duracaoEstimadaMin = dados.duracaoEstimadaMin;
    this.tipoCaptacao = dados.tipoCaptacao;
    this.localizacao = dados.localizacao.trim();
    this.papeis = dados.papeis.map((p) => ({
      papel: p.papel,
      peso: p.peso,
      ...(p.competenciasDesejadas ? { competenciasDesejadas: Competencia.normalizarVetor(p.competenciasDesejadas) } : {}),
    }));
    this.criadoEm = dados.criadoEm ?? new Date();
    this._orcamentoTotal = dados.orcamentoTotal;
    this._dataEntrega = dados.dataEntrega;
    this._estrategia = dados.estrategia ?? 'COSSENO';
  }

  get orcamentoTotal(): number {
    return this._orcamentoTotal;
  }

  get dataEntrega(): Date {
    return this._dataEntrega;
  }

  get estrategia(): TipoEstrategia {
    return this._estrategia;
  }

  papelRequerido(papel: PapelTecnico): PapelRequerido {
    const encontrado = this.papeis.find((p) => p.papel === papel);
    if (!encontrado) throw new ErroValidacao(`Papel ${papel} não é requerido pelo projeto`);
    return encontrado;
  }

  // Perfil de competências esperado para o papel (definido pelo produtor ou padrão).
  perfilDesejado(papel: PapelTecnico): VetorCompetencias {
    return this.papelRequerido(papel).competenciasDesejadas ?? PERFIL_PADRAO_POR_PAPEL[papel];
  }

  alterar(alteracoes: AlteracoesProjeto): ResultadoAlteracao {
    const orcamentoAnterior = this._orcamentoTotal;
    const entregaAnterior = this._dataEntrega;
    const estrategiaAnterior = this._estrategia;
    if (alteracoes.orcamentoTotal !== undefined) {
      Projeto.validarOrcamento(alteracoes.orcamentoTotal);
      this._orcamentoTotal = alteracoes.orcamentoTotal;
    }
    if (alteracoes.dataEntrega !== undefined) {
      Projeto.validarData(alteracoes.dataEntrega);
      this._dataEntrega = alteracoes.dataEntrega;
    }
    if (alteracoes.estrategia !== undefined) this._estrategia = alteracoes.estrategia;

    return {
      variacaoOrcamento: Math.abs(this._orcamentoTotal - orcamentoAnterior) / orcamentoAnterior,
      variacaoPrazoDias: Math.abs(this._dataEntrega.getTime() - entregaAnterior.getTime()) / MS_POR_DIA,
      estrategiaAlterada: this._estrategia !== estrategiaAnterior,
    };
  }

  aceitar(visitante: Visitante): void {
    visitante.visitarProjeto(this);
  }

  private static validar(dados: DadosProjeto): void {
    if (!dados.titulo?.trim()) throw new ErroValidacao('Título do projeto é obrigatório');
    if (!dados.produtorId?.trim()) throw new ErroValidacao('Produtor do projeto é obrigatório');
    if (!dados.genero?.trim()) throw new ErroValidacao('Gênero da obra é obrigatório');
    if (!dados.localizacao?.trim()) throw new ErroValidacao('Localização do projeto é obrigatória');
    if (!Number.isFinite(dados.duracaoEstimadaMin) || dados.duracaoEstimadaMin <= 0) {
      throw new ErroValidacao('Duração estimada deve ser positiva');
    }
    if (!TIPOS_CAPTACAO.includes(dados.tipoCaptacao)) {
      throw new ErroValidacao(`Tipo de captação inválido: ${String(dados.tipoCaptacao)}`);
    }
    if (dados.estrategia !== undefined && !TIPOS_ESTRATEGIA.includes(dados.estrategia)) {
      throw new ErroValidacao(`Estratégia inválida: ${String(dados.estrategia)}`);
    }
    Projeto.validarOrcamento(dados.orcamentoTotal);
    Projeto.validarData(dados.dataEntrega);
    if (!dados.papeis?.length) throw new ErroValidacao('O projeto deve exigir ao menos um papel técnico');
    const vistos = new Set<PapelTecnico>();
    for (const papel of dados.papeis) {
      if (!PAPEIS_TECNICOS.includes(papel.papel)) throw new ErroValidacao(`Papel técnico inválido: ${String(papel.papel)}`);
      if (vistos.has(papel.papel)) throw new ErroValidacao(`Papel ${papel.papel} informado mais de uma vez`);
      if (!Number.isFinite(papel.peso) || papel.peso <= 0) throw new ErroValidacao(`Peso do papel ${papel.papel} deve ser positivo`);
      vistos.add(papel.papel);
    }
  }

  private static validarOrcamento(orcamento: number): void {
    if (!Number.isFinite(orcamento) || orcamento <= 0) throw new ErroValidacao('Orçamento total deve ser positivo');
  }

  private static validarData(data: Date): void {
    if (!(data instanceof Date) || Number.isNaN(data.getTime())) throw new ErroValidacao('Data de entrega inválida');
  }
}

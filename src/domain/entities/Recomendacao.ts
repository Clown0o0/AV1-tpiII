import { randomUUID } from 'node:crypto';
import { ErroEstadoInvalido, ErroValidacao } from '../errors';
import type { PapelTecnico, TipoEstrategia } from './Projeto';
import type { Visitante } from './Visitante';

export const STATUS_MEMBRO = ['SUGERIDO', 'CONVIDADO', 'CONFIRMADO', 'REJEITADO', 'RECUSADO', 'SUBSTITUIDO'] as const;
export type StatusMembro = (typeof STATUS_MEMBRO)[number];

export const STATUS_RECOMENDACAO = ['EM_ANDAMENTO', 'FINALIZADA', 'OBSOLETA'] as const;
export type StatusRecomendacao = (typeof STATUS_RECOMENDACAO)[number];

const STATUS_INATIVOS: ReadonlySet<StatusMembro> = new Set<StatusMembro>(['REJEITADO', 'RECUSADO', 'SUBSTITUIDO']);

export interface Alternativa {
  profissionalId: string;
  score: number;
  custo: number;
}

export interface DadosMembro {
  id?: string;
  papel: PapelTecnico;
  profissionalId: string;
  score: number;
  custo: number;
  status?: StatusMembro;
  rodada: number;
  alternativas?: Alternativa[];
}

export class MembroRecomendado {
  readonly id: string;
  readonly papel: PapelTecnico;
  readonly profissionalId: string;
  readonly score: number;
  readonly custo: number;
  readonly rodada: number;
  readonly alternativas: readonly Alternativa[];
  private _status: StatusMembro;

  constructor(dados: DadosMembro) {
    this.id = dados.id ?? randomUUID();
    this.papel = dados.papel;
    this.profissionalId = dados.profissionalId;
    this.score = dados.score;
    this.custo = dados.custo;
    this.rodada = dados.rodada;
    this.alternativas = [...(dados.alternativas ?? [])];
    this._status = dados.status ?? 'SUGERIDO';
  }

  get status(): StatusMembro {
    return this._status;
  }

  get ativo(): boolean {
    return !STATUS_INATIVOS.has(this._status);
  }

  transicionar(de: readonly StatusMembro[], para: StatusMembro): void {
    if (!de.includes(this._status)) {
      throw new ErroEstadoInvalido(`Membro do papel ${this.papel} está ${this._status}; não pode passar para ${para}`);
    }
    this._status = para;
  }

  aceitar(visitante: Visitante): void {
    visitante.visitarMembro(this);
  }
}

export interface DadosRecomendacao {
  id?: string;
  projetoId: string;
  estrategia: TipoEstrategia;
  status?: StatusRecomendacao;
  parcial?: boolean;
  avisos?: string[];
  rodadas?: number;
  membros?: MembroRecomendado[];
  criadaEm?: Date;
  finalizadaEm?: Date | null;
}

// Equipe recomendada para um projeto, incluindo o histórico de rodadas por papel.
export class Recomendacao {
  readonly id: string;
  readonly projetoId: string;
  readonly estrategia: TipoEstrategia;
  readonly criadaEm: Date;
  private _status: StatusRecomendacao;
  private _parcial: boolean;
  private _avisos: string[];
  private _rodadas: number;
  private _finalizadaEm: Date | null;
  private readonly _membros: MembroRecomendado[];

  constructor(dados: DadosRecomendacao) {
    this.id = dados.id ?? randomUUID();
    this.projetoId = dados.projetoId;
    this.estrategia = dados.estrategia;
    this.criadaEm = dados.criadaEm ?? new Date();
    this._status = dados.status ?? 'EM_ANDAMENTO';
    this._parcial = dados.parcial ?? false;
    this._avisos = [...(dados.avisos ?? [])];
    this._rodadas = dados.rodadas ?? 1;
    this._finalizadaEm = dados.finalizadaEm ?? null;
    this._membros = [...(dados.membros ?? [])];
  }

  get status(): StatusRecomendacao {
    return this._status;
  }
  get parcial(): boolean {
    return this._parcial;
  }
  get avisos(): readonly string[] {
    return this._avisos;
  }
  get rodadas(): number {
    return this._rodadas;
  }
  get finalizadaEm(): Date | null {
    return this._finalizadaEm;
  }
  get membros(): readonly MembroRecomendado[] {
    return this._membros;
  }

  membrosAtivos(): MembroRecomendado[] {
    return this._membros.filter((m) => m.ativo);
  }

  membroAtivo(papel: PapelTecnico): MembroRecomendado | undefined {
    return this._membros.find((m) => m.papel === papel && m.ativo);
  }

  custoTotal(): number {
    return this.membrosAtivos().reduce((soma, m) => soma + m.custo, 0);
  }

  // Profissionais já sugeridos para o papel em qualquer rodada.
  profissionaisJaSugeridos(papel: PapelTecnico): Set<string> {
    return new Set(this._membros.filter((m) => m.papel === papel).map((m) => m.profissionalId));
  }

  iniciarNovaRodada(): number {
    this.garantirEmAndamento();
    this._rodadas += 1;
    return this._rodadas;
  }

  adicionarMembro(membro: MembroRecomendado): void {
    this.garantirEmAndamento();
    if (this.membroAtivo(membro.papel)) {
      throw new ErroEstadoInvalido(`Papel ${membro.papel} já possui membro ativo`);
    }
    this._membros.push(membro);
  }

  registrarResultadoRodada(parcial: boolean, avisos: readonly string[]): void {
    this._parcial = parcial;
    this._avisos = [...avisos];
  }

  convidar(papel: PapelTecnico): MembroRecomendado {
    return this.transicionar(papel, ['SUGERIDO'], 'CONVIDADO');
  }

  rejeitar(papel: PapelTecnico): MembroRecomendado {
    return this.transicionar(papel, ['SUGERIDO', 'CONVIDADO'], 'REJEITADO');
  }

  substituir(papel: PapelTecnico): MembroRecomendado | undefined {
    if (!this.membroAtivo(papel)) {
      this.garantirEmAndamento();
      return undefined;
    }
    return this.transicionar(papel, ['SUGERIDO', 'CONVIDADO', 'CONFIRMADO'], 'SUBSTITUIDO');
  }

  confirmar(papel: PapelTecnico): MembroRecomendado {
    return this.transicionar(papel, ['CONVIDADO'], 'CONFIRMADO');
  }

  recusar(papel: PapelTecnico): MembroRecomendado {
    return this.transicionar(papel, ['CONVIDADO'], 'RECUSADO');
  }

  // Consenso: todos os papéis exigidos possuem um membro confirmado pelo profissional.
  equipeConsensual(papeisExigidos: readonly PapelTecnico[]): boolean {
    return papeisExigidos.every((papel) => this.membroAtivo(papel)?.status === 'CONFIRMADO');
  }

  finalizar(agora: Date): void {
    this.garantirEmAndamento();
    this._status = 'FINALIZADA';
    this._finalizadaEm = agora;
  }

  tornarObsoleta(): void {
    this.garantirEmAndamento();
    this._status = 'OBSOLETA';
  }

  aceitar(visitante: Visitante): void {
    visitante.visitarRecomendacao(this);
    for (const membro of this.membrosAtivos()) membro.aceitar(visitante);
  }

  private transicionar(papel: PapelTecnico, de: readonly StatusMembro[], para: StatusMembro): MembroRecomendado {
    this.garantirEmAndamento();
    const membro = this.membroAtivo(papel);
    if (!membro) throw new ErroValidacao(`Não há membro ativo para o papel ${papel}`);
    membro.transicionar(de, para);
    return membro;
  }

  private garantirEmAndamento(): void {
    if (this._status !== 'EM_ANDAMENTO') {
      throw new ErroEstadoInvalido(`Recomendação ${this.id} está ${this._status} e não aceita alterações`);
    }
  }
}

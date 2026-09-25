import { randomUUID } from 'node:crypto';
import { ErroEstadoInvalido } from '../errors';
import type { PapelTecnico } from './Projeto';

export const STATUS_CONVITE = ['PENDENTE', 'ACEITO', 'RECUSADO', 'CANCELADO'] as const;
export type StatusConvite = (typeof STATUS_CONVITE)[number];

export interface DadosConvite {
  id?: string;
  recomendacaoId: string;
  projetoId: string;
  profissionalId: string;
  papel: PapelTecnico;
  status?: StatusConvite;
  criadoEm?: Date;
  respondidoEm?: Date | null;
}

export class Convite {
  readonly id: string;
  readonly recomendacaoId: string;
  readonly projetoId: string;
  readonly profissionalId: string;
  readonly papel: PapelTecnico;
  readonly criadoEm: Date;
  private _status: StatusConvite;
  private _respondidoEm: Date | null;

  constructor(dados: DadosConvite) {
    this.id = dados.id ?? randomUUID();
    this.recomendacaoId = dados.recomendacaoId;
    this.projetoId = dados.projetoId;
    this.profissionalId = dados.profissionalId;
    this.papel = dados.papel;
    this.criadoEm = dados.criadoEm ?? new Date();
    this._status = dados.status ?? 'PENDENTE';
    this._respondidoEm = dados.respondidoEm ?? null;
  }

  get status(): StatusConvite {
    return this._status;
  }

  get respondidoEm(): Date | null {
    return this._respondidoEm;
  }

  get pendente(): boolean {
    return this._status === 'PENDENTE';
  }

  responder(aceito: boolean, agora: Date): void {
    this.garantirPendente();
    this._status = aceito ? 'ACEITO' : 'RECUSADO';
    this._respondidoEm = agora;
  }

  cancelar(agora: Date): void {
    this.garantirPendente();
    this._status = 'CANCELADO';
    this._respondidoEm = agora;
  }

  private garantirPendente(): void {
    if (!this.pendente) throw new ErroEstadoInvalido(`Convite ${this.id} já está ${this._status}`);
  }
}

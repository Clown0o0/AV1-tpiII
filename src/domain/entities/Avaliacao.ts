import { randomUUID } from 'node:crypto';
import { ErroValidacao } from '../errors';

export interface DadosAvaliacao {
  id?: string;
  profissionalId: string;
  // Produtor que avaliou o profissional.
  autorId: string;
  projetoId?: string | null;
  nota: number;
  comentario?: string | null;
  criadaEm?: Date;
}

export class Avaliacao {
  static readonly NOTA_MINIMA = 1;
  static readonly NOTA_MAXIMA = 5;

  readonly id: string;
  readonly profissionalId: string;
  readonly autorId: string;
  readonly projetoId: string | null;
  readonly nota: number;
  readonly comentario: string | null;
  readonly criadaEm: Date;

  constructor(dados: DadosAvaliacao) {
    if (!Number.isInteger(dados.nota) || dados.nota < Avaliacao.NOTA_MINIMA || dados.nota > Avaliacao.NOTA_MAXIMA) {
      throw new ErroValidacao(`Nota de avaliação deve ser um inteiro entre ${Avaliacao.NOTA_MINIMA} e ${Avaliacao.NOTA_MAXIMA}`);
    }
    this.id = dados.id ?? randomUUID();
    this.profissionalId = dados.profissionalId;
    this.autorId = dados.autorId;
    this.projetoId = dados.projetoId ?? null;
    this.nota = dados.nota;
    this.comentario = dados.comentario ?? null;
    this.criadaEm = dados.criadaEm ?? new Date();
  }
}

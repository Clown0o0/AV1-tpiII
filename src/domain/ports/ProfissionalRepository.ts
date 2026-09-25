import type { PapelTecnico } from '../entities/Projeto';
import type { Profissional } from '../entities/Profissional';

export interface FiltroCandidatos {
  // Retorna profissionais que atuam em pelo menos um destes papéis.
  papeis: readonly PapelTecnico[];
  // Janela que o profissional precisa ter disponível por inteiro.
  disponivelDe: Date;
  disponivelAte: Date;
  // Descarta profissionais cujo preço mínimo excede este valor.
  precoMinMaximo?: number;
}

export interface ProfissionalRepository {
  buscarCandidatos(filtro: FiltroCandidatos): Promise<Profissional[]>;
  buscarPorIds(ids: readonly string[]): Promise<Profissional[]>;
}

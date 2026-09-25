import type { Convite } from '../entities/Convite';
import type { Projeto } from '../entities/Projeto';
import type { Recomendacao } from '../entities/Recomendacao';

// Projeto é a raiz: recomendações e convites são salvos pelo mesmo repositório.
export interface ProjetoRepository {
  salvar(projeto: Projeto): Promise<void>;
  buscarPorId(id: string): Promise<Projeto | null>;

  salvarRecomendacao(recomendacao: Recomendacao): Promise<void>;
  buscarRecomendacao(id: string): Promise<Recomendacao | null>;
  // Recomendação mais recente do projeto que não esteja obsoleta.
  buscarRecomendacaoVigente(projetoId: string): Promise<Recomendacao | null>;

  salvarConvite(convite: Convite): Promise<void>;
  buscarConvite(id: string): Promise<Convite | null>;
  listarConvites(recomendacaoId: string): Promise<Convite[]>;
}

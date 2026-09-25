import type { Projeto } from './Projeto';
import type { Profissional } from './Profissional';
import type { MembroRecomendado, Recomendacao } from './Recomendacao';

// O domínio só conhece esta interface: as entidades têm aceitar(visitante) e a lógica
// de cada operação fica em src/visitors.
export interface Visitante {
  visitarProjeto(projeto: Projeto): void;
  visitarRecomendacao(recomendacao: Recomendacao): void;
  visitarMembro(membro: MembroRecomendado): void;
  visitarProfissional(profissional: Profissional): void;
}

import { similaridadeCosseno } from '../domain/entities/Competencia';
import type { Profissional } from '../domain/entities/Profissional';
import {
  arredondar,
  ordenarRanking,
  type CandidatoPontuado,
  type ContextoEstrategia,
  type RecomendacaoStrategy,
} from './RecomendacaoStrategy';

// Ranqueia pela similaridade de cosseno entre o perfil desejado do papel e o vetor de competências.
export class CossenoStrategy implements RecomendacaoStrategy {
  readonly tipo = 'COSSENO' as const;
  readonly descricao = 'Similaridade de cosseno entre o perfil desejado do papel e o vetor de competências do profissional';

  ranquear(candidatos: readonly Profissional[], contexto: ContextoEstrategia): CandidatoPontuado[] {
    return ordenarRanking(
      candidatos.map((profissional) => {
        const similaridade = similaridadeCosseno(contexto.perfilDesejado, profissional.vetorCompetencias());
        return { profissional, score: arredondar(similaridade), detalhes: { similaridade: arredondar(similaridade) } };
      }),
    );
  }
}

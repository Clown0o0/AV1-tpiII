import type { Profissional } from '../domain/entities/Profissional';
import type { PapelTecnico, Projeto, TipoEstrategia } from '../domain/entities/Projeto';
import type { VetorCompetencias } from '../domain/entities/Competencia';

// Informações que a estratégia recebe para ranquear os candidatos de um papel.
export interface ContextoEstrategia {
  projeto: Projeto;
  papel: PapelTecnico;
  // Perfil de competências desejado para o papel.
  perfilDesejado: VetorCompetencias;
  // Parcela do orçamento disponível destinada a este papel (proporcional ao peso).
  orcamentoPapel: number;
  // Todos os profissionais carregados na rodada (usado, p.ex., pela filtragem colaborativa).
  universo: readonly Profissional[];
}

export interface CandidatoPontuado {
  profissional: Profissional;
  // Pontuação normalizada em [0, 1]; maior é melhor.
  score: number;
  detalhes: Readonly<Record<string, number>>;
}

// Strategy: recebe os candidatos de um papel e devolve o ranking (maior score primeiro).
// Pode descartar quem não passar nas regras dela.
export interface RecomendacaoStrategy {
  readonly tipo: TipoEstrategia;
  readonly descricao: string;
  ranquear(candidatos: readonly Profissional[], contexto: ContextoEstrategia): CandidatoPontuado[];
}

// Ordenação determinística: score desc, preço mínimo asc, id asc.
export function ordenarRanking(candidatos: CandidatoPontuado[]): CandidatoPontuado[] {
  return candidatos.sort(
    (a, b) =>
      b.score - a.score ||
      a.profissional.precoMin - b.profissional.precoMin ||
      a.profissional.id.localeCompare(b.profissional.id),
  );
}

export function arredondar(valor: number, casas = 4): number {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

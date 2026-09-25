import { Avaliacao } from '../domain/entities/Avaliacao';
import type { Profissional } from '../domain/entities/Profissional';
import {
  arredondar,
  ordenarRanking,
  type CandidatoPontuado,
  type ContextoEstrategia,
  type RecomendacaoStrategy,
} from './RecomendacaoStrategy';

// Parâmetros escolhidos por nós (o enunciado não fixa a técnica de filtragem colaborativa).
export const PESO_PRIOR_BAYESIANO = 2; // quantas "notas virtuais" com a média geral cada profissional recebe
export const NOTA_NEUTRA = 3; // meio da escala 1..5

type NotasPorProdutor = Map<string, Map<string, number>>; // produtor -> (profissional -> nota média)

// Estima a nota que o produtor do projeto daria a cada candidato, com base nas notas de
// produtores de gosto parecido. Sem vizinhos, cai numa média suavizada do próprio candidato.
export class FiltragemColaborativaStrategy implements RecomendacaoStrategy {
  readonly tipo = 'FILTRAGEM_COLABORATIVA' as const;
  readonly descricao = 'Filtragem colaborativa usando o histórico de avaliações de produtores';

  ranquear(candidatos: readonly Profissional[], contexto: ContextoEstrategia): CandidatoPontuado[] {
    const notas = agruparNotas(contexto.universo);
    const mediaGeral = calcularMediaGeral(contexto.universo);
    const produtor = contexto.projeto.produtorId;
    const minhasNotas = notas.get(produtor);

    const vizinhos: Array<[notasDoVizinho: Map<string, number>, similaridade: number]> = [];
    for (const [outro, notasDoOutro] of notas) {
      if (outro === produtor) continue;
      const s = similaridade(minhasNotas, notasDoOutro);
      if (s > 0) vizinhos.push([notasDoOutro, s]);
    }

    const ranking = candidatos.map((profissional) => {
      let somaPonderada = 0;
      let somaPesos = 0;
      for (const [notasDoVizinho, s] of vizinhos) {
        const nota = notasDoVizinho.get(profissional.id);
        if (nota === undefined) continue;
        somaPonderada += s * nota;
        somaPesos += s;
      }

      const previsao =
        minhasNotas?.get(profissional.id) ??
        (somaPesos > 0 ? somaPonderada / somaPesos : mediaBayesiana(profissional, mediaGeral));

      return {
        profissional,
        score: arredondar(previsao / Avaliacao.NOTA_MAXIMA),
        detalhes: { notaPrevista: arredondar(previsao), pesoVizinhos: arredondar(somaPesos) },
      };
    });
    return ordenarRanking(ranking);
  }
}

function agruparNotas(profissionais: readonly Profissional[]): NotasPorProdutor {
  const acumulado = new Map<string, Map<string, number[]>>();
  for (const profissional of profissionais) {
    for (const { autorId, nota } of profissional.avaliacoes) {
      if (!acumulado.has(autorId)) acumulado.set(autorId, new Map());
      const doAutor = acumulado.get(autorId)!;
      doAutor.set(profissional.id, [...(doAutor.get(profissional.id) ?? []), nota]);
    }
  }

  const notas: NotasPorProdutor = new Map();
  for (const [autor, porProfissional] of acumulado) {
    const medias = new Map<string, number>();
    for (const [id, lista] of porProfissional) medias.set(id, lista.reduce((a, b) => a + b, 0) / lista.length);
    notas.set(autor, medias);
  }
  return notas;
}

function calcularMediaGeral(profissionais: readonly Profissional[]): number {
  const todas = profissionais.flatMap((p) => p.avaliacoes.map((a) => a.nota));
  if (todas.length === 0) return NOTA_NEUTRA;
  return todas.reduce((a, b) => a + b, 0) / todas.length;
}

// Cosseno entre dois produtores, só sobre quem os dois avaliaram. As notas são centralizadas
// no meio da escala, assim gostos opostos dão similaridade negativa.
function similaridade(a: Map<string, number> | undefined, b: Map<string, number>): number {
  if (!a) return 0;
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (const [id, notaA] of a) {
    const notaB = b.get(id);
    if (notaB === undefined) continue;
    const x = notaA - NOTA_NEUTRA;
    const y = notaB - NOTA_NEUTRA;
    produto += x * y;
    normaA += x * x;
    normaB += y * y;
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / Math.sqrt(normaA * normaB);
}

function mediaBayesiana(profissional: Profissional, mediaGeral: number): number {
  const soma = profissional.avaliacoes.reduce((acc, a) => acc + a.nota, 0);
  return (PESO_PRIOR_BAYESIANO * mediaGeral + soma) / (PESO_PRIOR_BAYESIANO + profissional.avaliacoes.length);
}

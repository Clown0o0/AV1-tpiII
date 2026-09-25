import { ErroValidacao } from '../domain/errors';
import type { PapelTecnico } from '../domain/entities/Projeto';
import type { CandidatoPontuado } from '../strategies/RecomendacaoStrategy';
import {
  ComposicaoEquipeTemplate,
  type EntradaComposicao,
  type EntradaNormalizada,
  type PapelNormalizado,
  type RankingPapel,
  type ResultadoComposicao,
  type SelecaoPapel,
} from './ComposicaoEquipeTemplate';

export const LIMITE_ALTERNATIVAS_PADRAO = 3; // escolha nossa, configurável

export interface OpcoesComposicao {
  limiteAlternativas: number;
}

// Etapas padrão da composição. Regras que decidimos (o enunciado não define):
//  - o custo de um profissional é o preço mínimo da faixa dele;
//  - o candidato precisa estar disponível de hoje até a entrega;
//  - escolha gulosa pelo peso do papel, guardando orçamento para os que faltam.
export class ComposicaoEquipeDefault extends ComposicaoEquipeTemplate {
  private readonly opcoes: OpcoesComposicao;

  constructor(opcoes: Partial<OpcoesComposicao> = {}) {
    super();
    this.opcoes = { limiteAlternativas: LIMITE_ALTERNATIVAS_PADRAO, ...opcoes };
  }

  protected validarRestricoesOrcamentarias(entrada: EntradaComposicao): void {
    const { projeto } = entrada;
    if (projeto.dataEntrega.getTime() <= entrada.dataReferencia.getTime()) {
      throw new ErroValidacao('A data de entrega do projeto já passou; não há prazo para compor a equipe');
    }
    const custoFixo = (entrada.membrosFixos ?? []).reduce((soma, m) => soma + m.custo, 0);
    if (custoFixo > projeto.orcamentoTotal) {
      throw new ErroValidacao(
        `Custo dos membros já definidos (${custoFixo}) excede o orçamento total (${projeto.orcamentoTotal})`,
      );
    }
    const requeridos = new Set(projeto.papeis.map((p) => p.papel));
    for (const papel of entrada.papeisAlvo ?? []) {
      if (!requeridos.has(papel)) throw new ErroValidacao(`Papel ${papel} não é requerido pelo projeto`);
    }
  }

  protected normalizarEntrada(entrada: EntradaComposicao): EntradaNormalizada {
    const { projeto } = entrada;
    const fixos = entrada.membrosFixos ?? [];
    const idsFixos = new Set(fixos.map((m) => m.profissionalId));
    const orcamentoDisponivel = projeto.orcamentoTotal - fixos.reduce((soma, m) => soma + m.custo, 0);

    const universo = [...new Map(entrada.profissionais.map((p) => [p.id, p])).values()];
    const alvo = new Set<PapelTecnico>(entrada.papeisAlvo ?? projeto.papeis.map((p) => p.papel));
    const requeridos = projeto.papeis.filter((p) => alvo.has(p.papel));
    const somaPesos = requeridos.reduce((soma, p) => soma + p.peso, 0);

    const papeis: PapelNormalizado[] = requeridos.map((requerido) => {
      const peso = requerido.peso / somaPesos;
      const excluidos = entrada.excluidosPorPapel?.get(requerido.papel);
      const candidatos = universo.filter(
        (p) =>
          p.atuaComo(requerido.papel) &&
          !idsFixos.has(p.id) &&
          !excluidos?.has(p.id) &&
          p.precoMin <= orcamentoDisponivel &&
          p.disponivelEntre(entrada.dataReferencia, projeto.dataEntrega),
      );
      return {
        papel: requerido.papel,
        pesoOriginal: requerido.peso,
        peso,
        perfilDesejado: projeto.perfilDesejado(requerido.papel),
        orcamentoPapel: orcamentoDisponivel * peso,
        candidatos,
      };
    });

    return {
      projeto,
      estrategia: entrada.estrategia,
      dataReferencia: entrada.dataReferencia,
      orcamentoDisponivel,
      papeis,
      universo,
      avisos: [],
    };
  }

  protected aplicarEstrategia(entrada: EntradaNormalizada): RankingPapel[] {
    return entrada.papeis.map((papel) => ({
      papel,
      ranking: entrada.estrategia.ranquear(papel.candidatos, {
        projeto: entrada.projeto,
        papel: papel.papel,
        perfilDesejado: papel.perfilDesejado,
        orcamentoPapel: papel.orcamentoPapel,
        universo: entrada.universo,
      }),
    }));
  }

  protected posProcessar(rankings: RankingPapel[], entrada: EntradaNormalizada): ResultadoComposicao {
    const avisos = [...entrada.avisos];
    const usados = new Set<string>();
    const selecoes = new Map<PapelTecnico, SelecaoPapel>();
    const papeisSemCandidato: PapelTecnico[] = [];
    let restante = entrada.orcamentoDisponivel;

    // Papéis mais importantes escolhem primeiro.
    const ordem = [...rankings].sort((a, b) => b.papel.peso - a.papel.peso);
    for (let i = 0; i < ordem.length; i++) {
      const { papel, ranking } = ordem[i]!;
      const livres = ranking.filter((c) => !usados.has(c.profissional.id));

      // Guarda dinheiro para os papéis que ainda faltam (o mais barato de cada um).
      let reserva = 0;
      for (const proximo of ordem.slice(i + 1)) reserva += menorPreco(proximo.ranking, usados);

      let escolhido = livres.find((c) => c.profissional.precoMin <= restante - reserva);
      if (!escolhido) {
        escolhido = livres.find((c) => c.profissional.precoMin <= restante);
        if (escolhido) avisos.push(`Papel ${papel.papel}: escolha consome orçamento reservado para outros papéis`);
      }

      if (!escolhido) {
        papeisSemCandidato.push(papel.papel);
        avisos.push(
          ranking.length === 0
            ? `Papel ${papel.papel}: nenhum profissional elegível (especialidade, disponibilidade ou orçamento)`
            : `Papel ${papel.papel}: nenhum candidato cabe no orçamento restante (${restante})`,
        );
        continue;
      }

      usados.add(escolhido.profissional.id);
      restante -= escolhido.profissional.precoMin;
      const alternativas = livres
        .filter((c) => c !== escolhido)
        .slice(0, this.opcoes.limiteAlternativas)
        .map((candidato) => ({ candidato, custo: candidato.profissional.precoMin }));
      selecoes.set(papel.papel, { papel: papel.papel, escolhido, custo: escolhido.profissional.precoMin, alternativas });
    }

    // submarino
    // Devolve na ordem de papéis que o produtor informou.
    const selecionados = rankings.flatMap((r) => selecoes.get(r.papel.papel) ?? []);
    return {
      estrategia: entrada.estrategia.tipo,
      selecionados,
      papeisSemCandidato,
      custoTotal: selecionados.reduce((soma, s) => soma + s.custo, 0),
      orcamentoDisponivel: entrada.orcamentoDisponivel,
      parcial: papeisSemCandidato.length > 0,
      avisos,
    };
  }
}

function menorPreco(ranking: readonly CandidatoPontuado[], usados: ReadonlySet<string>): number {
  const menor = ranking
    .filter((c) => !usados.has(c.profissional.id))
    .reduce((min, c) => Math.min(min, c.profissional.precoMin), Infinity);
  return menor === Infinity ? 0 : menor;
}

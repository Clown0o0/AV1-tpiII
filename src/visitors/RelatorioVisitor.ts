import type { Profissional } from '../domain/entities/Profissional';
import type { PapelTecnico, Projeto } from '../domain/entities/Projeto';
import type { MembroRecomendado, Recomendacao, StatusMembro } from '../domain/entities/Recomendacao';
import type { ProjetoVisitor } from './ProjetoVisitor';

export interface LinhaEquipe {
  papel: PapelTecnico;
  profissionalId: string;
  nome: string;
  status: StatusMembro;
  score: number;
  custo: number;
  mediaAvaliacoes: number | null;
  localizacao: string;
}

export interface Relatorio {
  projeto: {
    id: string;
    titulo: string;
    genero: string;
    tipoCaptacao: string;
    localizacao: string;
    duracaoEstimadaMin: number;
    dataEntrega: string;
  };
  recomendacao: { id: string; estrategia: string; status: string; parcial: boolean; rodadas: number; avisos: string[] };
  equipe: LinhaEquipe[];
  papeisEmAberto: PapelTecnico[];
  financeiro: { orcamentoTotal: number; custoEquipe: number; saldo: number; percentualUtilizado: number };
  texto: string;
}

// Gera o relatório completo da equipe para o produtor (estruturado + texto legível).
export class RelatorioVisitor implements ProjetoVisitor<Relatorio> {
  private projeto?: Projeto;
  private recomendacao?: Recomendacao;
  private readonly membros: MembroRecomendado[] = [];
  private readonly profissionais = new Map<string, Profissional>();

  visitarProjeto(projeto: Projeto): void {
    this.projeto = projeto;
  }

  visitarRecomendacao(recomendacao: Recomendacao): void {
    this.recomendacao = recomendacao;
  }

  visitarMembro(membro: MembroRecomendado): void {
    this.membros.push(membro);
  }

  visitarProfissional(profissional: Profissional): void {
    this.profissionais.set(profissional.id, profissional);
  }

  resultado(): Relatorio {
    const projeto = this.projeto;
    const recomendacao = this.recomendacao;
    if (!projeto || !recomendacao) throw new Error('Visitor não percorreu projeto e recomendação');

    const equipe: LinhaEquipe[] = this.membros.map((m) => {
      const profissional = this.profissionais.get(m.profissionalId);
      return {
        papel: m.papel,
        profissionalId: m.profissionalId,
        nome: profissional?.nome ?? '(profissional indisponível)',
        status: m.status,
        score: m.score,
        custo: m.custo,
        mediaAvaliacoes: profissional?.mediaAvaliacoes() ?? null,
        localizacao: profissional?.localizacao ?? '-',
      };
    });
    const preenchidos = new Set(equipe.map((l) => l.papel));
    const papeisEmAberto = projeto.papeis.map((p) => p.papel).filter((p) => !preenchidos.has(p));
    const custoEquipe = equipe.reduce((soma, l) => soma + l.custo, 0);
    const financeiro = {
      orcamentoTotal: projeto.orcamentoTotal,
      custoEquipe,
      saldo: projeto.orcamentoTotal - custoEquipe,
      percentualUtilizado: Math.round((custoEquipe / projeto.orcamentoTotal) * 10000) / 100,
    };

    const linhas = [
      `Relatório da equipe — ${projeto.titulo}`,
      `Gênero: ${projeto.genero} | Captação: ${projeto.tipoCaptacao} | Local: ${projeto.localizacao}`,
      `Entrega: ${projeto.dataEntrega.toISOString().slice(0, 10)} | Duração estimada: ${projeto.duracaoEstimadaMin} min`,
      `Estratégia: ${recomendacao.estrategia} | Status: ${recomendacao.status} | Rodadas: ${recomendacao.rodadas}`,
      '',
      'Equipe:',
      ...equipe.map(
        (l) => `  - ${l.papel}: ${l.nome} [${l.status}] score=${l.score.toFixed(2)} custo=${l.custo.toFixed(2)}`,
      ),
      ...papeisEmAberto.map((p) => `  - ${p}: (em aberto)`),
      '',
      `Orçamento: ${financeiro.orcamentoTotal.toFixed(2)} | Custo da equipe: ${custoEquipe.toFixed(2)} ` +
        `(${financeiro.percentualUtilizado}%) | Saldo: ${financeiro.saldo.toFixed(2)}`,
      ...recomendacao.avisos.map((a) => `Aviso: ${a}`),
    ];

    return {
      projeto: {
        id: projeto.id,
        titulo: projeto.titulo,
        genero: projeto.genero,
        tipoCaptacao: projeto.tipoCaptacao,
        localizacao: projeto.localizacao,
        duracaoEstimadaMin: projeto.duracaoEstimadaMin,
        dataEntrega: projeto.dataEntrega.toISOString(),
      },
      recomendacao: {
        id: recomendacao.id,
        estrategia: recomendacao.estrategia,
        status: recomendacao.status,
        parcial: recomendacao.parcial,
        rodadas: recomendacao.rodadas,
        avisos: [...recomendacao.avisos],
      },
      equipe,
      papeisEmAberto,
      financeiro,
      texto: linhas.join('\n'),
    };
  }
}

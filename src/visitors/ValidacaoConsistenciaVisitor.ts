import type { Profissional } from '../domain/entities/Profissional';
import type { Projeto } from '../domain/entities/Projeto';
import type { MembroRecomendado, Recomendacao } from '../domain/entities/Recomendacao';
import type { ProjetoVisitor } from './ProjetoVisitor';

export interface ResultadoValidacao {
  valida: boolean;
  erros: string[];
  custoTotal: number;
  orcamentoTotal: number;
  papeisPreenchidos: number;
  papeisRequeridos: number;
}

// Verifica papéis obrigatórios preenchidos, orçamento suficiente e coerência de cada membro.
export class ValidacaoConsistenciaVisitor implements ProjetoVisitor<ResultadoValidacao> {
  private projeto?: Projeto;
  private readonly erros: string[] = [];
  private readonly membrosPorProfissional = new Map<string, MembroRecomendado>();
  private readonly profissionaisVisitados = new Set<string>();
  private custoTotal = 0;

  // @param dataReferencia início da janela em que os membros precisam estar disponíveis.
  constructor(private readonly dataReferencia: Date = new Date()) {}

  visitarProjeto(projeto: Projeto): void {
    this.projeto = projeto;
  }

  visitarRecomendacao(recomendacao: Recomendacao): void {
    if (recomendacao.status === 'OBSOLETA') this.erros.push('Recomendação obsoleta (substituída por uma reavaliação)');
  }

  visitarMembro(membro: MembroRecomendado): void {
    if (this.membrosPorProfissional.has(membro.profissionalId)) {
      this.erros.push(`Profissional ${membro.profissionalId} alocado em mais de um papel`);
    }
    this.membrosPorProfissional.set(membro.profissionalId, membro);
    this.custoTotal += membro.custo;
  }

  visitarProfissional(profissional: Profissional): void {
    this.profissionaisVisitados.add(profissional.id);
    const membro = this.membrosPorProfissional.get(profissional.id);
    if (!membro) return;
    if (!profissional.atuaComo(membro.papel)) {
      this.erros.push(`${profissional.nome} não possui especialidade ${membro.papel}`);
    }
    if (membro.custo < profissional.precoMin || membro.custo > profissional.precoMax) {
      this.erros.push(`Custo de ${profissional.nome} (${membro.custo}) fora da faixa de preço`);
    }
    const entrega = this.projeto?.dataEntrega;
    if (entrega && entrega > this.dataReferencia && !profissional.disponivelEntre(this.dataReferencia, entrega)) {
      this.erros.push(`${profissional.nome} não está disponível até a data de entrega`);
    }
  }

  resultado(): ResultadoValidacao {
    const projeto = this.exigirProjeto();
    const erros = [...this.erros];
    const papeisPreenchidos = new Set([...this.membrosPorProfissional.values()].map((m) => m.papel));
    for (const { papel } of projeto.papeis) {
      if (!papeisPreenchidos.has(papel)) erros.push(`Papel obrigatório ${papel} não preenchido`);
    }
    for (const [profissionalId, membro] of this.membrosPorProfissional) {
      if (!this.profissionaisVisitados.has(profissionalId)) {
        erros.push(`Profissional ${profissionalId} (${membro.papel}) não encontrado`);
      }
    }
    if (this.custoTotal > projeto.orcamentoTotal) {
      erros.push(`Orçamento insuficiente: equipe custa ${this.custoTotal}, orçamento é ${projeto.orcamentoTotal}`);
    }
    return {
      valida: erros.length === 0,
      erros,
      custoTotal: this.custoTotal,
      orcamentoTotal: projeto.orcamentoTotal,
      papeisPreenchidos: papeisPreenchidos.size,
      papeisRequeridos: projeto.papeis.length,
    };
  }

  private exigirProjeto(): Projeto {
    if (!this.projeto) throw new Error('Visitor não percorreu nenhum projeto');
    return this.projeto;
  }
}

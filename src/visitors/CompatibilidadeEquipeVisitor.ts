import { Avaliacao } from '../domain/entities/Avaliacao';
import { similaridadeCosseno } from '../domain/entities/Competencia';
import type { Profissional } from '../domain/entities/Profissional';
import type { PapelTecnico, Projeto } from '../domain/entities/Projeto';
import type { MembroRecomendado, Recomendacao } from '../domain/entities/Recomendacao';
import { arredondar } from '../strategies/RecomendacaoStrategy';
import type { ProjetoVisitor } from './ProjetoVisitor';

export interface CompatibilidadePapel {
  papel: PapelTecnico;
  profissionalId: string;
  competencias: number;
  reputacao: number;
  localizacao: number;
  compatibilidade: number;
}

export interface ResultadoCompatibilidade {
  // Média ponderada pelos pesos dos papéis; papéis vazios contam como 0.
  indiceGeral: number;
  // Fração dos papéis requeridos com membro ativo.
  cobertura: number;
  porPapel: CompatibilidadePapel[];
}

export interface PesosCompatibilidade {
  competencias: number;
  reputacao: number;
  localizacao: number;
  // Reputação (0..1) assumida para profissionais sem avaliações.
  reputacaoSemAvaliacao: number;
}

// Pesos escolhidos por nós (o enunciado não define a fórmula); podem ser trocados no construtor.
export const PESOS_COMPATIBILIDADE: PesosCompatibilidade = {
  competencias: 0.6,
  reputacao: 0.25,
  localizacao: 0.15,
  reputacaoSemAvaliacao: 0.5,
};

// Calcula uma métrica de compatibilidade geral da equipe com o projeto.
export class CompatibilidadeEquipeVisitor implements ProjetoVisitor<ResultadoCompatibilidade> {
  private projeto?: Projeto;
  private readonly membrosPorProfissional = new Map<string, MembroRecomendado>();
  private readonly porPapel: CompatibilidadePapel[] = [];

  constructor(private readonly pesos: PesosCompatibilidade = PESOS_COMPATIBILIDADE) {}

  visitarProjeto(projeto: Projeto): void {
    this.projeto = projeto;
  }

  visitarRecomendacao(_recomendacao: Recomendacao): void {
    // A compatibilidade depende apenas dos membros e profissionais.
  }

  visitarMembro(membro: MembroRecomendado): void {
    this.membrosPorProfissional.set(membro.profissionalId, membro);
  }

  visitarProfissional(profissional: Profissional): void {
    const membro = this.membrosPorProfissional.get(profissional.id);
    if (!membro || !this.projeto) return;
    const competencias = similaridadeCosseno(this.projeto.perfilDesejado(membro.papel), profissional.vetorCompetencias());
    const media = profissional.mediaAvaliacoes();
    const reputacao = media === null ? this.pesos.reputacaoSemAvaliacao : media / Avaliacao.NOTA_MAXIMA;
    const localizacao = profissional.mesmaLocalizacao(this.projeto.localizacao) ? 1 : 0;
    this.porPapel.push({
      papel: membro.papel,
      profissionalId: profissional.id,
      competencias: arredondar(competencias),
      reputacao: arredondar(reputacao),
      localizacao,
      compatibilidade: arredondar(
        this.pesos.competencias * competencias + this.pesos.reputacao * reputacao + this.pesos.localizacao * localizacao,
      ),
    });
  }

  resultado(): ResultadoCompatibilidade {
    if (!this.projeto) throw new Error('Visitor não percorreu nenhum projeto');
    const somaPesos = this.projeto.papeis.reduce((soma, p) => soma + p.peso, 0);
    const indice = this.projeto.papeis.reduce((soma, requerido) => {
      const item = this.porPapel.find((p) => p.papel === requerido.papel);
      return soma + requerido.peso * (item?.compatibilidade ?? 0);
    }, 0);
    return {
      indiceGeral: arredondar(indice / somaPesos),
      cobertura: arredondar(this.porPapel.length / this.projeto.papeis.length),
      porPapel: [...this.porPapel],
    };
  }
}

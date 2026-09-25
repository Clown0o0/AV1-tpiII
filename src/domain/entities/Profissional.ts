import { randomUUID } from 'node:crypto';
import { ErroValidacao } from '../errors';
import { Avaliacao } from './Avaliacao';
import { Competencia, type VetorCompetencias } from './Competencia';
import type { PapelTecnico } from './Projeto';
import type { Visitante } from './Visitante';

export interface Disponibilidade {
  inicio: Date;
  fim: Date;
}

export interface DadosProfissional {
  id?: string;
  nome: string;
  email: string;
  especialidades: PapelTecnico[];
  precoMin: number;
  precoMax: number;
  localizacao: string;
  disponibilidade: Disponibilidade[];
  competencias: Competencia[];
  historicoProjetos?: string[];
  avaliacoes?: Avaliacao[];
}

export class Profissional {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly especialidades: readonly PapelTecnico[];
  readonly precoMin: number;
  readonly precoMax: number;
  readonly localizacao: string;
  readonly disponibilidade: readonly Disponibilidade[];
  readonly competencias: readonly Competencia[];
  readonly historicoProjetos: readonly string[];
  readonly avaliacoes: readonly Avaliacao[];
  private readonly vetor: VetorCompetencias;

  constructor(dados: DadosProfissional) {
    if (!dados.nome?.trim()) throw new ErroValidacao('Nome do profissional é obrigatório');
    if (!dados.especialidades?.length) throw new ErroValidacao(`Profissional ${dados.nome} sem especialidades`);
    if (!(dados.precoMin >= 0) || !(dados.precoMax >= dados.precoMin)) {
      throw new ErroValidacao(`Faixa de preço inválida para ${dados.nome}`);
    }
    this.id = dados.id ?? randomUUID();
    this.nome = dados.nome.trim();
    this.email = dados.email;
    this.especialidades = [...dados.especialidades];
    this.precoMin = dados.precoMin;
    this.precoMax = dados.precoMax;
    this.localizacao = dados.localizacao.trim();
    this.disponibilidade = dados.disponibilidade.map((d) => ({ inicio: d.inicio, fim: d.fim }));
    this.competencias = [...dados.competencias];
    this.historicoProjetos = [...(dados.historicoProjetos ?? [])];
    this.avaliacoes = [...(dados.avaliacoes ?? [])];
    this.vetor = Object.freeze(Object.fromEntries(this.competencias.map((c) => [c.nome, c.nivel])));
  }

  atuaComo(papel: PapelTecnico): boolean {
    return this.especialidades.includes(papel);
  }

  // Disponível se alguma janela de disponibilidade cobre todo o intervalo pedido.
  disponivelEntre(inicio: Date, fim: Date): boolean {
    const i = inicio.getTime();
    const f = fim.getTime();
    return this.disponibilidade.some((d) => d.inicio.getTime() <= i && d.fim.getTime() >= f);
  }

  vetorCompetencias(): VetorCompetencias {
    return this.vetor;
  }

  // Média das notas recebidas, ou null quando não há avaliações.
  mediaAvaliacoes(): number | null {
    if (this.avaliacoes.length === 0) return null;
    return this.avaliacoes.reduce((soma, a) => soma + a.nota, 0) / this.avaliacoes.length;
  }

  mesmaLocalizacao(localizacao: string): boolean {
    return this.localizacao.localeCompare(localizacao.trim(), 'pt-BR', { sensitivity: 'base' }) === 0;
  }

  aceitar(visitante: Visitante): void {
    visitante.visitarProfissional(this);
  }
}

import type { Convite } from '../domain/entities/Convite';
import type { PapelTecnico, Projeto, ResultadoAlteracao } from '../domain/entities/Projeto';
import type { Profissional } from '../domain/entities/Profissional';
import type { Recomendacao } from '../domain/entities/Recomendacao';

export const EVENTOS = {
  RECOMENDACAO_GERADA: 'recomendacao.gerada',
  MEMBRO_REJEITADO: 'membro.rejeitado',
  MEMBRO_SUBSTITUIDO: 'membro.substituido',
  INTERESSE_PRODUTOR: 'convite.interesse-produtor',
  CONVITE_ACEITO: 'convite.aceito',
  CONVITE_RECUSADO: 'convite.recusado',
  PROJETO_ALTERADO: 'projeto.alterado',
  EQUIPE_FINALIZADA: 'equipe.finalizada',
  INTEGRACAO_GERENCIAMENTO_PROJETOS: 'integracao.gerenciamento-projetos.iniciar',
  INTEGRACAO_FINANCEIRO: 'integracao.financeiro.iniciar',
} as const;

export type NomeEvento = (typeof EVENTOS)[keyof typeof EVENTOS];

// Quem executou a ação (para auditoria).
export interface Ator {
  tipo: 'PRODUTOR' | 'PROFISSIONAL' | 'SISTEMA';
  id: string;
}

export interface EventoBase {
  ator: Ator;
  ocorridoEm: Date;
  projetoId: string;
}

export interface RecomendacaoGerada extends EventoBase {
  projeto: Projeto;
  recomendacao: Recomendacao;
  motivo: 'INICIAL' | 'REAVALIACAO';
  // Origem dos profissionais: repositório, cache de fallback ou indisponível.
  fonteProfissionais: FonteProfissionais;
}

export interface MembroRejeitado extends EventoBase {
  recomendacaoId: string;
  papel: PapelTecnico;
  profissionalId: string;
}

export interface MembroSubstituido extends EventoBase {
  projeto: Projeto;
  recomendacao: Recomendacao;
  papel: PapelTecnico;
  anteriorId: string | null;
  novoId: string | null;
}

export interface EventoConvite extends EventoBase {
  projeto: Projeto;
  convite: Convite;
  profissional: Profissional | null;
}

export interface ProjetoAlterado extends EventoBase {
  projeto: Projeto;
  alteracao: ResultadoAlteracao;
  reavaliada: boolean;
}

export interface EquipeFinalizada extends EventoBase {
  projeto: Projeto;
  recomendacao: Recomendacao;
}

export interface IniciarGerenciamentoProjetos extends EventoBase {
  recomendacaoId: string;
  dataEntrega: Date;
  equipe: Array<{ papel: PapelTecnico; profissionalId: string }>;
}

export interface IniciarFinanceiro extends EventoBase {
  recomendacaoId: string;
  orcamentoTotal: number;
  custoEquipe: number;
  pagamentos: Array<{ profissionalId: string; papel: PapelTecnico; valor: number }>;
}

export type FonteProfissionais = 'REPOSITORIO' | 'CACHE' | 'INDISPONIVEL';

export interface MapaEventos {
  [EVENTOS.RECOMENDACAO_GERADA]: RecomendacaoGerada;
  [EVENTOS.MEMBRO_REJEITADO]: MembroRejeitado;
  [EVENTOS.MEMBRO_SUBSTITUIDO]: MembroSubstituido;
  [EVENTOS.INTERESSE_PRODUTOR]: EventoConvite;
  [EVENTOS.CONVITE_ACEITO]: EventoConvite;
  [EVENTOS.CONVITE_RECUSADO]: EventoConvite;
  [EVENTOS.PROJETO_ALTERADO]: ProjetoAlterado;
  [EVENTOS.EQUIPE_FINALIZADA]: EquipeFinalizada;
  [EVENTOS.INTEGRACAO_GERENCIAMENTO_PROJETOS]: IniciarGerenciamentoProjetos;
  [EVENTOS.INTEGRACAO_FINANCEIRO]: IniciarFinanceiro;
}

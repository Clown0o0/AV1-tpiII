import type { FastifyInstance } from 'fastify';
import type { Convite } from '../domain/entities/Convite';
import {
  PAPEIS_TECNICOS,
  TIPOS_CAPTACAO,
  TIPOS_ESTRATEGIA,
  type PapelTecnico,
  type Projeto,
  type TipoCaptacao,
  type TipoEstrategia,
} from '../domain/entities/Projeto';
import type { MembroRecomendado, Recomendacao } from '../domain/entities/Recomendacao';
import type { RecomendacaoService } from '../services/RecomendacaoService';

interface CorpoProjeto {
  titulo: string;
  produtorId: string;
  produtorEmail?: string;
  genero: string;
  duracaoEstimadaMin: number;
  orcamentoTotal: number;
  dataEntrega: string;
  tipoCaptacao: TipoCaptacao;
  localizacao: string;
  estrategia?: TipoEstrategia;
  papeis: Array<{ papel: PapelTecnico; peso: number; competenciasDesejadas?: Record<string, number> }>;
}

interface CorpoAlteracao {
  orcamentoTotal?: number;
  dataEntrega?: string;
  estrategia?: TipoEstrategia;
  forcarReavaliacao?: boolean;
}

const schemaProjeto = {
  type: 'object',
  required: [
    'titulo',
    'produtorId',
    'genero',
    'duracaoEstimadaMin',
    'orcamentoTotal',
    'dataEntrega',
    'tipoCaptacao',
    'localizacao',
    'papeis',
  ],
  properties: {
    titulo: { type: 'string', minLength: 1 },
    produtorId: { type: 'string', minLength: 1 },
    produtorEmail: { type: 'string' },
    genero: { type: 'string', minLength: 1 },
    duracaoEstimadaMin: { type: 'number', exclusiveMinimum: 0 },
    orcamentoTotal: { type: 'number', exclusiveMinimum: 0 },
    dataEntrega: { type: 'string', minLength: 10 },
    tipoCaptacao: { type: 'string', enum: [...TIPOS_CAPTACAO] },
    localizacao: { type: 'string', minLength: 1 },
    estrategia: { type: 'string', enum: [...TIPOS_ESTRATEGIA] },
    papeis: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['papel', 'peso'],
        properties: {
          papel: { type: 'string', enum: [...PAPEIS_TECNICOS] },
          peso: { type: 'number', exclusiveMinimum: 0 },
          competenciasDesejadas: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
        },
      },
    },
  },
} as const;

const schemaIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const schemaMembroParams = {
  type: 'object',
  required: ['id', 'papel'],
  properties: { id: { type: 'string', minLength: 1 }, papel: { type: 'string', enum: [...PAPEIS_TECNICOS] } },
} as const;

export interface OpcoesRotas {
  service: RecomendacaoService;
}

// Rotas e requisitos:
//   RF1  POST  /projetos/recomendar
//   RF3  PATCH /projetos/:id
//   RF2  POST  /recomendacoes/:id/membros/:papel/aceitar     (gera o convite do RF4)
//   RF2  POST  /recomendacoes/:id/membros/:papel/rejeitar
//   RF2  POST  /recomendacoes/:id/membros/:papel/substituir
//   RF4  POST  /convites/:id/responder                       (fecha a equipe no RF5)
// Auxiliares, só para consultar o que os requisitos acima geram:
//   GET /recomendacoes/:id            estado da equipe e dos convites
//   GET /recomendacoes/:id/relatorio  resultado dos visitors
export async function recomendacaoRoutes(app: FastifyInstance, { service }: OpcoesRotas): Promise<void> {
  app.post<{ Body: CorpoProjeto }>('/projetos/recomendar', { schema: { body: schemaProjeto } }, async (request, reply) => {
    const corpo = request.body;
    const { projeto, recomendacao, fonteProfissionais } = await service.recomendar({
      ...corpo,
      dataEntrega: new Date(corpo.dataEntrega),
    });
    request.log.info({ acao: 'recomendar', ator: projeto.produtorId, projetoId: projeto.id }, 'recomendação solicitada');
    return reply.code(201).send({
      projeto: projetoJson(projeto),
      recomendacao: recomendacaoJson(recomendacao),
      fonteProfissionais,
    });
  });

  app.patch<{ Params: { id: string }; Body: CorpoAlteracao }>(
    '/projetos/:id',
    {
      schema: {
        params: schemaIdParams,
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            orcamentoTotal: { type: 'number', exclusiveMinimum: 0 },
            dataEntrega: { type: 'string', minLength: 10 },
            estrategia: { type: 'string', enum: [...TIPOS_ESTRATEGIA] },
            forcarReavaliacao: { type: 'boolean' },
          },
        },
      },
    },
    async (request) => {
      const { dataEntrega, ...resto } = request.body;
      const resultado = await service.alterarProjeto(request.params.id, {
        ...resto,
        ...(dataEntrega !== undefined ? { dataEntrega: new Date(dataEntrega) } : {}),
      });
      return {
        projeto: projetoJson(resultado.projeto),
        alteracao: resultado.alteracao,
        reavaliada: resultado.reavaliada,
        recomendacao: resultado.recomendacao ? recomendacaoJson(resultado.recomendacao) : null,
      };
    },
  );

  app.get<{ Params: { id: string } }>('/recomendacoes/:id', { schema: { params: schemaIdParams } }, async (request) => {
    const { recomendacao, convites } = await service.obterRecomendacao(request.params.id);
    return { ...recomendacaoJson(recomendacao), convites: convites.map(conviteJson) };
  });

  app.get<{ Params: { id: string } }>(
    '/recomendacoes/:id/relatorio',
    { schema: { params: schemaIdParams } },
    async (request) => service.gerarRelatorio(request.params.id),
  );

  app.post<{ Params: { id: string; papel: PapelTecnico } }>(
    '/recomendacoes/:id/membros/:papel/aceitar',
    { schema: { params: schemaMembroParams } },
    async (request, reply) => {
      const { recomendacao, convite } = await service.aceitarMembro(request.params.id, request.params.papel);
      return reply.code(201).send({ recomendacao: recomendacaoJson(recomendacao), convite: conviteJson(convite) });
    },
  );

  app.post<{ Params: { id: string; papel: PapelTecnico } }>(
    '/recomendacoes/:id/membros/:papel/rejeitar',
    { schema: { params: schemaMembroParams } },
    async (request) => recomendacaoJson(await service.rejeitarMembro(request.params.id, request.params.papel)),
  );

  app.post<{ Params: { id: string; papel: PapelTecnico }; Body: { estrategia?: TipoEstrategia } | undefined }>(
    '/recomendacoes/:id/membros/:papel/substituir',
    {
      schema: {
        params: schemaMembroParams,
        body: {
          type: ['object', 'null'],
          properties: { estrategia: { type: 'string', enum: [...TIPOS_ESTRATEGIA] } },
        },
      },
    },
    async (request) => {
      const { recomendacao, novoMembro } = await service.substituirMembro(
        request.params.id,
        request.params.papel,
        request.body?.estrategia,
      );
      return { recomendacao: recomendacaoJson(recomendacao), novoMembro: novoMembro ? membroJson(novoMembro) : null };
    },
  );

  app.post<{ Params: { id: string }; Body: { aceito: boolean } }>(
    '/convites/:id/responder',
    {
      schema: {
        params: schemaIdParams,
        body: { type: 'object', required: ['aceito'], properties: { aceito: { type: 'boolean' } } },
      },
    },
    async (request) => {
      const { convite, recomendacao, equipeFinalizada } = await service.responderConvite(
        request.params.id,
        request.body.aceito,
      );
      return { convite: conviteJson(convite), recomendacao: recomendacaoJson(recomendacao), equipeFinalizada };
    },
  );
}

export function projetoJson(projeto: Projeto) {
  return {
    id: projeto.id,
    titulo: projeto.titulo,
    produtorId: projeto.produtorId,
    produtorEmail: projeto.produtorEmail,
    genero: projeto.genero,
    duracaoEstimadaMin: projeto.duracaoEstimadaMin,
    orcamentoTotal: projeto.orcamentoTotal,
    dataEntrega: projeto.dataEntrega.toISOString(),
    tipoCaptacao: projeto.tipoCaptacao,
    localizacao: projeto.localizacao,
    estrategia: projeto.estrategia,
    papeis: projeto.papeis,
  };
}

export function membroJson(membro: MembroRecomendado) {
  return {
    id: membro.id,
    papel: membro.papel,
    profissionalId: membro.profissionalId,
    score: membro.score,
    custo: membro.custo,
    status: membro.status,
    rodada: membro.rodada,
    alternativas: membro.alternativas,
  };
}

export function recomendacaoJson(recomendacao: Recomendacao) {
  return {
    id: recomendacao.id,
    projetoId: recomendacao.projetoId,
    estrategia: recomendacao.estrategia,
    status: recomendacao.status,
    parcial: recomendacao.parcial,
    avisos: recomendacao.avisos,
    rodadas: recomendacao.rodadas,
    custoTotal: recomendacao.custoTotal(),
    criadaEm: recomendacao.criadaEm.toISOString(),
    finalizadaEm: recomendacao.finalizadaEm?.toISOString() ?? null,
    equipe: recomendacao.membrosAtivos().map(membroJson),
    historico: recomendacao.membros.filter((m) => !m.ativo).map(membroJson),
  };
}

export function conviteJson(convite: Convite) {
  return {
    id: convite.id,
    recomendacaoId: convite.recomendacaoId,
    projetoId: convite.projetoId,
    profissionalId: convite.profissionalId,
    papel: convite.papel,
    status: convite.status,
    criadoEm: convite.criadoEm.toISOString(),
    respondidoEm: convite.respondidoEm?.toISOString() ?? null,
  };
}

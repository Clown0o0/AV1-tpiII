import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { ErroDominio, ErroEstadoInvalido, ErroNaoEncontrado } from './domain/errors';
import { recomendacaoRoutes } from './routes/recomendacao.routes';
import type { RecomendacaoService } from './services/RecomendacaoService';

export interface OpcoesApp {
  logger?: FastifyServerOptions['logger'];
  // recebe o logger do Fastify para que os observers usem o mesmo log JSON
  montarServico: (logger: FastifyBaseLogger) => RecomendacaoService;
}

function statusHttp(erro: ErroDominio): number {
  if (erro instanceof ErroNaoEncontrado) return 404;
  if (erro instanceof ErroEstadoInvalido) return 409;
  return 422; // ErroValidacao
}

export function construirApp(opcoes: OpcoesApp): FastifyInstance {
  const app = Fastify({ logger: opcoes.logger ?? false });
  const service = opcoes.montarServico(app.log);

  app.setErrorHandler<FastifyError>((erro, request, reply) => {
    if (erro instanceof ErroDominio) {
      request.log.warn({ codigo: erro.codigo, mensagem: erro.message }, 'erro de domínio');
      return reply.code(statusHttp(erro)).send({ erro: erro.codigo, mensagem: erro.message });
    }
    if (erro.validation) {
      return reply.code(400).send({ erro: 'REQUISICAO_INVALIDA', mensagem: erro.message });
    }
    request.log.error({ err: erro }, 'erro não tratado');
    return reply.code(500).send({ erro: 'ERRO_INTERNO', mensagem: 'Erro interno inesperado; tente novamente.' });
  });

  // health check simples (não é requisito do enunciado, só ajuda a ver se subiu)
  app.get('/health', async () => ({ status: 'ok' }));
  app.register(recomendacaoRoutes, { service });
  return app;
}

import { PrismaClient } from '@prisma/client';
import { construirApp } from './app';
import { RecomendacaoEventEmitter } from './events/RecomendacaoEventEmitter';
import { AuditoriaObserver } from './events/observers/AuditoriaObserver';
import { EmailObserver } from './events/observers/EmailObserver';
import { MensagemInternaObserver } from './events/observers/MensagemInternaObserver';
import { PrismaProfissionalRepository } from './repositories/PrismaProfissionalRepository';
import { PrismaProjetoRepository } from './repositories/PrismaProjetoRepository';
import { TIMEOUT_PADRAO_MS } from './services/FonteProfissionaisResiliente';
import { RecomendacaoService } from './services/RecomendacaoService';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: usa apenas as variáveis de ambiente do processo.
}

const prisma = new PrismaClient();
let eventos: RecomendacaoEventEmitter | undefined;

const app = construirApp({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  montarServico: (logger) => {
    eventos = new RecomendacaoEventEmitter((erro, evento, observador) =>
      logger.error({ err: erro, evento, observador }, 'falha em observador'),
    ).registrar(new EmailObserver(logger), new MensagemInternaObserver(logger), new AuditoriaObserver(logger));
    return new RecomendacaoService({
      profissionais: new PrismaProfissionalRepository(prisma),
      projetos: new PrismaProjetoRepository(prisma),
      eventos,
      opcoesFonte: {
        timeoutMs: Number(process.env.PROFISSIONAIS_TIMEOUT_MS ?? TIMEOUT_PADRAO_MS),
        aoFalhar: (erro, operacao) => logger.warn({ err: erro, operacao }, 'repositório de profissionais indisponível; usando fallback'),
      },
    });
  },
});

async function encerrar(sinal: string): Promise<void> {
  app.log.info({ sinal }, 'encerrando');
  await app.close();
  await eventos?.aguardarPendentes();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void encerrar('SIGINT'));
process.on('SIGTERM', () => void encerrar('SIGTERM'));

app
  .listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' })
  .catch(async (erro: unknown) => {
    app.log.error({ err: erro }, 'falha ao iniciar o servidor');
    await prisma.$disconnect();
    process.exit(1);
  });

import type { FastifyInstance } from 'fastify';
import { construirApp } from '../../src/app';
import { RecomendacaoEventEmitter } from '../../src/events/RecomendacaoEventEmitter';
import { AuditoriaObserver } from '../../src/events/observers/AuditoriaObserver';
import { EmailObserver } from '../../src/events/observers/EmailObserver';
import { MensagemInternaObserver } from '../../src/events/observers/MensagemInternaObserver';
import { RecomendacaoService } from '../../src/services/RecomendacaoService';
import { DATA_ENTREGA, DATA_REFERENCIA, elencoCompleto } from '../support/fixtures';
import { InMemoryProfissionalRepository, InMemoryProjetoRepository, LoggerMemoria } from '../support/InMemoryRepositories';

/** Sobe o app Fastify completo com o banco substituído por repositórios em memória. */
function montarApp() {
  const profissionais = new InMemoryProfissionalRepository(elencoCompleto());
  const projetos = new InMemoryProjetoRepository();
  const logger = new LoggerMemoria();
  const email = new EmailObserver(logger);
  const mensagens = new MensagemInternaObserver(logger);
  const auditoria = new AuditoriaObserver(logger);
  const eventos = new RecomendacaoEventEmitter().registrar(email, mensagens, auditoria);
  const app = construirApp({
    montarServico: () =>
      new RecomendacaoService({ profissionais, projetos, eventos, relogio: () => DATA_REFERENCIA, opcoesFonte: { timeoutMs: 100 } }),
  });
  return { app, profissionais, projetos, eventos, email, mensagens, auditoria };
}

const corpoProjeto = {
  titulo: 'Sertão em Chamas',
  produtorId: 'produtor-7',
  produtorEmail: 'produtora@filmes.dev',
  genero: 'Drama',
  duracaoEstimadaMin: 95,
  orcamentoTotal: 180000,
  dataEntrega: DATA_ENTREGA.toISOString(),
  tipoCaptacao: 'FICCAO',
  localizacao: 'São Paulo',
  estrategia: 'COSSENO',
  papeis: [
    { papel: 'DIRETOR', peso: 3 },
    { papel: 'DIRETOR_FOTOGRAFIA', peso: 2, competenciasDesejadas: { fotografia: 1, iluminacao: 1 } },
    { papel: 'SONOPLASTA', peso: 1 },
  ],
};

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function recomendar(app: FastifyInstance, corpo: object = corpoProjeto): Promise<Json> {
  const resposta = await app.inject({ method: 'POST', url: '/projetos/recomendar', payload: corpo });
  expect(resposta.statusCode).toBe(201);
  return resposta.json();
}

describe('API REST de recomendação (ponta a ponta)', () => {
  let ctx: ReturnType<typeof montarApp>;

  beforeEach(() => {
    ctx = montarApp();
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  it('GET /health', async () => {
    expect((await ctx.app.inject('/health')).json()).toEqual({ status: 'ok' });
  });

  it('rotas de consulta não pedidas no enunciado não existem', async () => {
    expect((await ctx.app.inject('/estrategias')).statusCode).toBe(404);
    expect((await ctx.app.inject('/projetos/qualquer')).statusCode).toBe(404);
  });

  it('fluxo completo: recomendar -> convidar -> aceitar convites -> equipe finalizada', async () => {
    const { app, eventos, email, mensagens, auditoria, projetos } = ctx;
    const { projeto, recomendacao, fonteProfissionais } = await recomendar(app);

    expect(fonteProfissionais).toBe('REPOSITORIO');
    expect(projeto).toMatchObject({ titulo: 'Sertão em Chamas', genero: 'drama', orcamentoTotal: 180000 });
    expect(recomendacao.equipe.map((m: Json) => [m.papel, m.profissionalId])).toEqual([
      ['DIRETOR', 'DIRETOR-top'],
      ['DIRETOR_FOTOGRAFIA', 'DIRETOR_FOTOGRAFIA-top'],
      ['SONOPLASTA', 'SONOPLASTA-top'],
    ]);
    expect(recomendacao.custoTotal).toBeLessThanOrEqual(180000);

    const convites: Json[] = [];
    for (const papel of ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA']) {
      const r = await app.inject({ method: 'POST', url: `/recomendacoes/${recomendacao.id}/membros/${papel}/aceitar` });
      expect(r.statusCode).toBe(201);
      convites.push(r.json().convite);
    }

    const detalhe = (await app.inject(`/recomendacoes/${recomendacao.id}`)).json();
    expect(detalhe.convites.map((c: Json) => c.status)).toEqual(['PENDENTE', 'PENDENTE', 'PENDENTE']);
    expect(detalhe.equipe.every((m: Json) => m.status === 'CONVIDADO')).toBe(true);

    let ultima: Json = {};
    for (const convite of convites) {
      const r = await app.inject({ method: 'POST', url: `/convites/${convite.id}/responder`, payload: { aceito: true } });
      expect(r.statusCode).toBe(200);
      ultima = r.json();
    }
    expect(ultima.equipeFinalizada).toBe(true);
    expect(ultima.recomendacao.status).toBe('FINALIZADA');
    expect(ultima.recomendacao.finalizadaEm).toBe(DATA_REFERENCIA.toISOString());
    expect(projetos.recomendacoes.get(recomendacao.id)?.status).toBe('FINALIZADA');

    await eventos.aguardarPendentes();
    // Profissionais notificados do interesse; produtor notificado dos aceites e da finalização.
    expect(email.enviados.filter((e) => e.assunto.startsWith('Convite para o projeto'))).toHaveLength(3);
    expect(email.enviados.filter((e) => e.para === 'produtora@filmes.dev').map((e) => e.assunto)).toEqual([
      'Equipe recomendada para "Sertão em Chamas"',
      'Convite aceito: DIRETOR',
      'Convite aceito: DIRETOR_FOTOGRAFIA',
      'Convite aceito: SONOPLASTA',
      'Equipe formada para "Sertão em Chamas"',
    ]);
    expect(mensagens.caixaDe('DIRETOR-top').map((m) => m.texto)).toEqual([
      'Você recebeu um convite para "Sertão em Chamas" (DIRETOR)',
      'A equipe de "Sertão em Chamas" está completa. Bem-vindo(a)!',
    ]);
    const auditados = auditoria.registros.map((r) => r.evento);
    expect(auditados).toEqual(
      expect.arrayContaining([
        'recomendacao.gerada',
        'convite.interesse-produtor',
        'convite.aceito',
        'equipe.finalizada',
        'integracao.gerenciamento-projetos.iniciar',
        'integracao.financeiro.iniciar',
      ]),
    );
    expect(auditoria.registros.filter((r) => r.ator.tipo === 'PROFISSIONAL')).toHaveLength(3);

    const relatorio = (await app.inject(`/recomendacoes/${recomendacao.id}/relatorio`)).json();
    expect(relatorio.validacao.valida).toBe(true);
    expect(relatorio.relatorio.equipe.every((l: Json) => l.status === 'CONFIRMADO')).toBe(true);
    expect(relatorio.compatibilidade.cobertura).toBe(1);

    const reavaliar = await app.inject({ method: 'PATCH', url: `/projetos/${projeto.id}`, payload: { orcamentoTotal: 50000 } });
    expect(reavaliar.statusCode).toBe(409);
  });

  it('rejeitar e substituir: nova rodada apenas para o papel afetado', async () => {
    const { app } = ctx;
    const { recomendacao } = await recomendar(app);
    const antes = Object.fromEntries(recomendacao.equipe.map((m: Json) => [m.papel, m.id]));

    const rejeitada = await app.inject({ method: 'POST', url: `/recomendacoes/${recomendacao.id}/membros/SONOPLASTA/rejeitar` });
    expect(rejeitada.statusCode).toBe(200);
    expect(rejeitada.json().equipe.map((m: Json) => m.papel)).toEqual(['DIRETOR', 'DIRETOR_FOTOGRAFIA']);
    expect(rejeitada.json().parcial).toBe(true);

    const substituida = await app.inject({
      method: 'POST',
      url: `/recomendacoes/${recomendacao.id}/membros/DIRETOR/substituir`,
      payload: { estrategia: 'ORCAMENTO_REDUZIDO' },
    });
    expect(substituida.statusCode).toBe(200);
    const corpo = substituida.json();
    expect(corpo.novoMembro).toMatchObject({ papel: 'DIRETOR', profissionalId: 'DIRETOR-junior', rodada: 2 });
    const depois = Object.fromEntries(corpo.recomendacao.equipe.map((m: Json) => [m.papel, m.id]));
    expect(depois.DIRETOR_FOTOGRAFIA).toBe(antes.DIRETOR_FOTOGRAFIA);
    expect(depois.DIRETOR).not.toBe(antes.DIRETOR);
    expect(corpo.recomendacao.historico.map((m: Json) => [m.papel, m.status])).toEqual([
      ['DIRETOR', 'SUBSTITUIDO'],
      ['SONOPLASTA', 'REJEITADO'],
    ]);

    const semCorpo = await app.inject({ method: 'POST', url: `/recomendacoes/${recomendacao.id}/membros/SONOPLASTA/substituir` });
    expect(semCorpo.statusCode).toBe(200);
    expect(semCorpo.json().novoMembro.profissionalId).toBe('SONOPLASTA-junior');
    expect(semCorpo.json().recomendacao.parcial).toBe(false);
  });

  it('recusa de convite é reportada ao produtor', async () => {
    const { app, eventos, email } = ctx;
    const { recomendacao } = await recomendar(app);
    const { convite } = (await app.inject({ method: 'POST', url: `/recomendacoes/${recomendacao.id}/membros/DIRETOR/aceitar` })).json();
    const resposta = await app.inject({ method: 'POST', url: `/convites/${convite.id}/responder`, payload: { aceito: false } });
    expect(resposta.json()).toMatchObject({ equipeFinalizada: false, convite: { status: 'RECUSADO' } });
    await eventos.aguardarPendentes();
    expect(email.enviados.at(-1)?.assunto).toBe('Convite recusado: DIRETOR');
  });

  it('PATCH /projetos/:id reavalia a equipe somente em alterações significativas', async () => {
    const { app } = ctx;
    const { projeto, recomendacao } = await recomendar(app);

    const pequena = await app.inject({ method: 'PATCH', url: `/projetos/${projeto.id}`, payload: { orcamentoTotal: 185000 } });
    expect(pequena.json()).toMatchObject({
      reavaliada: false,
      projeto: { orcamentoTotal: 185000 },
      recomendacao: { id: recomendacao.id },
    });

    const novaData = new Date(DATA_ENTREGA.getTime() + 60 * 86400000).toISOString();
    const grande = await app.inject({ method: 'PATCH', url: `/projetos/${projeto.id}`, payload: { dataEntrega: novaData } });
    const corpo = grande.json();
    expect(corpo.reavaliada).toBe(true);
    expect(corpo.projeto.dataEntrega).toBe(novaData);
    expect(corpo.recomendacao.id).not.toBe(recomendacao.id);

    expect((await app.inject(`/recomendacoes/${recomendacao.id}`)).json().status).toBe('OBSOLETA');
  });

  it('a estratégia escolhida pelo produtor muda a equipe recomendada', async () => {
    const { app } = ctx;
    const cosseno = await recomendar(app);
    const reduzido = await recomendar(app, { ...corpoProjeto, estrategia: 'ORCAMENTO_REDUZIDO', orcamentoTotal: 40000 });
    expect(reduzido.recomendacao.estrategia).toBe('ORCAMENTO_REDUZIDO');
    expect(reduzido.recomendacao.equipe.map((m: Json) => m.profissionalId)).not.toEqual(
      cosseno.recomendacao.equipe.map((m: Json) => m.profissionalId),
    );
  });

  it('repositório de profissionais indisponível: responde com fallback, sem quebrar', async () => {
    const { app, profissionais } = ctx;
    await recomendar(app); // aquece o cache
    profissionais.indisponivel = true;
    const comCache = await recomendar(app);
    expect(comCache.fonteProfissionais).toBe('CACHE');
    expect(comCache.recomendacao.parcial).toBe(true);
    expect(comCache.recomendacao.equipe).toHaveLength(3);

    const semCache = montarApp();
    semCache.profissionais.indisponivel = true;
    const vazio = await recomendar(semCache.app);
    expect(vazio.fonteProfissionais).toBe('INDISPONIVEL');
    expect(vazio.recomendacao.equipe).toEqual([]);
    expect(vazio.recomendacao.avisos.join()).toMatch(/indisponível/);
    await semCache.app.close();
  });

  describe('erros tratados', () => {
    it('400 para corpo inválido', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/projetos/recomendar',
        payload: { ...corpoProjeto, papeis: [{ papel: 'CAMERA', peso: 1 }] },
      });
      expect(resposta.statusCode).toBe(400);
      expect(resposta.json().erro).toBe('REQUISICAO_INVALIDA');
    });

    it('422 para regra de domínio violada', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/projetos/recomendar',
        payload: { ...corpoProjeto, dataEntrega: '2020-01-01T00:00:00Z' },
      });
      expect(resposta.statusCode).toBe(422);
      expect(resposta.json()).toMatchObject({ erro: 'VALIDACAO' });
    });

    it('404 para recursos inexistentes', async () => {
      const projeto = await ctx.app.inject({ method: 'PATCH', url: '/projetos/nao-existe', payload: { orcamentoTotal: 1 } });
      expect(projeto.statusCode).toBe(404);
      for (const url of ['/recomendacoes/nao-existe', '/recomendacoes/nao-existe/relatorio']) {
        const resposta = await ctx.app.inject(url);
        expect(resposta.statusCode).toBe(404);
        expect(resposta.json().erro).toBe('NAO_ENCONTRADO');
      }
      const convite = await ctx.app.inject({ method: 'POST', url: '/convites/x/responder', payload: { aceito: true } });
      expect(convite.statusCode).toBe(404);
    });

    it('409 para transição de estado inválida', async () => {
      const { recomendacao } = await recomendar(ctx.app);
      const url = `/recomendacoes/${recomendacao.id}/membros/DIRETOR/aceitar`;
      await ctx.app.inject({ method: 'POST', url });
      const segunda = await ctx.app.inject({ method: 'POST', url });
      expect(segunda.statusCode).toBe(409);
      expect(segunda.json().erro).toBe('ESTADO_INVALIDO');
    });

    it('500 genérico (sem vazar detalhes) para falhas inesperadas', async () => {
      ctx.projetos.falharComErroGenerico = true;
      const resposta = await ctx.app.inject({ method: 'POST', url: '/projetos/recomendar', payload: corpoProjeto });
      expect(resposta.statusCode).toBe(500);
      expect(resposta.json()).toEqual({ erro: 'ERRO_INTERNO', mensagem: 'Erro interno inesperado; tente novamente.' });
    });
  });

  it('suporta 100 requisições simultâneas', async () => {
    const respostas = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        ctx.app.inject({ method: 'POST', url: '/projetos/recomendar', payload: { ...corpoProjeto, titulo: `Projeto ${i}` } }),
      ),
    );
    expect(respostas.every((r) => r.statusCode === 201)).toBe(true);
    expect(ctx.projetos.projetos.size).toBe(100);
  });
});

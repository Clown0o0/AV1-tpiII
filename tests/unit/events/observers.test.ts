import { Convite } from '../../../src/domain/entities/Convite';
import { MembroRecomendado, Recomendacao } from '../../../src/domain/entities/Recomendacao';
import { EVENTOS, type EventoConvite, type RecomendacaoGerada } from '../../../src/events/EventTypes';
import { RecomendacaoEventEmitter, type Observador } from '../../../src/events/RecomendacaoEventEmitter';
import { AuditoriaObserver, resumir } from '../../../src/events/observers/AuditoriaObserver';
import { EmailObserver } from '../../../src/events/observers/EmailObserver';
import { MensagemInternaObserver } from '../../../src/events/observers/MensagemInternaObserver';
import { criarProfissional, criarProjeto } from '../../support/fixtures';
import { LoggerMemoria } from '../../support/InMemoryRepositories';

function eventoRecomendacao(parcial = false): RecomendacaoGerada {
  const projeto = criarProjeto({ produtorEmail: null });
  const recomendacao = new Recomendacao({
    projetoId: projeto.id,
    estrategia: 'COSSENO',
    parcial,
    membros: [new MembroRecomendado({ papel: 'DIRETOR', profissionalId: 'p1', score: 0.9, custo: 1000, rodada: 1 })],
  });
  return {
    ator: { tipo: 'PRODUTOR', id: projeto.produtorId },
    ocorridoEm: new Date('2026-02-01T10:00:00Z'),
    projetoId: projeto.id,
    projeto,
    recomendacao,
    motivo: 'INICIAL',
    fonteProfissionais: 'REPOSITORIO',
  };
}

function eventoConvite(): EventoConvite {
  const projeto = criarProjeto();
  const profissional = criarProfissional({ id: 'p1', nome: 'Ana Diretora', email: 'ana@teste.dev' });
  return {
    ator: { tipo: 'PROFISSIONAL', id: 'p1' },
    ocorridoEm: new Date(),
    projetoId: projeto.id,
    projeto,
    profissional,
    convite: new Convite({ recomendacaoId: 'r1', projetoId: projeto.id, profissionalId: 'p1', papel: 'DIRETOR' }),
  };
}

function montar() {
  const falhas: Array<{ evento: string; observador: string }> = [];
  const emitter = new RecomendacaoEventEmitter((_erro, evento, observador) => falhas.push({ evento, observador }));
  const logger = new LoggerMemoria();
  const email = new EmailObserver(logger);
  const mensagens = new MensagemInternaObserver(logger);
  const auditoria = new AuditoriaObserver(logger);
  emitter.registrar(email, mensagens, auditoria);
  return { emitter, email, mensagens, auditoria, logger, falhas };
}

describe('Observer — observadores reagem de forma independente ao mesmo evento', () => {
  it('um único evento de recomendação gera e-mail, mensagem interna e auditoria', async () => {
    const { emitter, email, mensagens, auditoria } = montar();
    const evento = eventoRecomendacao();

    emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, evento);
    await emitter.aguardarPendentes();

    expect(email.enviados).toHaveLength(1);
    expect(email.enviados[0]).toMatchObject({
      para: 'produtor-1@produtores.cinebridge.local',
      assunto: 'Equipe recomendada para "Filme Teste"',
    });
    expect(mensagens.caixaDe('produtor-1')).toHaveLength(1);
    expect(auditoria.registros).toEqual([
      expect.objectContaining({
        evento: 'recomendacao.gerada',
        ator: { tipo: 'PRODUTOR', id: 'produtor-1' },
        ocorridoEm: '2026-02-01T10:00:00.000Z',
        dados: expect.objectContaining({ recomendacao: { id: evento.recomendacao.id }, motivo: 'INICIAL' }),
      }),
    ]);
  });

  it('a falha de um observador não impede os demais nem quem publicou', async () => {
    const { emitter, email, mensagens, auditoria, falhas } = montar();
    const quebrado: Observador = {
      nome: 'quebrado',
      registrar: (s) => s.inscrever(EVENTOS.RECOMENDACAO_GERADA, 'quebrado', () => Promise.reject(new Error('SMTP fora'))),
    };
    emitter.registrar(quebrado);

    expect(() => emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, eventoRecomendacao())).not.toThrow();
    await emitter.aguardarPendentes();

    expect(falhas).toEqual([{ evento: 'recomendacao.gerada', observador: 'quebrado' }]);
    expect(email.enviados).toHaveLength(1);
    expect(mensagens.caixaDe('produtor-1')).toHaveLength(1);
    expect(auditoria.registros).toHaveLength(1);
  });

  it('os observadores rodam de forma assíncrona (fora do fluxo de quem publica)', async () => {
    const { emitter, email } = montar();
    emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, eventoRecomendacao());
    expect(email.enviados).toHaveLength(0);
    await emitter.aguardarPendentes();
    expect(email.enviados).toHaveLength(1);
  });

  it('um tratador de falha que lança exceção não derruba o emitter', async () => {
    const emitter = new RecomendacaoEventEmitter(() => {
      throw new Error('tratador quebrado');
    });
    emitter.inscrever(EVENTOS.MEMBRO_REJEITADO, 'x', () => {
      throw new Error('falhou');
    });
    emitter.publicar(EVENTOS.MEMBRO_REJEITADO, {
      ator: { tipo: 'PRODUTOR', id: 'p' },
      ocorridoEm: new Date(),
      projetoId: 'proj',
      recomendacaoId: 'r',
      papel: 'EDITOR',
      profissionalId: 'x',
    });
    await expect(emitter.aguardarPendentes()).resolves.toBeUndefined();
  });

  it('o mesmo mecanismo reage a convite aceito e recusado notificando o produtor', async () => {
    const { emitter, email, mensagens, auditoria } = montar();
    emitter.publicar(EVENTOS.CONVITE_ACEITO, eventoConvite());
    emitter.publicar(EVENTOS.CONVITE_RECUSADO, { ...eventoConvite(), profissional: null });
    await emitter.aguardarPendentes();

    expect(email.enviados.map((e) => e.assunto)).toEqual(['Convite aceito: DIRETOR', 'Convite recusado: DIRETOR']);
    expect(email.enviados.every((e) => e.para === 'produtor1@teste.dev')).toBe(true);
    expect(email.enviados[0]?.corpo).toContain('Ana Diretora');
    expect(email.enviados[1]?.corpo).toContain('p1 recusou');
    expect(mensagens.caixaDe('produtor-1').map((m) => m.texto)).toEqual([
      'Convite para DIRETOR foi aceito',
      'Convite para DIRETOR foi recusado',
    ]);
    expect(auditoria.registros.map((r) => [r.evento, r.ator.tipo])).toEqual([
      ['convite.aceito', 'PROFISSIONAL'],
      ['convite.recusado', 'PROFISSIONAL'],
    ]);
  });

  it('interesse do produtor notifica o profissional por e-mail e mensagem', async () => {
    const { emitter, email, mensagens } = montar();
    emitter.publicar(EVENTOS.INTERESSE_PRODUTOR, eventoConvite());
    emitter.publicar(EVENTOS.INTERESSE_PRODUTOR, { ...eventoConvite(), profissional: null });
    await emitter.aguardarPendentes();
    expect(email.enviados).toHaveLength(1);
    expect(email.enviados[0]?.para).toBe('ana@teste.dev');
    expect(mensagens.caixaDe('p1')).toHaveLength(2);
  });

  it('cobre os demais eventos: substituição, reavaliação, finalização e integrações', async () => {
    const { emitter, email, mensagens, auditoria, logger } = montar();
    const base = eventoRecomendacao(true);
    emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, { ...base, motivo: 'REAVALIACAO' });
    emitter.publicar(EVENTOS.MEMBRO_SUBSTITUIDO, { ...base, papel: 'DIRETOR', anteriorId: 'p0', novoId: 'p1' });
    emitter.publicar(EVENTOS.MEMBRO_SUBSTITUIDO, { ...base, papel: 'DIRETOR', anteriorId: 'p1', novoId: null });
    emitter.publicar(EVENTOS.EQUIPE_FINALIZADA, base);
    emitter.publicar(EVENTOS.INTEGRACAO_FINANCEIRO, {
      ...base,
      recomendacaoId: base.recomendacao.id,
      orcamentoTotal: 1,
      custoEquipe: 1,
      pagamentos: [{ profissionalId: 'p1', papel: 'DIRETOR', valor: 1 }],
    });
    await emitter.aguardarPendentes();

    expect(email.enviados.map((e) => e.assunto)).toEqual([
      'Equipe recomendada para "Filme Teste"',
      'Equipe formada para "Filme Teste"',
    ]);
    expect(email.enviados[0]?.corpo).toMatch(/^Reavaliação concluída/);
    expect(mensagens.caixaDe('produtor-1').map((m) => m.texto)).toEqual([
      'Nova recomendação de equipe disponível para "Filme Teste" (parcial: alguns papéis ficaram sem sugestão)',
      'Nova sugestão para o papel DIRETOR',
      'Não encontramos substituto para o papel DIRETOR',
    ]);
    expect(mensagens.caixaDe('p1')).toHaveLength(1);
    expect(auditoria.registros.map((r) => r.evento)).toContain('integracao.financeiro.iniciar');
    expect(logger.linhas.filter((l) => l.objeto.auditoria === true)).toHaveLength(5);
  });

  it('permite cancelar inscrição e informa a quantidade de inscritos', async () => {
    const emitter = new RecomendacaoEventEmitter();
    const recebidos: string[] = [];
    const cancelar = emitter.inscrever(EVENTOS.PROJETO_ALTERADO, 'teste', (e) => {
      recebidos.push(e.projetoId);
    });
    expect(emitter.quantidadeInscritos(EVENTOS.PROJETO_ALTERADO)).toBe(1);
    cancelar();
    expect(emitter.quantidadeInscritos(EVENTOS.PROJETO_ALTERADO)).toBe(0);
    emitter.publicar(EVENTOS.PROJETO_ALTERADO, {
      ...eventoRecomendacao(),
      alteracao: { variacaoOrcamento: 0, variacaoPrazoDias: 0, estrategiaAlterada: false },
      reavaliada: false,
    });
    await emitter.aguardarPendentes();
    expect(recebidos).toEqual([]);
  });

  it('auditoria mantém apenas os registros mais recentes em memória', async () => {
    const emitter = new RecomendacaoEventEmitter();
    const auditoria = new AuditoriaObserver(new LoggerMemoria(), 2);
    emitter.registrar(auditoria);
    for (let i = 0; i < 3; i++) emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, eventoRecomendacao());
    await emitter.aguardarPendentes();
    expect(auditoria.registros).toHaveLength(2);
  });

  it('resumir reduz entidades a ids e datas a ISO', () => {
    expect(
      resumir({
        entidade: { id: 'x', nome: 'ignorado' },
        data: new Date('2026-01-01T00:00:00Z'),
        lista: [{ id: 'a' }, 2],
        aninhado: { valor: 1 },
        nulo: null,
      }),
    ).toEqual({
      entidade: { id: 'x' },
      data: '2026-01-01T00:00:00.000Z',
      lista: [{ id: 'a' }, 2],
      aninhado: { valor: 1 },
      nulo: null,
    });
  });

  it('observadores funcionam sem logger', async () => {
    const emitter = new RecomendacaoEventEmitter();
    const email = new EmailObserver();
    const mensagens = new MensagemInternaObserver();
    emitter.registrar(email, mensagens);
    emitter.publicar(EVENTOS.RECOMENDACAO_GERADA, eventoRecomendacao());
    await emitter.aguardarPendentes();
    expect(email.enviados).toHaveLength(1);
    expect(mensagens.caixaDe('ninguem')).toEqual([]);
  });
});

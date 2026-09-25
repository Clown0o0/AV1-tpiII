import { ErroEstadoInvalido, ErroNaoEncontrado, ErroValidacao } from '../../../src/domain/errors';
import type { PapelTecnico } from '../../../src/domain/entities/Projeto';
import { EVENTOS, type NomeEvento } from '../../../src/events/EventTypes';
import { RecomendacaoEventEmitter } from '../../../src/events/RecomendacaoEventEmitter';
import {
  LIMITE_VARIACAO_ORCAMENTO,
  LIMITE_VARIACAO_PRAZO_DIAS,
  RecomendacaoService,
} from '../../../src/services/RecomendacaoService';
import { criarProfissional, dadosProjeto, DATA_ENTREGA, DATA_REFERENCIA, elencoCompleto } from '../../support/fixtures';
import { InMemoryProfissionalRepository, InMemoryProjetoRepository } from '../../support/InMemoryRepositories';

function montar() {
  const profissionais = new InMemoryProfissionalRepository(elencoCompleto());
  const projetos = new InMemoryProjetoRepository();
  const eventos = new RecomendacaoEventEmitter();
  const publicados: Array<{ evento: NomeEvento; payload: unknown }> = [];
  for (const evento of Object.values(EVENTOS)) {
    eventos.inscrever(evento, 'espiao', (payload) => {
      publicados.push({ evento, payload });
    });
  }
  const service = new RecomendacaoService({
    profissionais,
    projetos,
    eventos,
    relogio: () => DATA_REFERENCIA,
    opcoesFonte: { timeoutMs: 50 },
  });
  const nomes = async () => {
    await eventos.aguardarPendentes();
    return publicados.map((p) => p.evento);
  };
  return { service, profissionais, projetos, eventos, publicados, nomes };
}

const PAPEIS: PapelTecnico[] = ['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR'];

describe('RecomendacaoService', () => {
  it('recomenda uma equipe completa, persiste e publica o evento', async () => {
    const { service, projetos, nomes } = montar();
    const { projeto, recomendacao, fonteProfissionais } = await service.recomendar(dadosProjeto());

    expect(fonteProfissionais).toBe('REPOSITORIO');
    expect(recomendacao.parcial).toBe(false);
    expect(recomendacao.membrosAtivos().map((m) => m.papel)).toEqual(PAPEIS);
    expect(recomendacao.membrosAtivos().every((m) => m.status === 'SUGERIDO' && m.rodada === 1)).toBe(true);
    expect(projetos.projetos.get(projeto.id)).toBe(projeto);
    expect(projetos.recomendacoes.get(recomendacao.id)).toBe(recomendacao);
    expect(await nomes()).toEqual([EVENTOS.RECOMENDACAO_GERADA]);
  });

  it('não persiste nada quando a composição é inválida', async () => {
    const { service, projetos } = montar();
    await expect(service.recomendar(dadosProjeto({ dataEntrega: new Date('2025-01-01') }))).rejects.toThrow(ErroValidacao);
    expect(projetos.projetos.size).toBe(0);
  });

  describe('tolerância a falhas do repositório de profissionais', () => {
    it('sem cache: devolve recomendação vazia sinalizada como parcial (fallback), sem lançar erro', async () => {
      const { service, profissionais } = montar();
      profissionais.indisponivel = true;
      const { recomendacao, fonteProfissionais } = await service.recomendar(dadosProjeto());
      expect(fonteProfissionais).toBe('INDISPONIVEL');
      expect(recomendacao.parcial).toBe(true);
      expect(recomendacao.membrosAtivos()).toHaveLength(0);
      expect(recomendacao.avisos.join()).toMatch(/nenhuma sugestão pôde ser gerada/);
    });

    it('com cache: devolve recomendação parcial baseada nos últimos profissionais lidos', async () => {
      const { service, profissionais } = montar();
      await service.recomendar(dadosProjeto());
      profissionais.indisponivel = true;
      const { recomendacao, fonteProfissionais } = await service.recomendar(dadosProjeto());
      expect(fonteProfissionais).toBe('CACHE');
      expect(recomendacao.parcial).toBe(true);
      expect(recomendacao.membrosAtivos()).toHaveLength(3);
      expect(recomendacao.avisos.join()).toMatch(/baseada em cache/);
    });

    it('timeout do repositório também aciona o fallback', async () => {
      const { service, profissionais } = montar();
      profissionais.atrasoMs = 200;
      const { fonteProfissionais } = await service.recomendar(dadosProjeto());
      expect(fonteProfissionais).toBe('INDISPONIVEL');
    });
  });

  it('aceitar membro cria convite e notifica o profissional do interesse', async () => {
    const { service, projetos, publicados, eventos } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const { convite } = await service.aceitarMembro(recomendacao.id, 'DIRETOR');

    expect(convite.status).toBe('PENDENTE');
    expect(convite.profissionalId).toBe('DIRETOR-top');
    expect(recomendacao.membroAtivo('DIRETOR')?.status).toBe('CONVIDADO');
    expect(projetos.convites.get(convite.id)).toBe(convite);
    await eventos.aguardarPendentes();
    const interesse = publicados.find((p) => p.evento === EVENTOS.INTERESSE_PRODUTOR)?.payload as { profissional: { id: string }; ator: { tipo: string } };
    expect(interesse.profissional.id).toBe('DIRETOR-top');
    expect(interesse.ator.tipo).toBe('PRODUTOR');
    await expect(service.aceitarMembro(recomendacao.id, 'DIRETOR')).rejects.toThrow(ErroEstadoInvalido);
  });

  it('rejeitar membro deixa o papel em aberto e cancela convite pendente', async () => {
    const { service, nomes } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const { convite } = await service.aceitarMembro(recomendacao.id, 'EDITOR');
    await service.rejeitarMembro(recomendacao.id, 'EDITOR');

    expect(recomendacao.membroAtivo('EDITOR')).toBeUndefined();
    expect(recomendacao.parcial).toBe(true);
    expect(convite.status).toBe('CANCELADO');
    expect(await nomes()).toContain(EVENTOS.MEMBRO_REJEITADO);
  });

  it('substituição recompõe APENAS o papel afetado, mantendo os demais fixos', async () => {
    const { service, nomes } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const antes = new Map(recomendacao.membrosAtivos().map((m) => [m.papel, m]));
    await service.aceitarMembro(recomendacao.id, 'DIRETOR');

    const { novoMembro } = await service.substituirMembro(recomendacao.id, 'DIRETOR');

    expect(novoMembro?.profissionalId).toBe('DIRETOR-junior');
    expect(novoMembro?.rodada).toBe(2);
    expect(recomendacao.rodadas).toBe(2);
    expect(recomendacao.membroAtivo('DIRETOR_FOTOGRAFIA')).toBe(antes.get('DIRETOR_FOTOGRAFIA'));
    expect(recomendacao.membroAtivo('EDITOR')).toBe(antes.get('EDITOR'));
    expect(recomendacao.membros.find((m) => m.profissionalId === 'DIRETOR-top')?.status).toBe('SUBSTITUIDO');
    expect(await nomes()).toContain(EVENTOS.MEMBRO_SUBSTITUIDO);

    // Nova substituição: todos os diretores já foram sugeridos -> papel fica em aberto.
    const segunda = await service.substituirMembro(recomendacao.id, 'DIRETOR', 'ORCAMENTO_REDUZIDO');
    expect(segunda.novoMembro).toBeNull();
    expect(recomendacao.parcial).toBe(true);
  });

  it('substituir um papel vazio (após rejeição) preenche-o sem mexer nos demais', async () => {
    const { service } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    await service.rejeitarMembro(recomendacao.id, 'EDITOR');
    const { novoMembro } = await service.substituirMembro(recomendacao.id, 'EDITOR');
    expect(novoMembro?.profissionalId).toBe('EDITOR-junior');
    expect(recomendacao.parcial).toBe(false);
  });

  it('consenso de todos os convites finaliza a equipe e dispara eventos de integração', async () => {
    const { service, nomes, publicados } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const convites = [];
    for (const papel of PAPEIS) convites.push((await service.aceitarMembro(recomendacao.id, papel)).convite);

    const r1 = await service.responderConvite(convites[0]!.id, true);
    const r2 = await service.responderConvite(convites[1]!.id, true);
    expect(r1.equipeFinalizada || r2.equipeFinalizada).toBe(false);
    const r3 = await service.responderConvite(convites[2]!.id, true);

    expect(r3.equipeFinalizada).toBe(true);
    expect(recomendacao.status).toBe('FINALIZADA');
    expect(recomendacao.finalizadaEm).toEqual(DATA_REFERENCIA);
    const eventos = await nomes();
    expect(eventos.filter((e) => e === EVENTOS.CONVITE_ACEITO)).toHaveLength(3);
    expect(eventos.slice(-3)).toEqual([
      EVENTOS.EQUIPE_FINALIZADA,
      EVENTOS.INTEGRACAO_GERENCIAMENTO_PROJETOS,
      EVENTOS.INTEGRACAO_FINANCEIRO,
    ]);
    const financeiro = publicados.at(-1)?.payload as { custoEquipe: number; pagamentos: unknown[] };
    expect(financeiro.custoEquipe).toBe(recomendacao.custoTotal());
    expect(financeiro.pagamentos).toHaveLength(3);

    await expect(service.alterarProjeto(recomendacao.projetoId, { orcamentoTotal: 1 })).rejects.toThrow(/já foi finalizada/);
  });

  it('recusa de convite notifica o produtor e libera o papel para substituição', async () => {
    const { service, nomes } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const { convite } = await service.aceitarMembro(recomendacao.id, 'DIRETOR');
    const { equipeFinalizada } = await service.responderConvite(convite.id, false);

    expect(equipeFinalizada).toBe(false);
    expect(convite.status).toBe('RECUSADO');
    expect(recomendacao.membroAtivo('DIRETOR')).toBeUndefined();
    expect(await nomes()).toContain(EVENTOS.CONVITE_RECUSADO);
    await expect(service.responderConvite(convite.id, true)).rejects.toThrow(ErroEstadoInvalido);
  });

  it('convite de membro substituído não pode mais ser respondido', async () => {
    const { service, projetos } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const { convite } = await service.aceitarMembro(recomendacao.id, 'DIRETOR');
    await service.substituirMembro(recomendacao.id, 'DIRETOR');
    // força um convite "pendente" antigo para simular corrida entre substituição e resposta
    const antigo = projetos.convites.get(convite.id)!;
    Object.assign(antigo, { _status: 'PENDENTE' });
    await expect(service.responderConvite(convite.id, true)).rejects.toThrow(/não corresponde mais/);
  });

  describe('reavaliação (RF3)', () => {
    it('alteração pequena atualiza o projeto sem reavaliar', async () => {
      const { service, nomes } = montar();
      const { projeto, recomendacao } = await service.recomendar(dadosProjeto());
      const resultado = await service.alterarProjeto(projeto.id, { orcamentoTotal: 205000 });
      expect(resultado.reavaliada).toBe(false);
      expect(resultado.recomendacao).toBe(recomendacao);
      expect(projeto.orcamentoTotal).toBe(205000);
      expect(await nomes()).toEqual([EVENTOS.RECOMENDACAO_GERADA, EVENTOS.PROJETO_ALTERADO]);
    });

    it('corte significativo de orçamento reavalia a equipe inteira e cancela convites pendentes', async () => {
      const { service, projetos, nomes } = montar();
      const { projeto, recomendacao } = await service.recomendar(dadosProjeto());
      const { convite } = await service.aceitarMembro(recomendacao.id, 'DIRETOR');

      const resultado = await service.alterarProjeto(projeto.id, { orcamentoTotal: 30000 });

      expect(resultado.reavaliada).toBe(true);
      expect(resultado.alteracao.variacaoOrcamento).toBeCloseTo(0.85);
      expect(recomendacao.status).toBe('OBSOLETA');
      expect(convite.status).toBe('CANCELADO');
      expect(resultado.recomendacao).not.toBe(recomendacao);
      expect(resultado.recomendacao?.custoTotal()).toBeLessThanOrEqual(30000);
      expect(await projetos.buscarRecomendacaoVigente(projeto.id)).toBe(resultado.recomendacao);
      expect(await nomes()).toEqual([
        EVENTOS.RECOMENDACAO_GERADA,
        EVENTOS.INTERESSE_PRODUTOR,
        EVENTOS.RECOMENDACAO_GERADA,
        EVENTOS.PROJETO_ALTERADO,
      ]);
    });

    it('mudança de prazo, de estratégia ou pedido explícito também reavaliam', async () => {
      const { service } = montar();
      const { projeto } = await service.recomendar(dadosProjeto());
      const prazo = await service.alterarProjeto(projeto.id, { dataEntrega: new Date(DATA_ENTREGA.getTime() + 30 * 86400000) });
      expect(prazo.reavaliada).toBe(true);
      const estrategia = await service.alterarProjeto(projeto.id, { estrategia: 'ORCAMENTO_REDUZIDO' });
      expect(estrategia.reavaliada).toBe(true);
      expect(estrategia.recomendacao?.estrategia).toBe('ORCAMENTO_REDUZIDO');
      const forcada = await service.alterarProjeto(projeto.id, { forcarReavaliacao: true });
      expect(forcada.reavaliada).toBe(true);
    });

    it('os limites de "alteração significativa" são configuráveis', async () => {
      expect(LIMITE_VARIACAO_ORCAMENTO).toBe(0.1);
      expect(LIMITE_VARIACAO_PRAZO_DIAS).toBe(7);
      const service = new RecomendacaoService({
        profissionais: new InMemoryProfissionalRepository(elencoCompleto()),
        projetos: new InMemoryProjetoRepository(),
        eventos: new RecomendacaoEventEmitter(),
        relogio: () => DATA_REFERENCIA,
        limiares: { variacaoOrcamento: 0.01 },
      });
      const { projeto } = await service.recomendar(dadosProjeto());
      // 2,5% não é significativo pelo padrão (10%), mas é com o limite configurado em 1%.
      expect((await service.alterarProjeto(projeto.id, { orcamentoTotal: 205000 })).reavaliada).toBe(true);
    });

    it('reavalia mesmo quando o projeto ainda não tinha recomendação vigente', async () => {
      const { service, projetos } = montar();
      const { projeto, recomendacao } = await service.recomendar(dadosProjeto());
      projetos.recomendacoes.delete(recomendacao.id);
      const resultado = await service.alterarProjeto(projeto.id, { forcarReavaliacao: true });
      expect(resultado.recomendacao).not.toBeNull();
    });
  });

  it('gera relatório completo aplicando os visitors', async () => {
    const { service } = montar();
    const { recomendacao } = await service.recomendar(dadosProjeto());
    const { relatorio, validacao, compatibilidade } = await service.gerarRelatorio(recomendacao.id);
    expect(relatorio.equipe).toHaveLength(3);
    expect(validacao.valida).toBe(true);
    expect(compatibilidade.cobertura).toBe(1);
  });

  it('lança ErroNaoEncontrado para ids inexistentes', async () => {
    const { service } = montar();
    await expect(service.alterarProjeto('x', { forcarReavaliacao: true })).rejects.toThrow(ErroNaoEncontrado);
    await expect(service.obterRecomendacao('x')).rejects.toThrow(ErroNaoEncontrado);
    await expect(service.responderConvite('x', true)).rejects.toThrow(ErroNaoEncontrado);
  });

  it('valida papel e estratégia informados', async () => {
    const { service } = montar();
    const { projeto, recomendacao } = await service.recomendar(dadosProjeto());
    await expect(service.substituirMembro(recomendacao.id, 'SONOPLASTA')).rejects.toThrow(/não é requerido/);
    await expect(
      service.alterarProjeto(projeto.id, { estrategia: 'INEXISTENTE' as never }),
    ).rejects.toThrow(ErroValidacao);
  });

  it('usa os padrões de relógio, estratégias e composição quando não injetados', async () => {
    const service = new RecomendacaoService({
      profissionais: new InMemoryProfissionalRepository([criarProfissional()]),
      projetos: new InMemoryProjetoRepository(),
      eventos: new RecomendacaoEventEmitter(),
    });
    const entrega = new Date(Date.now() + 90 * 86400000);
    const { recomendacao } = await service.recomendar(
      dadosProjeto({ dataEntrega: entrega, papeis: [{ papel: 'DIRETOR', peso: 1 }] }),
    );
    expect(recomendacao.membrosAtivos()).toHaveLength(1);
  });
});

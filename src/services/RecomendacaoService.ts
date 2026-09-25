import { Convite } from '../domain/entities/Convite';
import type { Profissional } from '../domain/entities/Profissional';
import {
  Projeto,
  type AlteracoesProjeto,
  type DadosProjeto,
  type PapelTecnico,
  type ResultadoAlteracao,
  type TipoEstrategia,
} from '../domain/entities/Projeto';
import { MembroRecomendado, Recomendacao } from '../domain/entities/Recomendacao';
import { ErroEstadoInvalido, ErroNaoEncontrado } from '../domain/errors';
import type { ProfissionalRepository } from '../domain/ports/ProfissionalRepository';
import type { ProjetoRepository } from '../domain/ports/ProjetoRepository';
import { EVENTOS, type Ator, type FonteProfissionais } from '../events/EventTypes';
import type { RecomendacaoEventEmitter } from '../events/RecomendacaoEventEmitter';
import { ComposicaoEquipeDefault } from '../orchestration/ComposicaoEquipeDefault';
import type { ComposicaoEquipeTemplate, ResultadoComposicao, SelecaoPapel } from '../orchestration/ComposicaoEquipeTemplate';
import { EstrategiaRegistry } from '../strategies/EstrategiaRegistry';
import { CompatibilidadeEquipeVisitor, type ResultadoCompatibilidade } from '../visitors/CompatibilidadeEquipeVisitor';
import { EstruturaEquipe } from '../visitors/ProjetoVisitor';
import { RelatorioVisitor, type Relatorio } from '../visitors/RelatorioVisitor';
import { ValidacaoConsistenciaVisitor, type ResultadoValidacao } from '../visitors/ValidacaoConsistenciaVisitor';
import { FonteProfissionaisResiliente, type OpcoesFonteResiliente, type ResultadoBusca } from './FonteProfissionaisResiliente';

// O que conta como "alteração significativa" (RF3). O enunciado não dá números,
// então escolhemos estes; dá para trocar pelo parâmetro `limiares` do serviço.
export const LIMITE_VARIACAO_ORCAMENTO = 0.1; // 10% do orçamento
export const LIMITE_VARIACAO_PRAZO_DIAS = 7;

export interface LimiaresReavaliacao {
  variacaoOrcamento: number;
  variacaoPrazoDias: number;
}

export interface DependenciasRecomendacaoService {
  profissionais: ProfissionalRepository;
  projetos: ProjetoRepository;
  eventos: RecomendacaoEventEmitter;
  estrategias?: EstrategiaRegistry;
  composicao?: ComposicaoEquipeTemplate;
  relogio?: () => Date;
  limiares?: Partial<LimiaresReavaliacao>;
  opcoesFonte?: Partial<OpcoesFonteResiliente>;
}

export interface ResultadoRecomendacao {
  projeto: Projeto;
  recomendacao: Recomendacao;
  fonteProfissionais: FonteProfissionais;
}

export interface ResultadoAlteracaoProjeto {
  projeto: Projeto;
  alteracao: ResultadoAlteracao;
  reavaliada: boolean;
  recomendacao: Recomendacao | null;
}

export interface ResultadoRespostaConvite {
  convite: Convite;
  recomendacao: Recomendacao;
  equipeFinalizada: boolean;
}

export interface RelatorioCompleto {
  relatorio: Relatorio;
  validacao: ResultadoValidacao;
  compatibilidade: ResultadoCompatibilidade;
}

// Junta as peças: escolhe a estratégia, roda a composição (template), publica os eventos
// e monta os relatórios com os visitors.
export class RecomendacaoService {
  private readonly projetos: ProjetoRepository;
  private readonly eventos: RecomendacaoEventEmitter;
  private readonly estrategias: EstrategiaRegistry;
  private readonly composicao: ComposicaoEquipeTemplate;
  private readonly fonte: FonteProfissionaisResiliente;
  private readonly relogio: () => Date;
  private readonly limiares: LimiaresReavaliacao;

  constructor(deps: DependenciasRecomendacaoService) {
    this.projetos = deps.projetos;
    this.eventos = deps.eventos;
    this.estrategias = deps.estrategias ?? EstrategiaRegistry.padrao();
    this.composicao = deps.composicao ?? new ComposicaoEquipeDefault();
    this.fonte = new FonteProfissionaisResiliente(deps.profissionais, deps.opcoesFonte);
    this.relogio = deps.relogio ?? (() => new Date());
    this.limiares = {
      variacaoOrcamento: LIMITE_VARIACAO_ORCAMENTO,
      variacaoPrazoDias: LIMITE_VARIACAO_PRAZO_DIAS,
      ...deps.limiares,
    };
  }

  // RF1
  async recomendar(dados: DadosProjeto): Promise<ResultadoRecomendacao> {
    const projeto = new Projeto(dados);
    const { recomendacao, fonte } = await this.comporRecomendacao(projeto);
    await this.projetos.salvar(projeto);
    await this.salvarEPublicarRecomendacao(projeto, recomendacao, 'INICIAL', fonte);
    return { projeto, recomendacao, fonteProfissionais: fonte };
  }

  private async obterProjeto(id: string): Promise<Projeto> {
    const projeto = await this.projetos.buscarPorId(id);
    if (!projeto) throw new ErroNaoEncontrado(`Projeto ${id} não encontrado`);
    return projeto;
  }

  async obterRecomendacao(id: string): Promise<{ recomendacao: Recomendacao; convites: Convite[] }> {
    const recomendacao = await this.exigirRecomendacao(id);
    return { recomendacao, convites: await this.projetos.listarConvites(id) };
  }

  // RF2 + RF4: o produtor aceita a sugestão e o profissional recebe o convite
  async aceitarMembro(recomendacaoId: string, papel: PapelTecnico): Promise<{ recomendacao: Recomendacao; convite: Convite }> {
    const { recomendacao, projeto } = await this.carregar(recomendacaoId);
    const membro = recomendacao.convidar(papel);
    const convite = new Convite({
      recomendacaoId,
      projetoId: projeto.id,
      profissionalId: membro.profissionalId,
      papel,
      criadoEm: this.relogio(),
    });
    await this.projetos.salvarRecomendacao(recomendacao);
    await this.projetos.salvarConvite(convite);

    this.eventos.publicar(EVENTOS.INTERESSE_PRODUTOR, {
      ...this.base(projeto, this.produtor(projeto)),
      projeto,
      convite,
      profissional: await this.buscarProfissional(membro.profissionalId),
    });
    return { recomendacao, convite };
  }

  // RF2: o papel fica em aberto até alguém pedir substituição
  async rejeitarMembro(recomendacaoId: string, papel: PapelTecnico): Promise<Recomendacao> {
    const { recomendacao, projeto } = await this.carregar(recomendacaoId);
    const membro = recomendacao.rejeitar(papel);
    await this.cancelarConvitesPendentes(recomendacaoId, membro);
    recomendacao.registrarResultadoRodada(true, [...recomendacao.avisos, `Papel ${papel} em aberto após rejeição`]);
    await this.projetos.salvarRecomendacao(recomendacao);

    this.eventos.publicar(EVENTOS.MEMBRO_REJEITADO, {
      ...this.base(projeto, this.produtor(projeto)),
      recomendacaoId,
      papel,
      profissionalId: membro.profissionalId,
    });
    return recomendacao;
  }

  // RF2: nova rodada só para este papel. Os outros membros ficam fixos e o custo deles
  // sai do orçamento antes de compor.
  async substituirMembro(
    recomendacaoId: string,
    papel: PapelTecnico,
    estrategia?: TipoEstrategia,
  ): Promise<{ recomendacao: Recomendacao; novoMembro: MembroRecomendado | null }> {
    const { recomendacao, projeto } = await this.carregar(recomendacaoId);
    projeto.papelRequerido(papel);
    const estrategiaRodada = this.estrategias.obter(estrategia ?? recomendacao.estrategia);

    const anterior = recomendacao.substituir(papel);
    if (anterior) await this.cancelarConvitesPendentes(recomendacaoId, anterior);
    const rodada = recomendacao.iniciarNovaRodada();

    const membrosFixos = recomendacao
      .membrosAtivos()
      .map((m) => ({ papel: m.papel, profissionalId: m.profissionalId, custo: m.custo }));
    const custoFixo = membrosFixos.reduce((soma, m) => soma + m.custo, 0);
    const agora = this.relogio();
    const busca = await this.fonte.buscarCandidatos({
      papeis: [papel],
      disponivelDe: agora,
      disponivelAte: projeto.dataEntrega,
      precoMinMaximo: projeto.orcamentoTotal - custoFixo,
    });
    const resultado = this.composicao.compor({
      projeto,
      profissionais: busca.profissionais,
      estrategia: estrategiaRodada,
      dataReferencia: agora,
      papeisAlvo: [papel],
      membrosFixos,
      excluidosPorPapel: new Map([[papel, recomendacao.profissionaisJaSugeridos(papel)]]),
    });

    const selecao = resultado.selecionados[0];
    const novoMembro = selecao ? this.criarMembro(selecao, rodada) : null;
    if (novoMembro) recomendacao.adicionarMembro(novoMembro);
    recomendacao.registrarResultadoRodada(
      projeto.papeis.some((p) => !recomendacao.membroAtivo(p.papel)),
      [...resultado.avisos, ...this.avisosDaFonte(busca)],
    );
    await this.projetos.salvarRecomendacao(recomendacao);

    this.eventos.publicar(EVENTOS.MEMBRO_SUBSTITUIDO, {
      ...this.base(projeto, this.produtor(projeto)),
      projeto,
      recomendacao,
      papel,
      anteriorId: anterior?.profissionalId ?? null,
      novoId: novoMembro?.profissionalId ?? null,
    });
    return { recomendacao, novoMembro };
  }

  // RF4 + RF5: resposta do profissional; se todo mundo aceitou, a equipe é fechada
  async responderConvite(conviteId: string, aceito: boolean): Promise<ResultadoRespostaConvite> {
    const convite = await this.projetos.buscarConvite(conviteId);
    if (!convite) throw new ErroNaoEncontrado(`Convite ${conviteId} não encontrado`);
    const { recomendacao, projeto } = await this.carregar(convite.recomendacaoId);
    if (recomendacao.membroAtivo(convite.papel)?.profissionalId !== convite.profissionalId) {
      throw new ErroEstadoInvalido(`Convite ${conviteId} não corresponde mais ao membro ativo do papel ${convite.papel}`);
    }

    convite.responder(aceito, this.relogio());
    if (aceito) recomendacao.confirmar(convite.papel);
    else recomendacao.recusar(convite.papel);
    await this.projetos.salvarConvite(convite);
    await this.projetos.salvarRecomendacao(recomendacao);

    this.eventos.publicar(aceito ? EVENTOS.CONVITE_ACEITO : EVENTOS.CONVITE_RECUSADO, {
      ...this.base(projeto, { tipo: 'PROFISSIONAL', id: convite.profissionalId }),
      projeto,
      convite,
      profissional: await this.buscarProfissional(convite.profissionalId),
    });

    const consenso = aceito && recomendacao.equipeConsensual(projeto.papeis.map((p) => p.papel));
    if (consenso) await this.finalizarEquipe(projeto, recomendacao);
    return { convite, recomendacao, equipeFinalizada: consenso };
  }

  // RF3
  async alterarProjeto(
    projetoId: string,
    alteracoes: AlteracoesProjeto & { forcarReavaliacao?: boolean },
  ): Promise<ResultadoAlteracaoProjeto> {
    const projeto = await this.obterProjeto(projetoId);
    const vigente = await this.projetos.buscarRecomendacaoVigente(projetoId);
    if (vigente?.status === 'FINALIZADA') {
      throw new ErroEstadoInvalido('A equipe deste projeto já foi finalizada e não pode ser reavaliada');
    }
    if (alteracoes.estrategia) this.estrategias.obter(alteracoes.estrategia);

    const alteracao = projeto.alterar(alteracoes);
    const reavaliar =
      alteracoes.forcarReavaliacao === true ||
      alteracao.estrategiaAlterada ||
      alteracao.variacaoOrcamento >= this.limiares.variacaoOrcamento ||
      alteracao.variacaoPrazoDias >= this.limiares.variacaoPrazoDias;
    // compõe antes de salvar: se der erro aqui, nada foi gravado
    const nova = reavaliar ? await this.comporRecomendacao(projeto) : null;
    await this.projetos.salvar(projeto);

    let recomendacao = vigente;
    if (nova) {
      if (vigente) {
        await this.cancelarConvitesPendentes(vigente.id);
        vigente.tornarObsoleta();
        await this.projetos.salvarRecomendacao(vigente);
      }
      await this.salvarEPublicarRecomendacao(projeto, nova.recomendacao, 'REAVALIACAO', nova.fonte);
      recomendacao = nova.recomendacao;
    }

    this.eventos.publicar(EVENTOS.PROJETO_ALTERADO, {
      ...this.base(projeto, this.produtor(projeto)),
      projeto,
      alteracao,
      reavaliada: reavaliar,
    });
    return { projeto, alteracao, reavaliada: reavaliar, recomendacao };
  }

  // Roda os três visitors sobre a equipe atual.
  async gerarRelatorio(recomendacaoId: string): Promise<RelatorioCompleto> {
    const { recomendacao, projeto } = await this.carregar(recomendacaoId);
    const ids = recomendacao.membrosAtivos().map((m) => m.profissionalId);
    const { profissionais } = await this.fonte.buscarPorIds(ids);
    const estrutura = new EstruturaEquipe(projeto, recomendacao, profissionais);
    return {
      relatorio: estrutura.aceitar(new RelatorioVisitor()),
      validacao: estrutura.aceitar(new ValidacaoConsistenciaVisitor(this.relogio())),
      compatibilidade: estrutura.aceitar(new CompatibilidadeEquipeVisitor()),
    };
  }

  private async comporRecomendacao(projeto: Projeto): Promise<{ recomendacao: Recomendacao; fonte: FonteProfissionais }> {
    const agora = this.relogio();
    const estrategia = this.estrategias.obter(projeto.estrategia);
    const busca = await this.fonte.buscarCandidatos({
      papeis: projeto.papeis.map((p) => p.papel),
      disponivelDe: agora,
      disponivelAte: projeto.dataEntrega,
      precoMinMaximo: projeto.orcamentoTotal,
    });
    const resultado: ResultadoComposicao = this.composicao.compor({
      projeto,
      profissionais: busca.profissionais,
      estrategia,
      dataReferencia: agora,
    });

    const recomendacao = new Recomendacao({ projetoId: projeto.id, estrategia: estrategia.tipo, criadaEm: agora });
    for (const selecao of resultado.selecionados) recomendacao.adicionarMembro(this.criarMembro(selecao, 1));
    recomendacao.registrarResultadoRodada(resultado.parcial || busca.fonte !== 'REPOSITORIO', [
      ...resultado.avisos,
      ...this.avisosDaFonte(busca),
    ]);
    return { recomendacao, fonte: busca.fonte };
  }

  private async salvarEPublicarRecomendacao(
    projeto: Projeto,
    recomendacao: Recomendacao,
    motivo: 'INICIAL' | 'REAVALIACAO',
    fonte: FonteProfissionais,
  ): Promise<void> {
    await this.projetos.salvarRecomendacao(recomendacao);
    this.eventos.publicar(EVENTOS.RECOMENDACAO_GERADA, {
      ...this.base(projeto, this.produtor(projeto)),
      projeto,
      recomendacao,
      motivo,
      fonteProfissionais: fonte,
    });
  }

  private async finalizarEquipe(projeto: Projeto, recomendacao: Recomendacao): Promise<void> {
    recomendacao.finalizar(this.relogio());
    await this.projetos.salvarRecomendacao(recomendacao);
    const sistema: Ator = { tipo: 'SISTEMA', id: 'cinebridge-recomendacao' };
    const membros = recomendacao.membrosAtivos();

    // submarino
    // Os eventos de integração só são emitidos em memória; nenhum outro serviço é chamado de verdade.

    this.eventos.publicar(EVENTOS.EQUIPE_FINALIZADA, { ...this.base(projeto, sistema), projeto, recomendacao });
    this.eventos.publicar(EVENTOS.INTEGRACAO_GERENCIAMENTO_PROJETOS, {
      ...this.base(projeto, sistema),
      recomendacaoId: recomendacao.id,
      dataEntrega: projeto.dataEntrega,
      equipe: membros.map((m) => ({ papel: m.papel, profissionalId: m.profissionalId })),
    });
    this.eventos.publicar(EVENTOS.INTEGRACAO_FINANCEIRO, {
      ...this.base(projeto, sistema),
      recomendacaoId: recomendacao.id,
      orcamentoTotal: projeto.orcamentoTotal,
      custoEquipe: recomendacao.custoTotal(),
      pagamentos: membros.map((m) => ({ profissionalId: m.profissionalId, papel: m.papel, valor: m.custo })),
    });
  }

  private criarMembro(selecao: SelecaoPapel, rodada: number): MembroRecomendado {
    return new MembroRecomendado({
      papel: selecao.papel,
      profissionalId: selecao.escolhido.profissional.id,
      score: selecao.escolhido.score,
      custo: selecao.custo,
      rodada,
      alternativas: selecao.alternativas.map((a) => ({
        profissionalId: a.candidato.profissional.id,
        score: a.candidato.score,
        custo: a.custo,
      })),
    });
  }

  private avisosDaFonte(busca: ResultadoBusca): string[] {
    if (busca.fonte === 'CACHE') {
      return [`Repositório de profissionais indisponível (${busca.erro}); recomendação parcial baseada em cache`];
    }
    if (busca.fonte === 'INDISPONIVEL') {
      return [`Repositório de profissionais indisponível (${busca.erro}); nenhuma sugestão pôde ser gerada`];
    }
    return [];
  }

  // Sem `membro`, cancela todos os convites pendentes da recomendação.
  private async cancelarConvitesPendentes(recomendacaoId: string, membro?: MembroRecomendado): Promise<void> {
    for (const convite of await this.projetos.listarConvites(recomendacaoId)) {
      if (!convite.pendente) continue;
      if (membro && (convite.profissionalId !== membro.profissionalId || convite.papel !== membro.papel)) continue;
      convite.cancelar(this.relogio());
      await this.projetos.salvarConvite(convite);
    }
  }

  private async buscarProfissional(id: string): Promise<Profissional | null> {
    const { profissionais } = await this.fonte.buscarPorIds([id]);
    return profissionais[0] ?? null;
  }

  private async exigirRecomendacao(id: string): Promise<Recomendacao> {
    const recomendacao = await this.projetos.buscarRecomendacao(id);
    if (!recomendacao) throw new ErroNaoEncontrado(`Recomendação ${id} não encontrada`);
    return recomendacao;
  }

  private async carregar(recomendacaoId: string): Promise<{ recomendacao: Recomendacao; projeto: Projeto }> {
    const recomendacao = await this.exigirRecomendacao(recomendacaoId);
    return { recomendacao, projeto: await this.obterProjeto(recomendacao.projetoId) };
  }

  private produtor(projeto: Projeto): Ator {
    return { tipo: 'PRODUTOR', id: projeto.produtorId };
  }

  private base(projeto: Projeto, ator: Ator): { ator: Ator; ocorridoEm: Date; projetoId: string } {
    return { ator, ocorridoEm: this.relogio(), projetoId: projeto.id };
  }
}

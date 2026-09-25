import type { Profissional } from '../../../src/domain/entities/Profissional';
import type { Projeto } from '../../../src/domain/entities/Projeto';
import { MembroRecomendado, Recomendacao } from '../../../src/domain/entities/Recomendacao';
import { CompatibilidadeEquipeVisitor } from '../../../src/visitors/CompatibilidadeEquipeVisitor';
import { EstruturaEquipe } from '../../../src/visitors/ProjetoVisitor';
import { RelatorioVisitor } from '../../../src/visitors/RelatorioVisitor';
import { ValidacaoConsistenciaVisitor } from '../../../src/visitors/ValidacaoConsistenciaVisitor';
import { criarProfissional, criarProjeto, DATA_REFERENCIA } from '../../support/fixtures';

function membro(papel: MembroRecomendado['papel'], profissionalId: string, custo: number, score = 0.9) {
  return new MembroRecomendado({ papel, profissionalId, score, custo, rodada: 1 });
}

function estruturaCompleta(): { estrutura: EstruturaEquipe; projeto: Projeto; recomendacao: Recomendacao; profissionais: Profissional[] } {
  const projeto = criarProjeto({ orcamentoTotal: 60000 });
  const diretor = criarProfissional({ id: 'dir', nome: 'Diana', precoMin: 20000, notas: [['x', 5]] });
  const fotografo = criarProfissional({ id: 'dop', nome: 'Otto', especialidades: ['DIRETOR_FOTOGRAFIA'], precoMin: 15000, localizacao: 'Recife' });
  const editor = criarProfissional({ id: 'ed', nome: 'Edu', especialidades: ['EDITOR'], precoMin: 10000 });
  const recomendacao = new Recomendacao({
    projetoId: projeto.id,
    estrategia: 'COSSENO',
    membros: [membro('DIRETOR', 'dir', 20000), membro('DIRETOR_FOTOGRAFIA', 'dop', 15000), membro('EDITOR', 'ed', 10000)],
  });
  const profissionais = [diretor, fotografo, editor];
  return { estrutura: new EstruturaEquipe(projeto, recomendacao, profissionais), projeto, recomendacao, profissionais };
}

function fotografia(...objetos: object[]): string {
  return JSON.stringify(objetos);
}

describe('Visitor — resultados diferentes sobre a mesma estrutura, sem alterar as classes visitadas', () => {
  it('validação, compatibilidade e relatório percorrem a mesma estrutura', () => {
    const { estrutura, projeto, recomendacao, profissionais } = estruturaCompleta();
    const antes = fotografia(projeto, recomendacao, recomendacao.membros, profissionais);

    const validacao = estrutura.aceitar(new ValidacaoConsistenciaVisitor(DATA_REFERENCIA));
    const compatibilidade = estrutura.aceitar(new CompatibilidadeEquipeVisitor());
    const relatorio = estrutura.aceitar(new RelatorioVisitor());

    expect(validacao).toEqual({
      valida: true,
      erros: [],
      custoTotal: 45000,
      orcamentoTotal: 60000,
      papeisPreenchidos: 3,
      papeisRequeridos: 3,
    });
    expect(compatibilidade.cobertura).toBe(1);
    expect(compatibilidade.indiceGeral).toBeGreaterThan(0.7);
    expect(compatibilidade.porPapel.find((p) => p.papel === 'DIRETOR')).toMatchObject({ competencias: 1, reputacao: 1, localizacao: 1 });
    expect(compatibilidade.porPapel.find((p) => p.papel === 'DIRETOR_FOTOGRAFIA')?.localizacao).toBe(0);
    expect(relatorio.equipe.map((l) => l.nome)).toEqual(['Diana', 'Otto', 'Edu']);
    expect(relatorio.financeiro).toEqual({ orcamentoTotal: 60000, custoEquipe: 45000, saldo: 15000, percentualUtilizado: 75 });
    expect(relatorio.texto).toContain('Relatório da equipe — Filme Teste');

    // Três visitors, três tipos de resultado distintos...
    expect(new Set([validacao, compatibilidade, relatorio].map((r) => Object.keys(r).join()))).toHaveProperty('size', 3);
    // ...e nenhuma entidade visitada foi modificada.
    expect(fotografia(projeto, recomendacao, recomendacao.membros, profissionais)).toBe(antes);
  });

  it('a ordem de visita é projeto -> recomendação -> membros -> profissionais (apenas os ativos)', () => {
    const { projeto, recomendacao, profissionais } = estruturaCompleta();
    recomendacao.rejeitar('EDITOR');
    const visitas: string[] = [];
    new EstruturaEquipe(projeto, recomendacao, profissionais).aceitar({
      visitarProjeto: () => visitas.push('projeto'),
      visitarRecomendacao: () => visitas.push('recomendacao'),
      visitarMembro: (m) => visitas.push(`membro:${m.papel}`),
      visitarProfissional: (p) => visitas.push(`profissional:${p.id}`),
      resultado: () => visitas,
    });
    expect(visitas).toEqual([
      'projeto',
      'recomendacao',
      'membro:DIRETOR',
      'membro:DIRETOR_FOTOGRAFIA',
      'profissional:dir',
      'profissional:dop',
    ]);
  });
});

describe('ValidacaoConsistenciaVisitor', () => {
  it('aponta papéis vazios, orçamento estourado e inconsistências de membros', () => {
    const projeto = criarProjeto({ orcamentoTotal: 30000 });
    const semEspecialidade = criarProfissional({ id: 'a', especialidades: ['EDITOR'], precoMin: 10000, precoMax: 12000 });
    const indisponivel = criarProfissional({
      id: 'b',
      especialidades: ['DIRETOR_FOTOGRAFIA'],
      precoMin: 5000,
      disponibilidade: [{ inicio: DATA_REFERENCIA, fim: new Date('2026-02-01') }],
    });
    const recomendacao = new Recomendacao({
      projetoId: projeto.id,
      estrategia: 'COSSENO',
      status: 'OBSOLETA',
      membros: [
        membro('DIRETOR', 'a', 25000),
        membro('DIRETOR_FOTOGRAFIA', 'b', 5000),
        membro('EDITOR', 'a', 1000),
        membro('SONOPLASTA', 'fantasma', 100),
      ],
    });
    const resultado = new EstruturaEquipe(projeto, recomendacao, [semEspecialidade, indisponivel]).aceitar(
      new ValidacaoConsistenciaVisitor(DATA_REFERENCIA),
    );
    expect(resultado.valida).toBe(false);
    expect(resultado.erros).toEqual(
      expect.arrayContaining([
        'Recomendação obsoleta (substituída por uma reavaliação)',
        'Profissional a alocado em mais de um papel',
        expect.stringMatching(/fora da faixa de preço/),
        expect.stringMatching(/não está disponível até a data de entrega/),
        'Profissional fantasma (SONOPLASTA) não encontrado',
        expect.stringMatching(/^Orçamento insuficiente/),
      ]),
    );
  });

  it('detecta papel obrigatório não preenchido e especialidade incompatível', () => {
    const projeto = criarProjeto({ papeis: [{ papel: 'DIRETOR', peso: 1 }, { papel: 'EDITOR', peso: 1 }] });
    const editor = criarProfissional({ id: 'ed', especialidades: ['EDITOR'] });
    const recomendacao = new Recomendacao({ projetoId: projeto.id, estrategia: 'COSSENO', membros: [membro('DIRETOR', 'ed', 10000)] });
    const resultado = new EstruturaEquipe(projeto, recomendacao, [editor]).aceitar(new ValidacaoConsistenciaVisitor());
    expect(resultado.erros).toEqual([
      expect.stringMatching(/não possui especialidade DIRETOR/),
      'Papel obrigatório EDITOR não preenchido',
    ]);
  });

  it('exige que um projeto tenha sido visitado', () => {
    expect(() => new ValidacaoConsistenciaVisitor().resultado()).toThrow(/nenhum projeto/);
    expect(() => new CompatibilidadeEquipeVisitor().resultado()).toThrow(/nenhum projeto/);
    expect(() => new RelatorioVisitor().resultado()).toThrow(/projeto e recomendação/);
  });
});

describe('CompatibilidadeEquipeVisitor e RelatorioVisitor com equipe incompleta', () => {
  it('papéis vazios reduzem o índice geral e aparecem em aberto no relatório', () => {
    const { projeto, recomendacao, profissionais } = estruturaCompleta();
    const completa = new EstruturaEquipe(projeto, recomendacao, profissionais).aceitar(new CompatibilidadeEquipeVisitor());
    recomendacao.rejeitar('DIRETOR');
    const estrutura = new EstruturaEquipe(projeto, recomendacao, profissionais.filter((p) => p.id !== 'ed'));

    const compatibilidade = estrutura.aceitar(new CompatibilidadeEquipeVisitor());
    const relatorio = estrutura.aceitar(new RelatorioVisitor());

    expect(compatibilidade.cobertura).toBeCloseTo(1 / 3, 3);
    expect(compatibilidade.indiceGeral).toBeLessThan(completa.indiceGeral);
    expect(compatibilidade.porPapel.find((p) => p.papel === 'DIRETOR_FOTOGRAFIA')?.reputacao).toBe(0.5);
    expect(relatorio.papeisEmAberto).toEqual(['DIRETOR']);
    expect(relatorio.equipe.find((l) => l.papel === 'EDITOR')).toMatchObject({
      nome: '(profissional indisponível)',
      mediaAvaliacoes: null,
      localizacao: '-',
    });
    expect(relatorio.texto).toContain('DIRETOR: (em aberto)');
  });

  it('os pesos da compatibilidade são parâmetros configuráveis', () => {
    const { estrutura } = estruturaCompleta();
    const soCompetencias = estrutura.aceitar(
      new CompatibilidadeEquipeVisitor({ competencias: 1, reputacao: 0, localizacao: 0, reputacaoSemAvaliacao: 0 }),
    );
    expect(soCompetencias.porPapel.every((p) => p.compatibilidade === p.competencias)).toBe(true);
  });

  it('relatório inclui avisos da recomendação', () => {
    const projeto = criarProjeto();
    const recomendacao = new Recomendacao({ projetoId: projeto.id, estrategia: 'ORCAMENTO_REDUZIDO', avisos: ['atenção'] });
    const relatorio = new EstruturaEquipe(projeto, recomendacao, []).aceitar(new RelatorioVisitor());
    expect(relatorio.texto).toContain('Aviso: atenção');
    expect(relatorio.recomendacao.avisos).toEqual(['atenção']);
  });
});

import { Avaliacao } from '../../../src/domain/entities/Avaliacao';
import { Competencia, similaridadeCosseno } from '../../../src/domain/entities/Competencia';
import { Convite } from '../../../src/domain/entities/Convite';
import { Profissional } from '../../../src/domain/entities/Profissional';
import { Projeto } from '../../../src/domain/entities/Projeto';
import { MembroRecomendado, Recomendacao } from '../../../src/domain/entities/Recomendacao';
import { ErroEstadoInvalido, ErroValidacao } from '../../../src/domain/errors';
import { criarProfissional, dadosProjeto, DATA_ENTREGA } from '../../support/fixtures';

describe('Competencia', () => {
  it('normaliza nomes e valida nível', () => {
    expect(new Competencia('  Color Grading ', 0.5).nome).toBe('color_grading');
    expect(() => new Competencia('', 0.5)).toThrow(ErroValidacao);
    expect(() => new Competencia('x', 1.5)).toThrow(/entre 0 e 1/);
    expect(Competencia.normalizarVetor({ 'Direção Geral': 1 })).toEqual({ 'direção_geral': 1 });
  });

  it('similaridade de cosseno', () => {
    expect(similaridadeCosseno({ a: 1 }, { a: 2 })).toBeCloseTo(1);
    expect(similaridadeCosseno({ a: 1 }, { b: 1 })).toBe(0);
    expect(similaridadeCosseno({}, { a: 1 })).toBe(0);
    expect(similaridadeCosseno({ a: 1 }, {})).toBe(0);
  });
});

describe('Avaliacao', () => {
  it('aceita notas inteiras de 1 a 5', () => {
    expect(new Avaliacao({ profissionalId: 'p', autorId: 'a', nota: 5 }).projetoId).toBeNull();
    expect(() => new Avaliacao({ profissionalId: 'p', autorId: 'a', nota: 0 })).toThrow(ErroValidacao);
    expect(() => new Avaliacao({ profissionalId: 'p', autorId: 'a', nota: 3.5 })).toThrow(ErroValidacao);
  });
});

describe('Projeto', () => {
  it.each([
    [{ titulo: ' ' }, /Título/],
    [{ produtorId: '' }, /Produtor/],
    [{ genero: '' }, /Gênero/],
    [{ localizacao: '' }, /Localização/],
    [{ duracaoEstimadaMin: 0 }, /Duração/],
    [{ tipoCaptacao: 'NOVELA' as never }, /captação/],
    [{ estrategia: 'X' as never }, /Estratégia/],
    [{ orcamentoTotal: -1 }, /Orçamento/],
    [{ dataEntrega: new Date('invalida') }, /Data de entrega/],
    [{ papeis: [] }, /ao menos um papel/],
    [{ papeis: [{ papel: 'CAMERA' as never, peso: 1 }] }, /Papel técnico inválido/],
    [{ papeis: [{ papel: 'EDITOR' as const, peso: 1 }, { papel: 'EDITOR' as const, peso: 2 }] }, /mais de uma vez/],
    [{ papeis: [{ papel: 'EDITOR' as const, peso: 0 }] }, /Peso/],
  ])('rejeita dados inválidos %#', (dados, erro) => {
    expect(() => new Projeto(dadosProjeto(dados))).toThrow(erro);
  });

  it('calcula a variação de uma alteração', () => {
    const projeto = new Projeto(dadosProjeto({ orcamentoTotal: 100 }));
    const alteracao = projeto.alterar({
      orcamentoTotal: 150,
      dataEntrega: new Date(DATA_ENTREGA.getTime() + 2 * 86400000),
      estrategia: 'FILTRAGEM_COLABORATIVA',
    });
    expect(alteracao).toEqual({ variacaoOrcamento: 0.5, variacaoPrazoDias: 2, estrategiaAlterada: true });
    expect(projeto.alterar({})).toEqual({ variacaoOrcamento: 0, variacaoPrazoDias: 0, estrategiaAlterada: false });
    expect(() => projeto.alterar({ orcamentoTotal: 0 })).toThrow(ErroValidacao);
    expect(() => projeto.papelRequerido('SONOPLASTA')).toThrow(/não é requerido/);
  });
});

describe('Profissional', () => {
  it('valida dados obrigatórios e faixa de preço', () => {
    const base = { email: 'e', localizacao: 'x', disponibilidade: [], competencias: [] };
    expect(() => new Profissional({ ...base, nome: '', especialidades: ['EDITOR'], precoMin: 1, precoMax: 2 })).toThrow(/Nome/);
    expect(() => new Profissional({ ...base, nome: 'a', especialidades: [], precoMin: 1, precoMax: 2 })).toThrow(/especialidades/);
    expect(() => new Profissional({ ...base, nome: 'a', especialidades: ['EDITOR'], precoMin: 3, precoMax: 2 })).toThrow(/Faixa/);
    const p = new Profissional({ ...base, nome: 'a', especialidades: ['EDITOR'], precoMin: 1, precoMax: 2 });
    expect(p.id).toBeDefined();
    expect(p.historicoProjetos).toEqual([]);
    expect(p.mediaAvaliacoes()).toBeNull();
  });

  it('compara localização sem diferenciar maiúsculas/acentos', () => {
    expect(criarProfissional({ localizacao: 'São Paulo' }).mesmaLocalizacao(' sao paulo ')).toBe(true);
  });
});

describe('Recomendacao e Convite — transições de estado', () => {
  function recomendacao() {
    return new Recomendacao({
      projetoId: 'p',
      estrategia: 'COSSENO',
      membros: [new MembroRecomendado({ papel: 'EDITOR', profissionalId: 'e', score: 1, custo: 10, rodada: 1 })],
    });
  }

  it('impede transições inválidas', () => {
    const r = recomendacao();
    expect(() => r.confirmar('EDITOR')).toThrow(ErroEstadoInvalido);
    expect(() => r.convidar('DIRETOR')).toThrow(/Não há membro ativo/);
    expect(() =>
      r.adicionarMembro(new MembroRecomendado({ papel: 'EDITOR', profissionalId: 'x', score: 1, custo: 1, rodada: 2 })),
    ).toThrow(/já possui membro ativo/);
    expect(r.substituir('DIRETOR')).toBeUndefined();
  });

  it('recomendação finalizada ou obsoleta não aceita alterações', () => {
    const r = recomendacao();
    r.finalizar(new Date());
    expect(() => r.convidar('EDITOR')).toThrow(/não aceita alterações/);
    expect(() => r.tornarObsoleta()).toThrow(ErroEstadoInvalido);
    expect(() => r.iniciarNovaRodada()).toThrow(ErroEstadoInvalido);
  });

  it('convite só pode ser respondido ou cancelado uma vez', () => {
    const convite = new Convite({ recomendacaoId: 'r', projetoId: 'p', profissionalId: 'e', papel: 'EDITOR' });
    convite.cancelar(new Date());
    expect(convite.status).toBe('CANCELADO');
    expect(() => convite.responder(true, new Date())).toThrow(ErroEstadoInvalido);
  });
});

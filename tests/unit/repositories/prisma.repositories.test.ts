import type { PrismaClient } from '@prisma/client';
import { Convite } from '../../../src/domain/entities/Convite';
import { MembroRecomendado, Recomendacao } from '../../../src/domain/entities/Recomendacao';
import { PrismaProfissionalRepository } from '../../../src/repositories/PrismaProfissionalRepository';
import { PrismaProjetoRepository } from '../../../src/repositories/PrismaProjetoRepository';
import { criarProjeto, DATA_ENTREGA, DATA_REFERENCIA } from '../../support/fixtures';

/** PrismaClient falso: apenas os delegates usados pelos repositórios. */
function prismaFalso() {
  const mock = {
    profissional: { findMany: jest.fn() },
    projeto: { upsert: jest.fn(), findUnique: jest.fn() },
    projetoPapel: { deleteMany: jest.fn(), createMany: jest.fn() },
    recomendacao: { upsert: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    membroRecomendado: { deleteMany: jest.fn(), createMany: jest.fn() },
    convite: { upsert: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((fn: (tx: typeof mock) => Promise<unknown>) => fn(mock));
  return { mock, prisma: mock as unknown as PrismaClient };
}

const registroProfissional = {
  id: 'p1',
  nome: 'Ana',
  email: 'ana@x.dev',
  especialidades: ['DIRETOR'],
  precoMin: { toString: () => '1000.50', valueOf: () => 1000.5 },
  precoMax: 2000,
  localizacao: 'Recife',
  historicoProjetos: ['h1'],
  competencias: [{ id: 'c', profissionalId: 'p1', nome: 'Direcao', nivel: 0.7 }],
  avaliacoes: [{ id: 'a', profissionalId: 'p1', autorId: 'prod', projetoId: null, nota: 4, comentario: 'ok', criadaEm: DATA_REFERENCIA }],
  disponibilidades: [{ id: 'd', profissionalId: 'p1', inicio: DATA_REFERENCIA, fim: DATA_ENTREGA }],
};

describe('PrismaProfissionalRepository', () => {
  it('traduz o filtro para a consulta Prisma e mapeia para o domínio', async () => {
    const { mock, prisma } = prismaFalso();
    mock.profissional.findMany.mockResolvedValue([registroProfissional]);
    const repo = new PrismaProfissionalRepository(prisma);

    const [profissional] = await repo.buscarCandidatos({
      papeis: ['DIRETOR'],
      disponivelDe: DATA_REFERENCIA,
      disponivelAte: DATA_ENTREGA,
      precoMinMaximo: 5000,
    });

    expect(mock.profissional.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          especialidades: { hasSome: ['DIRETOR'] },
          disponibilidades: { some: { inicio: { lte: DATA_REFERENCIA }, fim: { gte: DATA_ENTREGA } } },
          precoMin: { lte: 5000 },
        },
      }),
    );
    expect(profissional?.precoMin).toBe(1000.5);
    expect(profissional?.vetorCompetencias()).toEqual({ direcao: 0.7 });
    expect(profissional?.mediaAvaliacoes()).toBe(4);
    expect(profissional?.disponivelEntre(DATA_REFERENCIA, DATA_ENTREGA)).toBe(true);
  });

  it('omite o filtro de preço quando não informado e busca por ids', async () => {
    const { mock, prisma } = prismaFalso();
    mock.profissional.findMany.mockResolvedValue([]);
    const repo = new PrismaProfissionalRepository(prisma);
    await repo.buscarCandidatos({ papeis: ['EDITOR'], disponivelDe: DATA_REFERENCIA, disponivelAte: DATA_ENTREGA });
    expect(mock.profissional.findMany.mock.calls[0][0].where).not.toHaveProperty('precoMin');

    expect(await repo.buscarPorIds([])).toEqual([]);
    await repo.buscarPorIds(['a', 'b']);
    expect(mock.profissional.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['a', 'b'] } });
  });
});

describe('PrismaProjetoRepository', () => {
  it('salva o projeto com seus papéis numa transação e o reconstrói', async () => {
    const { mock, prisma } = prismaFalso();
    const repo = new PrismaProjetoRepository(prisma);
    const projeto = criarProjeto({
      papeis: [
        { papel: 'DIRETOR', peso: 2, competenciasDesejadas: { direcao: 1 } },
        { papel: 'EDITOR', peso: 1 },
      ],
    });
    await repo.salvar(projeto);

    expect(mock.$transaction).toHaveBeenCalledTimes(1);
    expect(mock.projeto.upsert.mock.calls[0][0].where).toEqual({ id: projeto.id });
    expect(mock.projetoPapel.deleteMany).toHaveBeenCalledWith({ where: { projetoId: projeto.id } });
    expect(mock.projetoPapel.createMany.mock.calls[0][0].data).toEqual([
      { projetoId: projeto.id, papel: 'DIRETOR', peso: 2, competenciasDesejadas: { direcao: 1 } },
      { projetoId: projeto.id, papel: 'EDITOR', peso: 1, competenciasDesejadas: undefined },
    ]);

    mock.projeto.findUnique.mockResolvedValueOnce({
      ...mock.projeto.upsert.mock.calls[0][0].create,
      orcamentoTotal: '200000.00',
      papeis: [
        { projetoId: projeto.id, papel: 'DIRETOR', peso: 2, competenciasDesejadas: { direcao: 1 } },
        { projetoId: projeto.id, papel: 'EDITOR', peso: 1, competenciasDesejadas: null },
      ],
    });
    const lido = await repo.buscarPorId(projeto.id);
    expect(lido?.orcamentoTotal).toBe(200000);
    expect(lido?.perfilDesejado('DIRETOR')).toEqual({ direcao: 1 });
    expect(lido?.papelRequerido('EDITOR').competenciasDesejadas).toBeUndefined();

    mock.projeto.findUnique.mockResolvedValueOnce(null);
    expect(await repo.buscarPorId('x')).toBeNull();
  });

  it('salva e reconstrói a recomendação com seus membros', async () => {
    const { mock, prisma } = prismaFalso();
    const repo = new PrismaProjetoRepository(prisma);
    const recomendacao = new Recomendacao({
      projetoId: 'proj',
      estrategia: 'COSSENO',
      membros: [
        new MembroRecomendado({
          papel: 'DIRETOR',
          profissionalId: 'p1',
          score: 0.8,
          custo: 1000,
          rodada: 1,
          alternativas: [{ profissionalId: 'p2', score: 0.5, custo: 500 }],
        }),
      ],
    });
    await repo.salvarRecomendacao(recomendacao);
    const membrosGravados = mock.membroRecomendado.createMany.mock.calls[0][0].data;
    expect(membrosGravados[0]).toMatchObject({ recomendacaoId: recomendacao.id, status: 'SUGERIDO', custo: 1000 });

    const registro = {
      ...mock.recomendacao.upsert.mock.calls[0][0].create,
      membros: membrosGravados.map((m: Record<string, unknown>) => ({ ...m, custo: '1000.00' })),
    };
    mock.recomendacao.findUnique.mockResolvedValueOnce(registro);
    mock.recomendacao.findFirst.mockResolvedValueOnce({ ...registro, membros: [{ ...registro.membros[0], alternativas: null }] });

    const lida = await repo.buscarRecomendacao(recomendacao.id);
    expect(lida?.membroAtivo('DIRETOR')?.custo).toBe(1000);
    expect(lida?.membroAtivo('DIRETOR')?.alternativas).toEqual([{ profissionalId: 'p2', score: 0.5, custo: 500 }]);
    const vigente = await repo.buscarRecomendacaoVigente('proj');
    expect(vigente?.membroAtivo('DIRETOR')?.alternativas).toEqual([]);
    expect(mock.recomendacao.findFirst.mock.calls[0][0].where).toEqual({ projetoId: 'proj', status: { not: 'OBSOLETA' } });

    mock.recomendacao.findUnique.mockResolvedValueOnce(null);
    mock.recomendacao.findFirst.mockResolvedValueOnce(null);
    expect(await repo.buscarRecomendacao('x')).toBeNull();
    expect(await repo.buscarRecomendacaoVigente('x')).toBeNull();
  });

  it('salva, busca e lista convites', async () => {
    const { mock, prisma } = prismaFalso();
    const repo = new PrismaProjetoRepository(prisma);
    const convite = new Convite({ recomendacaoId: 'r', projetoId: 'proj', profissionalId: 'p1', papel: 'EDITOR' });
    await repo.salvarConvite(convite);
    const registro = mock.convite.upsert.mock.calls[0][0].create;
    expect(registro).toMatchObject({ status: 'PENDENTE', respondidoEm: null });

    mock.convite.findUnique.mockResolvedValueOnce(registro).mockResolvedValueOnce(null);
    mock.convite.findMany.mockResolvedValueOnce([registro]);
    expect((await repo.buscarConvite(convite.id))?.pendente).toBe(true);
    expect(await repo.buscarConvite('x')).toBeNull();
    expect(await repo.listarConvites('r')).toHaveLength(1);
  });
});

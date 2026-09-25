import type { Prisma, PrismaClient } from '@prisma/client';
import { Convite } from '../domain/entities/Convite';
import type { VetorCompetencias } from '../domain/entities/Competencia';
import { Projeto } from '../domain/entities/Projeto';
import { MembroRecomendado, Recomendacao, type Alternativa } from '../domain/entities/Recomendacao';
import type { ProjetoRepository } from '../domain/ports/ProjetoRepository';

type ProjetoPersistido = Prisma.ProjetoGetPayload<{ include: { papeis: true } }>;
type RecomendacaoPersistida = Prisma.RecomendacaoGetPayload<{ include: { membros: true } }>;
type ConvitePersistido = Prisma.ConviteGetPayload<object>;

export class PrismaProjetoRepository implements ProjetoRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async salvar(projeto: Projeto): Promise<void> {
    const dados = {
      titulo: projeto.titulo,
      produtorId: projeto.produtorId,
      produtorEmail: projeto.produtorEmail,
      genero: projeto.genero,
      duracaoEstimadaMin: projeto.duracaoEstimadaMin,
      orcamentoTotal: projeto.orcamentoTotal,
      dataEntrega: projeto.dataEntrega,
      tipoCaptacao: projeto.tipoCaptacao,
      localizacao: projeto.localizacao,
      estrategia: projeto.estrategia,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.projeto.upsert({
        where: { id: projeto.id },
        create: { id: projeto.id, criadoEm: projeto.criadoEm, ...dados },
        update: dados,
      });
      await tx.projetoPapel.deleteMany({ where: { projetoId: projeto.id } });
      await tx.projetoPapel.createMany({
        data: projeto.papeis.map((p) => ({
          projetoId: projeto.id,
          papel: p.papel,
          peso: p.peso,
          competenciasDesejadas: (p.competenciasDesejadas as Prisma.InputJsonObject | undefined) ?? undefined,
        })),
      });
    });
  }

  async buscarPorId(id: string): Promise<Projeto | null> {
    const registro = await this.prisma.projeto.findUnique({ where: { id }, include: { papeis: true } });
    return registro ? projetoParaDominio(registro) : null;
  }

  async salvarRecomendacao(recomendacao: Recomendacao): Promise<void> {
    const dados = {
      status: recomendacao.status,
      parcial: recomendacao.parcial,
      avisos: [...recomendacao.avisos],
      rodadas: recomendacao.rodadas,
      finalizadaEm: recomendacao.finalizadaEm,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.recomendacao.upsert({
        where: { id: recomendacao.id },
        create: {
          id: recomendacao.id,
          projetoId: recomendacao.projetoId,
          estrategia: recomendacao.estrategia,
          criadaEm: recomendacao.criadaEm,
          ...dados,
        },
        update: dados,
      });
      await tx.membroRecomendado.deleteMany({ where: { recomendacaoId: recomendacao.id } });
      await tx.membroRecomendado.createMany({
        data: recomendacao.membros.map((m) => ({
          id: m.id,
          recomendacaoId: recomendacao.id,
          papel: m.papel,
          profissionalId: m.profissionalId,
          score: m.score,
          custo: m.custo,
          status: m.status,
          rodada: m.rodada,
          alternativas: m.alternativas.map((a) => ({ ...a })),
        })),
      });
    });
  }

  async buscarRecomendacao(id: string): Promise<Recomendacao | null> {
    const registro = await this.prisma.recomendacao.findUnique({ where: { id }, include: { membros: true } });
    return registro ? recomendacaoParaDominio(registro) : null;
  }

  async buscarRecomendacaoVigente(projetoId: string): Promise<Recomendacao | null> {
    const registro = await this.prisma.recomendacao.findFirst({
      where: { projetoId, status: { not: 'OBSOLETA' } },
      orderBy: { criadaEm: 'desc' },
      include: { membros: true },
    });
    return registro ? recomendacaoParaDominio(registro) : null;
  }

  async salvarConvite(convite: Convite): Promise<void> {
    const dados = { status: convite.status, respondidoEm: convite.respondidoEm };
    await this.prisma.convite.upsert({
      where: { id: convite.id },
      create: {
        id: convite.id,
        recomendacaoId: convite.recomendacaoId,
        projetoId: convite.projetoId,
        profissionalId: convite.profissionalId,
        papel: convite.papel,
        criadoEm: convite.criadoEm,
        ...dados,
      },
      update: dados,
    });
  }

  async buscarConvite(id: string): Promise<Convite | null> {
    const registro = await this.prisma.convite.findUnique({ where: { id } });
    return registro ? conviteParaDominio(registro) : null;
  }

  async listarConvites(recomendacaoId: string): Promise<Convite[]> {
    const registros = await this.prisma.convite.findMany({ where: { recomendacaoId }, orderBy: { criadoEm: 'asc' } });
    return registros.map(conviteParaDominio);
  }
}

export function projetoParaDominio(registro: ProjetoPersistido): Projeto {
  return new Projeto({
    id: registro.id,
    titulo: registro.titulo,
    produtorId: registro.produtorId,
    produtorEmail: registro.produtorEmail,
    genero: registro.genero,
    duracaoEstimadaMin: registro.duracaoEstimadaMin,
    orcamentoTotal: Number(registro.orcamentoTotal),
    dataEntrega: registro.dataEntrega,
    tipoCaptacao: registro.tipoCaptacao,
    localizacao: registro.localizacao,
    estrategia: registro.estrategia,
    criadoEm: registro.criadoEm,
    papeis: registro.papeis.map((p) => ({
      papel: p.papel,
      peso: p.peso,
      ...(p.competenciasDesejadas ? { competenciasDesejadas: p.competenciasDesejadas as VetorCompetencias } : {}),
    })),
  });
}

export function recomendacaoParaDominio(registro: RecomendacaoPersistida): Recomendacao {
  return new Recomendacao({
    id: registro.id,
    projetoId: registro.projetoId,
    estrategia: registro.estrategia,
    status: registro.status,
    parcial: registro.parcial,
    avisos: registro.avisos,
    rodadas: registro.rodadas,
    criadaEm: registro.criadaEm,
    finalizadaEm: registro.finalizadaEm,
    membros: registro.membros.map(
      (m) =>
        new MembroRecomendado({
          id: m.id,
          papel: m.papel,
          profissionalId: m.profissionalId,
          score: m.score,
          custo: Number(m.custo),
          status: m.status,
          rodada: m.rodada,
          alternativas: (m.alternativas ?? []) as unknown as Alternativa[],
        }),
    ),
  });
}

export function conviteParaDominio(registro: ConvitePersistido): Convite {
  return new Convite({
    id: registro.id,
    recomendacaoId: registro.recomendacaoId,
    projetoId: registro.projetoId,
    profissionalId: registro.profissionalId,
    papel: registro.papel,
    status: registro.status,
    criadoEm: registro.criadoEm,
    respondidoEm: registro.respondidoEm,
  });
}

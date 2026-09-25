import type { Prisma, PrismaClient } from '@prisma/client';
import { Avaliacao } from '../domain/entities/Avaliacao';
import { Competencia } from '../domain/entities/Competencia';
import { Profissional } from '../domain/entities/Profissional';
import type { FiltroCandidatos, ProfissionalRepository } from '../domain/ports/ProfissionalRepository';

const INCLUDE_PROFISSIONAL = {
  competencias: true,
  avaliacoes: true,
  disponibilidades: true,
} satisfies Prisma.ProfissionalInclude;

export type ProfissionalPersistido = Prisma.ProfissionalGetPayload<{ include: typeof INCLUDE_PROFISSIONAL }>;

export class PrismaProfissionalRepository implements ProfissionalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async buscarCandidatos(filtro: FiltroCandidatos): Promise<Profissional[]> {
    // Filtros seletivos no banco (índice GIN em especialidades) reduzem o volume que chega à estratégia.
    const registros = await this.prisma.profissional.findMany({
      where: {
        especialidades: { hasSome: [...filtro.papeis] },
        disponibilidades: { some: { inicio: { lte: filtro.disponivelDe }, fim: { gte: filtro.disponivelAte } } },
        ...(filtro.precoMinMaximo !== undefined ? { precoMin: { lte: filtro.precoMinMaximo } } : {}),
      },
      include: INCLUDE_PROFISSIONAL,
    });
    return registros.map(paraDominio);
  }

  async buscarPorIds(ids: readonly string[]): Promise<Profissional[]> {
    if (ids.length === 0) return [];
    const registros = await this.prisma.profissional.findMany({
      where: { id: { in: [...ids] } },
      include: INCLUDE_PROFISSIONAL,
    });
    return registros.map(paraDominio);
  }
}

export function paraDominio(registro: ProfissionalPersistido): Profissional {
  return new Profissional({
    id: registro.id,
    nome: registro.nome,
    email: registro.email,
    especialidades: registro.especialidades,
    precoMin: Number(registro.precoMin),
    precoMax: Number(registro.precoMax),
    localizacao: registro.localizacao,
    historicoProjetos: registro.historicoProjetos,
    disponibilidade: registro.disponibilidades.map((d) => ({ inicio: d.inicio, fim: d.fim })),
    competencias: registro.competencias.map((c) => new Competencia(c.nome, c.nivel)),
    avaliacoes: registro.avaliacoes.map(
      (a) =>
        new Avaliacao({
          id: a.id,
          profissionalId: a.profissionalId,
          autorId: a.autorId,
          projetoId: a.projetoId,
          nota: a.nota,
          comentario: a.comentario,
          criadaEm: a.criadaEm,
        }),
    ),
  });
}

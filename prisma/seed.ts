/**
 * APOIO A TESTES MANUAIS — não faz parte dos requisitos do enunciado.
 * Existe apenas para que haja profissionais no banco ao chamar a API localmente.
 *
 * Popula o banco com profissionais fictícios (determinístico).
 *   npm run db:seed                         -> 300 profissionais
 *   SEED_PROFISSIONAIS=10000 npm run db:seed -> teste de escala
 * (No PowerShell: $env:SEED_PROFISSIONAIS=10000; npm run db:seed)
 */
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type PapelTecnico } from '@prisma/client';
import { PAPEIS_TECNICOS, PERFIL_PADRAO_POR_PAPEL } from '../src/domain/entities/Projeto';

try {
  process.loadEnvFile();
} catch {
  // variáveis já definidas no ambiente
}

const prisma = new PrismaClient();
const TOTAL = Number(process.env.SEED_PROFISSIONAIS ?? 300);
const LOTE = 1000;
const CIDADES = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Recife', 'Porto Alegre', 'Salvador', 'Curitiba'];
const NOMES = ['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'João', 'Larissa', 'Marcos'];
const SOBRENOMES = ['Silva', 'Souza', 'Oliveira', 'Santos', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Ribeiro', 'Carvalho'];
const PRODUTORES = Array.from({ length: 25 }, (_, i) => `produtor-${i + 1}`);
const EXTRAS = ['lideranca', 'pesquisa', 'narrativa', 'animacao_3d', 'trilha', 'color_grading'];

// PRNG determinístico (mulberry32) para que o seed seja reproduzível.
let estado = 42;
function aleatorio(): number {
  estado = (estado + 0x6d2b79f5) | 0;
  let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const escolher = <T>(lista: readonly T[]): T => lista[Math.floor(aleatorio() * lista.length)] as T;
const arred = (v: number, casas = 2) => Math.round(v * 10 ** casas) / 10 ** casas;

async function main(): Promise<void> {
  console.log(`Limpando dados e gerando ${TOTAL} profissionais...`);
  await prisma.$transaction([
    prisma.convite.deleteMany(),
    prisma.membroRecomendado.deleteMany(),
    prisma.recomendacao.deleteMany(),
    prisma.projetoPapel.deleteMany(),
    prisma.projeto.deleteMany(),
    prisma.avaliacao.deleteMany(),
    prisma.competencia.deleteMany(),
    prisma.disponibilidade.deleteMany(),
    prisma.profissional.deleteMany(),
  ]);

  const hoje = new Date();
  for (let inicio = 0; inicio < TOTAL; inicio += LOTE) {
    const profissionais: Prisma.ProfissionalCreateManyInput[] = [];
    const competencias: Prisma.CompetenciaCreateManyInput[] = [];
    const disponibilidades: Prisma.DisponibilidadeCreateManyInput[] = [];
    const avaliacoes: Prisma.AvaliacaoCreateManyInput[] = [];

    for (let i = inicio; i < Math.min(inicio + LOTE, TOTAL); i++) {
      const id = randomUUID();
      const principal = escolher(PAPEIS_TECNICOS);
      const especialidades = new Set<PapelTecnico>([principal]);
      if (aleatorio() < 0.3) especialidades.add(escolher(PAPEIS_TECNICOS));
      const senioridade = aleatorio();
      const precoMin = arred(3000 + senioridade * 27000);

      profissionais.push({
        id,
        nome: `${escolher(NOMES)} ${escolher(SOBRENOMES)} ${i + 1}`,
        email: `profissional${i + 1}@cinebridge.dev`,
        especialidades: [...especialidades],
        precoMin,
        precoMax: arred(precoMin * (1.2 + aleatorio() * 0.6)),
        localizacao: escolher(CIDADES),
        historicoProjetos: Array.from({ length: Math.floor(aleatorio() * 6) }, () => `projeto-historico-${Math.floor(aleatorio() * 500)}`),
      });

      const niveis = new Map<string, number>();
      for (const papel of especialidades) {
        for (const [nome, peso] of Object.entries(PERFIL_PADRAO_POR_PAPEL[papel])) {
          niveis.set(nome, arred(Math.min(1, Math.max(0.05, peso * (0.4 + senioridade * 0.5) + (aleatorio() - 0.5) * 0.3)), 3));
        }
      }
      if (aleatorio() < 0.5) niveis.set(escolher(EXTRAS), arred(aleatorio(), 3));
      for (const [nome, nivel] of niveis) competencias.push({ id: randomUUID(), profissionalId: id, nome, nivel });

      // Disponível de ~1 mês atrás até 3–18 meses à frente (alguns com agenda curta).
      const fim = new Date(hoje);
      fim.setMonth(fim.getMonth() + 3 + Math.floor(aleatorio() * 16));
      const comeco = new Date(hoje);
      comeco.setMonth(comeco.getMonth() - 1);
      disponibilidades.push({ id: randomUUID(), profissionalId: id, inicio: comeco, fim });

      const qtdAvaliacoes = Math.floor(aleatorio() * 6);
      for (let a = 0; a < qtdAvaliacoes; a++) {
        const nota = Math.max(1, Math.min(5, Math.round(2 + senioridade * 2.5 + (aleatorio() - 0.5) * 2)));
        avaliacoes.push({ id: randomUUID(), profissionalId: id, autorId: escolher(PRODUTORES), nota });
      }
    }

    await prisma.profissional.createMany({ data: profissionais });
    await prisma.competencia.createMany({ data: competencias });
    await prisma.disponibilidade.createMany({ data: disponibilidades });
    await prisma.avaliacao.createMany({ data: avaliacoes });
    console.log(`  ${Math.min(inicio + LOTE, TOTAL)}/${TOTAL}`);
  }
  console.log('Seed concluído. Produtores com histórico de avaliações: produtor-1 ... produtor-25');
}

main()
  .catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

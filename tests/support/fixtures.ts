import { Avaliacao } from '../../src/domain/entities/Avaliacao';
import { Competencia } from '../../src/domain/entities/Competencia';
import { Profissional, type DadosProfissional } from '../../src/domain/entities/Profissional';
import { PAPEIS_TECNICOS, PERFIL_PADRAO_POR_PAPEL, Projeto, type DadosProjeto, type PapelTecnico } from '../../src/domain/entities/Projeto';

export const DATA_REFERENCIA = new Date('2026-01-10T00:00:00.000Z');
export const DATA_ENTREGA = new Date('2026-12-15T00:00:00.000Z');
export const JANELA_TOTAL = { inicio: new Date('2025-12-01T00:00:00.000Z'), fim: new Date('2027-06-30T00:00:00.000Z') };

export function competencias(vetor: Record<string, number>): Competencia[] {
  return Object.entries(vetor).map(([nome, nivel]) => new Competencia(nome, nivel));
}

export function avaliacoes(profissionalId: string, notas: Array<[autorId: string, nota: number]>): Avaliacao[] {
  return notas.map(([autorId, nota]) => new Avaliacao({ profissionalId, autorId, nota }));
}

let sequencia = 0;

export function criarProfissional(
  dados: Partial<Omit<DadosProfissional, 'competencias' | 'avaliacoes'>> & {
    competencias?: Record<string, number>;
    notas?: Array<[string, number]>;
  } = {},
): Profissional {
  sequencia += 1;
  const id = dados.id ?? `prof-${String(sequencia).padStart(5, '0')}`;
  const especialidades = dados.especialidades ?? ['DIRETOR'];
  return new Profissional({
    id,
    nome: dados.nome ?? `Profissional ${sequencia}`,
    email: dados.email ?? `${id}@teste.dev`,
    especialidades,
    precoMin: dados.precoMin ?? 10000,
    precoMax: dados.precoMax ?? (dados.precoMin ?? 10000) * 1.5,
    localizacao: dados.localizacao ?? 'São Paulo',
    disponibilidade: dados.disponibilidade ?? [JANELA_TOTAL],
    competencias: competencias(dados.competencias ?? { ...PERFIL_PADRAO_POR_PAPEL[especialidades[0] as PapelTecnico] }),
    historicoProjetos: dados.historicoProjetos ?? [],
    avaliacoes: avaliacoes(id, dados.notas ?? []),
  });
}

export function dadosProjeto(dados: Partial<DadosProjeto> = {}): DadosProjeto {
  return {
    titulo: 'Filme Teste',
    produtorId: 'produtor-1',
    produtorEmail: 'produtor1@teste.dev',
    genero: 'Drama',
    duracaoEstimadaMin: 100,
    orcamentoTotal: 200000,
    dataEntrega: DATA_ENTREGA,
    tipoCaptacao: 'FICCAO',
    localizacao: 'São Paulo',
    papeis: [
      { papel: 'DIRETOR', peso: 3 },
      { papel: 'DIRETOR_FOTOGRAFIA', peso: 2 },
      { papel: 'EDITOR', peso: 1 },
    ],
    ...dados,
  };
}

export function criarProjeto(dados: Partial<DadosProjeto> = {}): Projeto {
  return new Projeto(dadosProjeto(dados));
}

/** Um bom candidato por papel (perfil padrão), mais uma variação mais barata e menos aderente. */
export function elencoCompleto(): Profissional[] {
  return PAPEIS_TECNICOS.flatMap((papel, i) => [
    criarProfissional({ id: `${papel}-top`, nome: `${papel} Top`, especialidades: [papel], precoMin: 20000 + i * 1000 }),
    criarProfissional({
      id: `${papel}-junior`,
      nome: `${papel} Junior`,
      especialidades: [papel],
      precoMin: 6000 + i * 500,
      competencias: Object.fromEntries(Object.entries(PERFIL_PADRAO_POR_PAPEL[papel]).map(([k, v], j) => [k, j === 0 ? v * 0.4 : v])),
      localizacao: 'Recife',
    }),
  ]);
}

/** Gera N profissionais pseudoaleatórios (determinístico) para testes de escala. */
export function gerarProfissionais(total: number): Profissional[] {
  let estado = 7;
  const aleatorio = () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
  const cidades = ['São Paulo', 'Rio de Janeiro', 'Recife', 'Curitiba'];
  const produtores = Array.from({ length: 30 }, (_, i) => `produtor-${i}`);
  return Array.from({ length: total }, (_, i) => {
    const papel = PAPEIS_TECNICOS[i % PAPEIS_TECNICOS.length] as PapelTecnico;
    const vetor: Record<string, number> = {};
    for (const [nome, nivel] of Object.entries(PERFIL_PADRAO_POR_PAPEL[papel])) vetor[nome] = Math.min(1, nivel * (0.3 + aleatorio()));
    const notas: Array<[string, number]> = Array.from({ length: Math.floor(aleatorio() * 5) }, () => [
      produtores[Math.floor(aleatorio() * produtores.length)] as string,
      1 + Math.floor(aleatorio() * 5),
    ]);
    return criarProfissional({
      id: `gen-${i}`,
      especialidades: [papel],
      precoMin: 3000 + Math.floor(aleatorio() * 30000),
      localizacao: cidades[i % cidades.length] as string,
      competencias: vetor,
      notas,
    });
  });
}

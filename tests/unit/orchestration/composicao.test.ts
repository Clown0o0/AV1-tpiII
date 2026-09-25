import { ErroValidacao } from '../../../src/domain/errors';
import { ComposicaoEquipeDefault } from '../../../src/orchestration/ComposicaoEquipeDefault';
import {
  ComposicaoEquipeTemplate,
  type EntradaComposicao,
  type EntradaNormalizada,
  type RankingPapel,
  type ResultadoComposicao,
} from '../../../src/orchestration/ComposicaoEquipeTemplate';
import { CossenoStrategy } from '../../../src/strategies/CossenoStrategy';
import { EstrategiaRegistry } from '../../../src/strategies/EstrategiaRegistry';
import {
  criarProfissional,
  criarProjeto,
  DATA_ENTREGA,
  DATA_REFERENCIA,
  elencoCompleto,
  gerarProfissionais,
} from '../../support/fixtures';

/** Subclasse instrumentada: cada etapa registra sua execução e pode ter comportamento próprio. */
class ComposicaoInstrumentada extends ComposicaoEquipeTemplate {
  readonly etapas: string[] = [];

  constructor(private readonly variante: 'A' | 'B') {
    super();
  }

  protected validarRestricoesOrcamentarias(_entrada: EntradaComposicao): void {
    this.etapas.push('validar');
  }

  protected normalizarEntrada(entrada: EntradaComposicao): EntradaNormalizada {
    this.etapas.push('normalizar');
    return {
      projeto: entrada.projeto,
      estrategia: entrada.estrategia,
      dataReferencia: entrada.dataReferencia,
      orcamentoDisponivel: this.variante === 'A' ? entrada.projeto.orcamentoTotal : 1,
      papeis: [],
      universo: [...entrada.profissionais],
      avisos: [`variante ${this.variante}`],
    };
  }

  protected aplicarEstrategia(_entrada: EntradaNormalizada): RankingPapel[] {
    this.etapas.push('aplicar');
    return [];
  }

  protected posProcessar(_rankings: RankingPapel[], entrada: EntradaNormalizada): ResultadoComposicao {
    this.etapas.push('posProcessar');
    return {
      estrategia: entrada.estrategia.tipo,
      selecionados: [],
      papeisSemCandidato: [],
      custoTotal: 0,
      orcamentoDisponivel: entrada.orcamentoDisponivel,
      parcial: false,
      avisos: entrada.avisos,
    };
  }
}

function entrada(parcial: Partial<EntradaComposicao> = {}): EntradaComposicao {
  return {
    projeto: criarProjeto(),
    profissionais: elencoCompleto(),
    estrategia: new CossenoStrategy(),
    dataReferencia: DATA_REFERENCIA,
    ...parcial,
  };
}

describe('Template Method — fluxo principal imutável', () => {
  it('executa sempre validar -> normalizar -> aplicar -> posProcessar, mesmo com etapas diferentes', () => {
    const a = new ComposicaoInstrumentada('A');
    const b = new ComposicaoInstrumentada('B');
    const resultadoA = a.compor(entrada());
    const resultadoB = b.compor(entrada());

    const fluxo = ['validar', 'normalizar', 'aplicar', 'posProcessar'];
    expect(a.etapas).toEqual(fluxo);
    expect(b.etapas).toEqual(fluxo);
    // As etapas variaram (resultados diferentes), o esqueleto não.
    expect(resultadoA.avisos).toEqual(['variante A']);
    expect(resultadoB.avisos).toEqual(['variante B']);
    expect(resultadoA.orcamentoDisponivel).not.toBe(resultadoB.orcamentoDisponivel);
  });

  it('interrompe o fluxo quando a validação falha (nenhuma etapa posterior roda)', () => {
    class FalhaNaValidacao extends ComposicaoInstrumentada {
      protected override validarRestricoesOrcamentarias(e: EntradaComposicao): void {
        super.validarRestricoesOrcamentarias(e);
        throw new ErroValidacao('orçamento insuficiente');
      }
    }
    const composicao = new FalhaNaValidacao('A');
    expect(() => composicao.compor(entrada())).toThrow(ErroValidacao);
    expect(composicao.etapas).toEqual(['validar']);
  });

  it('proíbe subclasses de sobrescrever compor()', () => {
    class Rebelde extends ComposicaoInstrumentada {
      override compor(): ResultadoComposicao {
        throw new Error('não deveria executar');
      }
    }
    expect(() => new Rebelde('A')).toThrow(/não pode sobrescrever o fluxo compor/);
  });

  it('não permite reatribuir compor no protótipo do template', () => {
    expect(() => {
      (ComposicaoEquipeTemplate.prototype as unknown as { compor: unknown }).compor = () => null;
    }).toThrow(TypeError);
  });
});

describe('ComposicaoEquipeDefault', () => {
  const composicao = new ComposicaoEquipeDefault();

  it('seleciona um profissional por papel dentro do orçamento, na ordem de papéis do projeto', () => {
    const resultado = composicao.compor(entrada());
    expect(resultado.selecionados.map((s) => s.papel)).toEqual(['DIRETOR', 'DIRETOR_FOTOGRAFIA', 'EDITOR']);
    expect(resultado.selecionados.map((s) => s.escolhido.profissional.id)).toEqual([
      'DIRETOR-top',
      'DIRETOR_FOTOGRAFIA-top',
      'EDITOR-top',
    ]);
    expect(resultado.custoTotal).toBeLessThanOrEqual(200000);
    expect(resultado.parcial).toBe(false);
    expect(resultado.selecionados[0]?.alternativas.map((a) => a.candidato.profissional.id)).toEqual(['DIRETOR-junior']);
  });

  it('reserva orçamento para os papéis seguintes, preferindo alternativa mais barata quando necessário', () => {
    // Orçamento curto: o diretor "top" (20000) + fotógrafo mais barato (6500) + editor mais barato (7500) = 34000 > 30000.
    const resultado = composicao.compor(entrada({ projeto: criarProjeto({ orcamentoTotal: 30000 }) }));
    expect(resultado.papeisSemCandidato).toEqual([]);
    expect(resultado.custoTotal).toBeLessThanOrEqual(30000);
    expect(resultado.selecionados.find((s) => s.papel === 'DIRETOR')?.escolhido.profissional.id).toBe('DIRETOR-junior');
  });

  it('usa orçamento reservado com aviso quando não há alternativa melhor', () => {
    const projeto = criarProjeto({
      orcamentoTotal: 30000,
      papeis: [
        { papel: 'DIRETOR', peso: 2 },
        { papel: 'EDITOR', peso: 1 },
      ],
    });
    const diretor = criarProfissional({ id: 'dir', precoMin: 25000 });
    const editor = criarProfissional({ id: 'ed', especialidades: ['EDITOR'], precoMin: 10000 });
    const resultado = composicao.compor(entrada({ projeto, profissionais: [diretor, editor] }));
    expect(resultado.selecionados.map((s) => s.escolhido.profissional.id)).toEqual(['dir']);
    expect(resultado.papeisSemCandidato).toEqual(['EDITOR']);
    expect(resultado.parcial).toBe(true);
    expect(resultado.avisos.join(' ')).toMatch(/consome orçamento reservado/);
    expect(resultado.avisos.join(' ')).toMatch(/nenhum candidato cabe no orçamento restante/);
  });

  it('marca como parcial papéis sem nenhum profissional elegível', () => {
    const resultado = composicao.compor(
      entrada({ profissionais: elencoCompleto().filter((p) => !p.atuaComo('EDITOR')) }),
    );
    expect(resultado.parcial).toBe(true);
    expect(resultado.papeisSemCandidato).toEqual(['EDITOR']);
    expect(resultado.avisos.join(' ')).toMatch(/nenhum profissional elegível/);
  });

  it('descarta indisponíveis no prazo, excluídos e membros fixos; nunca repete profissional', () => {
    const ocupado = criarProfissional({
      id: 'ocupado',
      disponibilidade: [{ inicio: DATA_REFERENCIA, fim: new Date('2026-03-01') }],
    });
    const excluido = criarProfissional({ id: 'excluido' });
    const fixo = criarProfissional({ id: 'fixo', especialidades: ['DIRETOR', 'EDITOR'] });
    const livre = criarProfissional({ id: 'livre', precoMin: 15000 });
    const projeto = criarProjeto({
      papeis: [
        { papel: 'DIRETOR', peso: 1 },
        { papel: 'EDITOR', peso: 1 },
      ],
    });
    const resultado = composicao.compor(
      entrada({
        projeto,
        profissionais: [ocupado, excluido, fixo, livre, livre],
        papeisAlvo: ['DIRETOR'],
        membrosFixos: [{ papel: 'EDITOR', profissionalId: 'fixo', custo: 10000 }],
        excluidosPorPapel: new Map([['DIRETOR', new Set(['excluido'])]]),
      }),
    );
    expect(resultado.selecionados).toHaveLength(1);
    expect(resultado.selecionados[0]?.escolhido.profissional.id).toBe('livre');
    expect(resultado.selecionados[0]?.alternativas).toEqual([]);
    expect(resultado.orcamentoDisponivel).toBe(190000);
  });

  it('não escolhe o mesmo profissional para dois papéis', () => {
    const multi = criarProfissional({ id: 'multi', especialidades: ['DIRETOR', 'EDITOR'], competencias: { direcao: 1, edicao: 1 } });
    const projeto = criarProjeto({
      papeis: [
        { papel: 'DIRETOR', peso: 2 },
        { papel: 'EDITOR', peso: 1 },
      ],
    });
    const resultado = composicao.compor(entrada({ projeto, profissionais: [multi] }));
    expect(resultado.selecionados.map((s) => s.escolhido.profissional.id)).toEqual(['multi']);
    expect(resultado.papeisSemCandidato).toEqual(['EDITOR']);
  });

  it('valida prazo, papéis alvo e custo dos membros fixos', () => {
    expect(() => composicao.compor(entrada({ dataReferencia: DATA_ENTREGA }))).toThrow(/data de entrega/);
    expect(() => composicao.compor(entrada({ papeisAlvo: ['SONOPLASTA'] }))).toThrow(/não é requerido/);
    expect(() =>
      composicao.compor(entrada({ membrosFixos: [{ papel: 'EDITOR', profissionalId: 'x', custo: 999999 }] })),
    ).toThrow(/excede o orçamento/);
  });

  it('respeita o limite de alternativas configurado', () => {
    const muitos = Array.from({ length: 8 }, (_, i) => criarProfissional({ id: `d${i}`, precoMin: 1000 + i }));
    const projeto = criarProjeto({ papeis: [{ papel: 'DIRETOR', peso: 1 }] });
    const resultado = new ComposicaoEquipeDefault({ limiteAlternativas: 5 }).compor(entrada({ projeto, profissionais: muitos }));
    expect(resultado.selecionados[0]?.alternativas).toHaveLength(5);
  });
});

describe('Escala: 10.000 profissionais', () => {
  const profissionais = gerarProfissionais(10000);
  const projeto = criarProjeto({
    orcamentoTotal: 150000,
    papeis: [
      { papel: 'DIRETOR', peso: 5 },
      { papel: 'DIRETOR_FOTOGRAFIA', peso: 4 },
      { papel: 'SONOPLASTA', peso: 2 },
      { papel: 'EDITOR', peso: 3 },
      { papel: 'ROTEIRISTA', peso: 3 },
      { papel: 'EFEITOS_VISUAIS', peso: 1 },
    ],
  });

  const registry = EstrategiaRegistry.padrao();
  it.each((['COSSENO', 'FILTRAGEM_COLABORATIVA', 'ORCAMENTO_REDUZIDO'] as const).map((t) => [t, registry.obter(t)] as const))(
    'estratégia %s compõe a equipe em menos de 2 segundos',
    (_tipo, estrategia) => {
      const inicio = performance.now();
      const resultado = new ComposicaoEquipeDefault().compor({
        projeto,
        profissionais,
        estrategia,
        dataReferencia: DATA_REFERENCIA,
      });
      const duracao = performance.now() - inicio;
      expect(resultado.selecionados).toHaveLength(6);
      expect(resultado.custoTotal).toBeLessThanOrEqual(150000);
      expect(duracao).toBeLessThan(2000);
    },
  );
});

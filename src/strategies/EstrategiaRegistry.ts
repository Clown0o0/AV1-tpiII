import { ErroValidacao } from '../domain/errors';
import type { TipoEstrategia } from '../domain/entities/Projeto';
import { CossenoStrategy } from './CossenoStrategy';
import { FiltragemColaborativaStrategy } from './FiltragemColaborativaStrategy';
import { OrcamentoReduzidoStrategy } from './OrcamentoReduzidoStrategy';
import type { RecomendacaoStrategy } from './RecomendacaoStrategy';

// Acha a estratégia pelo nome escolhido pelo produtor (na criação, no PATCH ou na substituição).
export class EstrategiaRegistry {
  private readonly estrategias = new Map<TipoEstrategia, RecomendacaoStrategy>();

  constructor(estrategias: readonly RecomendacaoStrategy[] = []) {
    for (const estrategia of estrategias) this.registrar(estrategia);
  }

  static padrao(): EstrategiaRegistry {
    return new EstrategiaRegistry([
      new CossenoStrategy(),
      new FiltragemColaborativaStrategy(),
      new OrcamentoReduzidoStrategy(),
    ]);
  }

  registrar(estrategia: RecomendacaoStrategy): void {
    this.estrategias.set(estrategia.tipo, estrategia);
  }

  obter(tipo: TipoEstrategia): RecomendacaoStrategy {
    const estrategia = this.estrategias.get(tipo);
    if (!estrategia) throw new ErroValidacao(`Estratégia de recomendação não suportada: ${tipo}`);
    return estrategia;
  }
}

import { EVENTOS, type EventoBase, type NomeEvento } from '../EventTypes';
import type { Observador, RecomendacaoEventEmitter } from '../RecomendacaoEventEmitter';

// Subconjunto compatível com o pino (logger do Fastify).
export interface LoggerEstruturado {
  info(objeto: Record<string, unknown>, mensagem: string): void;
}

export interface RegistroAuditoria {
  evento: NomeEvento;
  ator: EventoBase['ator'];
  projetoId: string;
  ocorridoEm: string;
  dados: Record<string, unknown>;
}

// Registra, como log estruturado, toda ação de produtores, profissionais e do sistema.
export class AuditoriaObserver implements Observador {
  readonly nome = 'auditoria';
  private readonly _registros: RegistroAuditoria[] = [];

  constructor(
    private readonly logger: LoggerEstruturado,
    private readonly limiteMemoria = 1000,
  ) {}

  get registros(): readonly RegistroAuditoria[] {
    return this._registros;
  }

  registrar(subject: RecomendacaoEventEmitter): void {
    for (const evento of Object.values(EVENTOS)) {
      subject.inscrever(evento, this.nome, (payload) => this.auditar(evento, payload));
    }
  }

  private auditar(evento: NomeEvento, payload: EventoBase): void {
    const { ator, projetoId, ocorridoEm, ...resto } = payload as EventoBase & Record<string, unknown>;
    const registro: RegistroAuditoria = {
      evento,
      ator,
      projetoId,
      ocorridoEm: ocorridoEm.toISOString(),
      dados: resumir(resto),
    };
    this._registros.push(registro);
    if (this._registros.length > this.limiteMemoria) this._registros.shift();
    this.logger.info({ auditoria: true, ...registro }, `auditoria: ${evento}`);
  }
}

// Reduz entidades a identificadores para manter o log de auditoria enxuto.
export function resumir(dados: Record<string, unknown>): Record<string, unknown> {
  const resultado: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(dados)) resultado[chave] = resumirValor(valor);
  return resultado;
}

function resumirValor(valor: unknown): unknown {
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map(resumirValor);
  if (valor !== null && typeof valor === 'object') {
    const objeto = valor as Record<string, unknown>;
    if (typeof objeto.id === 'string') return { id: objeto.id };
    return resumir(objeto);
  }
  return valor;
}

import { EventEmitter } from 'node:events';
import type { MapaEventos, NomeEvento } from './EventTypes';

export type Handler<E extends NomeEvento> = (payload: MapaEventos[E]) => void | Promise<void>;

export type TratadorFalha = (erro: unknown, evento: NomeEvento, observador: string) => void;

export interface Observador {
  readonly nome: string;
  registrar(subject: RecomendacaoEventEmitter): void;
}

// Subject do Observer, em cima do EventEmitter do Node.
// Cada observador roda depois do publicar() e isolado dos outros: se um quebrar, o erro vai
// para o tratadorFalha e o resto segue normalmente. Trocar por um broker depois (RabbitMQ etc.)
// só exige reimplementar publicar/inscrever.
export class RecomendacaoEventEmitter {
  private readonly emitter = new EventEmitter();
  private readonly pendentes = new Set<Promise<void>>();

  constructor(private readonly tratadorFalha: TratadorFalha = () => {}) {
    this.emitter.setMaxListeners(100);
  }

  inscrever<E extends NomeEvento>(evento: E, observador: string, handler: Handler<E>): () => void {
    const listener = (payload: MapaEventos[E]) => {
      const tarefa = this.executar(evento, observador, () => handler(payload));
      this.pendentes.add(tarefa);
      void tarefa.finally(() => this.pendentes.delete(tarefa));
    };
    this.emitter.on(evento, listener);
    return () => this.emitter.off(evento, listener);
  }

  registrar(...observadores: Observador[]): this {
    for (const observador of observadores) observador.registrar(this);
    return this;
  }

  publicar<E extends NomeEvento>(evento: E, payload: MapaEventos[E]): void {
    this.emitter.emit(evento, payload);
  }

  quantidadeInscritos(evento: NomeEvento): number {
    return this.emitter.listenerCount(evento);
  }

  // Usado nos testes e no desligamento do servidor.
  async aguardarPendentes(): Promise<void> {
    while (this.pendentes.size > 0) await Promise.allSettled([...this.pendentes]);
  }

  private async executar(evento: NomeEvento, observador: string, rodar: () => void | Promise<void>): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve)); // sai do fluxo de quem publicou
    try {
      await rodar();
    } catch (erro) {
      try {
        this.tratadorFalha(erro, evento, observador);
      } catch {
        // se até o tratador falhar, não há mais o que fazer aqui
      }
    }
  }
}

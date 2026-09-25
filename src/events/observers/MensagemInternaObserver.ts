import { EVENTOS } from '../EventTypes';
import type { Observador, RecomendacaoEventEmitter } from '../RecomendacaoEventEmitter';
import type { LoggerEstruturado } from './AuditoriaObserver';

export interface MensagemInterna {
  destinatarioId: string;
  texto: string;
  referencia: string;
  criadaEm: Date;
}

// Mensagens da plataforma (simuladas em memória): caixa de entrada por destinatário.
export class MensagemInternaObserver implements Observador {
  readonly nome = 'mensagem-interna';
  private readonly caixas = new Map<string, MensagemInterna[]>();

  constructor(private readonly logger?: LoggerEstruturado) {}

  caixaDe(destinatarioId: string): readonly MensagemInterna[] {
    return this.caixas.get(destinatarioId) ?? [];
  }

  registrar(subject: RecomendacaoEventEmitter): void {
    subject.inscrever(EVENTOS.RECOMENDACAO_GERADA, this.nome, ({ projeto, recomendacao }) =>
      this.entregar(
        projeto.produtorId,
        `Nova recomendação de equipe disponível para "${projeto.titulo}"` +
          (recomendacao.parcial ? ' (parcial: alguns papéis ficaram sem sugestão)' : ''),
        recomendacao.id,
      ),
    );
    subject.inscrever(EVENTOS.MEMBRO_SUBSTITUIDO, this.nome, ({ projeto, papel, novoId, recomendacao }) =>
      this.entregar(
        projeto.produtorId,
        novoId ? `Nova sugestão para o papel ${papel}` : `Não encontramos substituto para o papel ${papel}`,
        recomendacao.id,
      ),
    );
    subject.inscrever(EVENTOS.INTERESSE_PRODUTOR, this.nome, ({ projeto, convite }) =>
      this.entregar(convite.profissionalId, `Você recebeu um convite para "${projeto.titulo}" (${convite.papel})`, convite.id),
    );
    subject.inscrever(EVENTOS.CONVITE_ACEITO, this.nome, ({ projeto, convite }) =>
      this.entregar(projeto.produtorId, `Convite para ${convite.papel} foi aceito`, convite.id),
    );
    subject.inscrever(EVENTOS.CONVITE_RECUSADO, this.nome, ({ projeto, convite }) =>
      this.entregar(projeto.produtorId, `Convite para ${convite.papel} foi recusado`, convite.id),
    );
    subject.inscrever(EVENTOS.EQUIPE_FINALIZADA, this.nome, ({ projeto, recomendacao }) => {
      for (const membro of recomendacao.membrosAtivos()) {
        this.entregar(membro.profissionalId, `A equipe de "${projeto.titulo}" está completa. Bem-vindo(a)!`, recomendacao.id);
      }
    });
  }

  private entregar(destinatarioId: string, texto: string, referencia: string): void {
    const mensagem: MensagemInterna = { destinatarioId, texto, referencia, criadaEm: new Date() };
    const caixa = this.caixas.get(destinatarioId) ?? [];
    caixa.push(mensagem);
    this.caixas.set(destinatarioId, caixa);
    this.logger?.info({ canal: 'mensagem-interna', destinatarioId, referencia }, 'mensagem interna entregue');
  }
}

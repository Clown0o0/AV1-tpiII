import type { Projeto } from '../../domain/entities/Projeto';
import { EVENTOS } from '../EventTypes';
import type { Observador, RecomendacaoEventEmitter } from '../RecomendacaoEventEmitter';
import type { LoggerEstruturado } from './AuditoriaObserver';

export interface EmailSimulado {
  para: string;
  assunto: string;
  corpo: string;
  enviadoEm: Date;
}

// Envio de e-mail SIMULADO: nada sai do processo; as mensagens ficam em `enviados` e no log.
export class EmailObserver implements Observador {
  readonly nome = 'email';
  readonly enviados: EmailSimulado[] = [];

  constructor(private readonly logger?: LoggerEstruturado) {}

  registrar(subject: RecomendacaoEventEmitter): void {
    subject.inscrever(EVENTOS.RECOMENDACAO_GERADA, this.nome, ({ projeto, recomendacao, motivo }) =>
      this.enviar(
        emailProdutor(projeto),
        `Equipe recomendada para "${projeto.titulo}"`,
        `${motivo === 'REAVALIACAO' ? 'Reavaliação concluída. ' : ''}` +
          `${recomendacao.membrosAtivos().length} de ${projeto.papeis.length} papéis possuem sugestão ` +
          `(estratégia ${recomendacao.estrategia}).`,
      ),
    );
    subject.inscrever(EVENTOS.INTERESSE_PRODUTOR, this.nome, ({ projeto, convite, profissional }) => {
      if (!profissional) return;
      this.enviar(
        profissional.email,
        `Convite para o projeto "${projeto.titulo}"`,
        `Olá, ${profissional.nome}! Um produtor tem interesse em você como ${convite.papel}. ` +
          `Responda ao convite ${convite.id}.`,
      );
    });
    subject.inscrever(EVENTOS.CONVITE_ACEITO, this.nome, ({ projeto, convite, profissional }) =>
      this.enviar(
        emailProdutor(projeto),
        `Convite aceito: ${convite.papel}`,
        `${profissional?.nome ?? convite.profissionalId} aceitou o convite para "${projeto.titulo}".`,
      ),
    );
    subject.inscrever(EVENTOS.CONVITE_RECUSADO, this.nome, ({ projeto, convite, profissional }) =>
      this.enviar(
        emailProdutor(projeto),
        `Convite recusado: ${convite.papel}`,
        `${profissional?.nome ?? convite.profissionalId} recusou o convite para "${projeto.titulo}". ` +
          'Você pode solicitar a substituição deste papel.',
      ),
    );
    subject.inscrever(EVENTOS.EQUIPE_FINALIZADA, this.nome, ({ projeto }) =>
      this.enviar(emailProdutor(projeto), `Equipe formada para "${projeto.titulo}"`, 'Todos os papéis foram confirmados.'),
    );
  }

  private enviar(para: string, assunto: string, corpo: string): void {
    const email: EmailSimulado = { para, assunto, corpo, enviadoEm: new Date() };
    this.enviados.push(email);
    this.logger?.info({ canal: 'email', para, assunto }, 'e-mail simulado enviado');
  }
}

function emailProdutor(projeto: Projeto): string {
  return projeto.produtorEmail ?? `${projeto.produtorId}@produtores.cinebridge.local`;
}

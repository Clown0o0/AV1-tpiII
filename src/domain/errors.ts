// Erros de domínio. A camada HTTP traduz cada tipo para um status apropriado.
export abstract class ErroDominio extends Error {
  abstract readonly codigo: string;

  constructor(mensagem: string) {
    super(mensagem);
    this.name = new.target.name;
  }
}

export class ErroValidacao extends ErroDominio {
  readonly codigo = 'VALIDACAO';
}

export class ErroNaoEncontrado extends ErroDominio {
  readonly codigo = 'NAO_ENCONTRADO';
}

export class ErroEstadoInvalido extends ErroDominio {
  readonly codigo = 'ESTADO_INVALIDO';
}

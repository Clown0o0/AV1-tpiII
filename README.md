# cinebridge-recomendacao

![Node.js](https://img.shields.io/badge/Node.js-v24.15.0-339933?style=flat&logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-v5.9.3-3178C6?style=flat&logo=typescript&logoColor=white)
![Fastify](https://img.shields.io/badge/Fastify-v5.12.5-000000?style=flat&logo=fastify&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-v6.19.3-2D3748?style=flat&logo=prisma&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-v30.5.2-C21325?style=flat&logo=jest&logoColor=white)

## Sobre o projeto

Microsserviço de recomendação e orquestração de equipes da plataforma cinebridge. Ele recebe um projeto audiovisual (gênero, orçamento, prazo, localização e papéis técnicos exigidos) e monta uma equipe de profissionais recomendada, respeitando o orçamento e o prazo.

Projeto da atividade ATVI, com foco nos padrões de projeto Strategy, Template Method, Observer e Visitor.

## Como funciona

1. O produtor envia o projeto para `POST /projetos/recomendar`, escolhendo a estratégia de recomendação:
   - `COSSENO`: similaridade entre as competências do profissional e o perfil do papel;
   - `FILTRAGEM_COLABORATIVA`: avaliações de produtores com gosto parecido;
   - `ORCAMENTO_REDUZIDO`: prioriza profissionais mais baratos, locais e bem avaliados.
2. O serviço devolve um profissional sugerido por papel, dentro do orçamento e disponível até a data de entrega.
3. O produtor pode aceitar, rejeitar ou substituir cada sugestão. A substituição refaz a recomendação apenas daquele papel.
4. Ao aceitar uma sugestão, o profissional recebe um convite; quando ele aceita ou recusa, o produtor é notificado.
5. Quando todos os papéis estão confirmados, a equipe é finalizada e são emitidos eventos para os serviços de gerenciamento de projetos e financeiro.
6. Se o orçamento ou o prazo mudarem de forma significativa (`PATCH /projetos/:id`), a equipe inteira é recalculada.

Cada ação gera notificações (e-mail e mensagem interna, simulados) e um registro de auditoria em log JSON.

Organização do código:

```
src/
├── domain/          Entidades (Projeto, Profissional, Competencia, Avaliacao, Recomendacao, Convite) e interfaces de repositório
├── strategies/      Strategy: algoritmos de recomendação
├── orchestration/   Template Method: fluxo fixo de composição da equipe
├── events/          Observer: eventos e observadores (e-mail, mensagem interna, auditoria)
├── visitors/        Visitor: validação, compatibilidade e relatório da equipe
├── repositories/    Acesso ao banco com Prisma
├── services/        Regras de uso (RecomendacaoService) e tolerância a falhas
└── routes/          Rotas REST
```

## Como rodar

O projeto tem uma única pasta de código (não há frontend separado). Todos os comandos `npm` e `npx` devem ser executados na **raiz do projeto**: a pasta `AV1-tpiII/` criada pelo `git clone`, onde ficam o `package.json` e o `README.md`.

```
AV1-tpiII/            <- raiz do projeto: rode os comandos aqui
├── prisma/
├── src/
├── tests/
├── package.json
└── README.md
```

Pré-requisitos: Node.js 24, npm e PostgreSQL rodando. Verifique em qualquer pasta:

```bash
node -v
npm -v
psql --version
```

1. Baixe o projeto e entre na raiz dele:
   ```bash
   git clone https://github.com/Clown0o0/AV1-tpiII.git
   cd AV1-tpiII
   ```

2. **Na raiz do projeto (`AV1-tpiII/`)**, instale as dependências (isso também gera o cliente do Prisma). As versões estão fixas no `package.json`, então o `npm install` instala exatamente as versões listadas nos badges acima:
   ```bash
   npm install
   ```

3. **Na raiz do projeto (`AV1-tpiII/`)**, crie um arquivo chamado `.env` (ao lado do `package.json`) com o conteúdo abaixo, trocando usuário, senha, porta e nome do banco pelos do seu PostgreSQL:
   ```bash
   # formato: postgresql://USUARIO:SENHA@HOST:PORTA/NOME_DO_BANCO?schema=public
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/cinebridge_recomendacao?schema=public"
   PORT=3000
   ```
   O `.env` não vai para o Git, então sua senha fica só na sua máquina.

4. **Em qualquer pasta** (este comando fala direto com o PostgreSQL, não depende do projeto), crie o banco:
   ```bash
   createdb -U postgres cinebridge_recomendacao
   # ou: psql -U postgres -c "CREATE DATABASE cinebridge_recomendacao;"
   ```

5. **Na raiz do projeto (`AV1-tpiII/`)**, crie as tabelas:
   ```bash
   npx prisma migrate deploy
   ```

6. (Opcional) **Na raiz do projeto (`AV1-tpiII/`)**, popule o banco com profissionais de exemplo. **O seed apaga os dados existentes antes de inserir.** O padrão é 300 profissionais; use `SEED_PROFISSIONAIS` para mudar:
   ```bash
   npm run db:seed
   # Linux/macOS: SEED_PROFISSIONAIS=10000 npm run db:seed
   # PowerShell:  $env:SEED_PROFISSIONAIS=10000; npm run db:seed
   ```

7. **Na raiz do projeto (`AV1-tpiII/`)**, suba o servidor. Este terminal fica ocupado enquanto o servidor estiver rodando (Ctrl+C para parar):
   ```bash
   npm run dev
   ```

8. **Em outro terminal, em qualquer pasta**, confirme que está no ar:
   ```bash
   curl http://localhost:3000/health
   # resposta: {"status":"ok"}
   ```

Testes (com cobertura mínima de 80%). **Na raiz do projeto (`AV1-tpiII/`)**; não precisam do PostgreSQL nem do servidor rodando:

```bash
npm run test
```

## Endpoints

| Método | Caminho | O que faz |
|---|---|---|
| POST | `/projetos/recomendar` | Recebe o projeto e devolve a equipe recomendada |
| PATCH | `/projetos/:id` | Altera orçamento, prazo ou estratégia; recalcula a equipe se a mudança for significativa |
| POST | `/recomendacoes/:id/membros/:papel/aceitar` | Aceita a sugestão e envia convite ao profissional |
| POST | `/recomendacoes/:id/membros/:papel/rejeitar` | Rejeita a sugestão; o papel fica em aberto |
| POST | `/recomendacoes/:id/membros/:papel/substituir` | Nova sugestão só para o papel (body opcional `{"estrategia": "..."}`) |
| POST | `/convites/:id/responder` | Profissional responde `{"aceito": true}` ou `{"aceito": false}` |
| GET | `/recomendacoes/:id` | Estado atual da equipe e dos convites |
| GET | `/recomendacoes/:id/relatorio` | Relatório, validação e compatibilidade da equipe |
| GET | `/health` | Verifica se o servidor está no ar |

Papéis válidos: `DIRETOR`, `DIRETOR_FOTOGRAFIA`, `SONOPLASTA`, `EDITOR`, `ROTEIRISTA`, `EFEITOS_VISUAIS`.

Exemplo de requisição: um documentário de baixo orçamento sobre um drama que todo mundo já viveu.

```bash
curl -X POST http://localhost:3000/projetos/recomendar   -H "content-type: application/json"   -d '{
    "titulo": "gerson acho que sou analfabeto",
    "produtorId": "muito-dificil-entender-esse-cinebridge",
    "genero": "Drama corporativo",
    "duracaoEstimadaMin": 88,
    "orcamentoTotal": 45000,
    "dataEntrega": "2027-04-01T00:00:00Z",
    "tipoCaptacao": "DOCUMENTARIO",
    "localizacao": "São Paulo",
    "estrategia": "ORCAMENTO_REDUZIDO",
    "papeis": [
      { "papel": "DIRETOR", "peso": 3 },
      { "papel": "ROTEIRISTA", "peso": 2 },
      { "papel": "SONOPLASTA", "peso": 1 }
    ]
  }'
```

É documentário porque, infelizmente, é baseado em fatos reais. O sonoplasta entra para captar o silêncio depois do "alguma dúvida?". A entrega é em 1º de abril, mas o prazo não é pegadinha.

`tipoCaptacao` aceita `DOCUMENTARIO`, `FICCAO` ou `ANIMACAO`. A `dataEntrega` precisa ser uma data futura.

## Solução de problemas

Os comandos `npm` e `npx` desta seção também devem ser executados na raiz do projeto (`AV1-tpiII/`).

### Não conecta ao banco

**Sintoma:** `P1001: Can't reach database server` ou `ECONNREFUSED`.

**Causa:** o PostgreSQL não está rodando, ou o host/porta da `DATABASE_URL` estão errados.

**Solução:** inicie o PostgreSQL e confira o `.env`.
```bash
# Linux
sudo systemctl start postgresql
# Windows (PowerShell como administrador; o nome varia com a versão)
Get-Service postgresql*
Start-Service postgresql-x64-17
```

### Usuário ou senha inválidos

**Sintoma:** `P1000: Authentication failed against database server`.

**Causa:** usuário ou senha da `DATABASE_URL` não conferem.

**Solução:** corrija no `.env`. Caracteres especiais na senha precisam ser codificados (ex.: `@` vira `%40`).

### Banco não existe

**Sintoma:** `P1003: Database cinebridge_recomendacao does not exist`.

**Causa:** o banco ainda não foi criado.

**Solução:**
```bash
createdb -U postgres cinebridge_recomendacao
npx prisma migrate deploy
```

### Tabelas não existem ou migration com erro

**Sintoma:** `The table "public.Profissional" does not exist`, `P3005` ou `P3009`.

**Causa:** as migrations não foram aplicadas, ou falharam.

**Solução:**
- `npx prisma migrate deploy` aplica as migrations do projeto.
- `npx prisma migrate dev` só é necessário se você alterar o `schema.prisma`.
- Em banco de desenvolvimento, `npx prisma migrate reset` recria tudo (**apaga os dados**).

### Versão do Node incompatível

**Sintoma:** `npm warn EBADENGINE Unsupported engine` ou erro ao iniciar.

**Causa:** o projeto exige Node 24.

**Solução:** instale o Node 24 (https://nodejs.org ou `nvm install 24` e `nvm use 24`), apague a pasta `node_modules` e rode `npm install` de novo.

### Porta em uso

**Sintoma:** `EADDRINUSE: address already in use 0.0.0.0:3000`.

**Causa:** outro processo já usa a porta 3000.

**Solução:** troque `PORT` no `.env` (ex.: `PORT=3001`) ou encerre o outro processo.

### Testes estourando o tempo

**Sintoma:** `Exceeded timeout of 5000 ms for a test`.

**Causa:** os testes com 10.000 profissionais e com 100 requisições simultâneas são mais pesados em máquinas lentas.

**Solução:**
```bash
npm run test -- --testTimeout=30000
```

### Erros de tipo depois de mudar o schema.prisma

**Sintoma:** `Property 'xyz' does not exist on type ...` ou `@prisma/client did not initialize yet`.

**Causa:** o cliente do Prisma não foi gerado de novo.

**Solução:**
```bash
npx prisma generate
```

### EPERM ao gerar o Prisma no Windows

**Sintoma:** `EPERM: operation not permitted, rename '...query_engine-windows.dll.node...'`.

**Causa:** o `npm run dev` está rodando e bloqueia o arquivo.

**Solução:** pare o servidor (Ctrl+C) e rode `npx prisma generate` de novo.

### curl não funciona no PowerShell

**Sintoma:** erro de parâmetro ao usar `curl -X POST ...`.

**Causa:** no Windows PowerShell, `curl` é outro comando (`Invoke-WebRequest`).

**Solução:** use `curl.exe` ou `Invoke-RestMethod http://localhost:3000/health`.

### Equipe vem vazia ou incompleta

**Sintoma:** resposta com `"parcial": true` e avisos como `nenhum profissional elegível`.

**Causa:** não há profissionais cadastrados para o papel, disponíveis até a `dataEntrega` e dentro do orçamento.

**Solução:** rode `npm run db:seed`, use uma `dataEntrega` mais próxima ou aumente o `orcamentoTotal`.

### Erro 422 "A data de entrega do projeto já passou"

**Causa:** a `dataEntrega` enviada é anterior a hoje.

**Solução:** envie uma data futura.

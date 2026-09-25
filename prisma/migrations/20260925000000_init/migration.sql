-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PapelTecnico" AS ENUM ('DIRETOR', 'DIRETOR_FOTOGRAFIA', 'SONOPLASTA', 'EDITOR', 'ROTEIRISTA', 'EFEITOS_VISUAIS');

-- CreateEnum
CREATE TYPE "TipoCaptacao" AS ENUM ('DOCUMENTARIO', 'FICCAO', 'ANIMACAO');

-- CreateEnum
CREATE TYPE "TipoEstrategia" AS ENUM ('COSSENO', 'FILTRAGEM_COLABORATIVA', 'ORCAMENTO_REDUZIDO');

-- CreateEnum
CREATE TYPE "StatusRecomendacao" AS ENUM ('EM_ANDAMENTO', 'FINALIZADA', 'OBSOLETA');

-- CreateEnum
CREATE TYPE "StatusMembro" AS ENUM ('SUGERIDO', 'CONVIDADO', 'CONFIRMADO', 'REJEITADO', 'RECUSADO', 'SUBSTITUIDO');

-- CreateEnum
CREATE TYPE "StatusConvite" AS ENUM ('PENDENTE', 'ACEITO', 'RECUSADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "Projeto" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "produtorId" TEXT NOT NULL,
    "produtorEmail" TEXT,
    "genero" TEXT NOT NULL,
    "duracaoEstimadaMin" INTEGER NOT NULL,
    "orcamentoTotal" DECIMAL(14,2) NOT NULL,
    "dataEntrega" TIMESTAMP(3) NOT NULL,
    "tipoCaptacao" "TipoCaptacao" NOT NULL,
    "localizacao" TEXT NOT NULL,
    "estrategia" "TipoEstrategia" NOT NULL DEFAULT 'COSSENO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Projeto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjetoPapel" (
    "projetoId" UUID NOT NULL,
    "papel" "PapelTecnico" NOT NULL,
    "peso" DOUBLE PRECISION NOT NULL,
    "competenciasDesejadas" JSONB,

    CONSTRAINT "ProjetoPapel_pkey" PRIMARY KEY ("projetoId","papel")
);

-- CreateTable
CREATE TABLE "Profissional" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "especialidades" "PapelTecnico"[],
    "precoMin" DECIMAL(12,2) NOT NULL,
    "precoMax" DECIMAL(12,2) NOT NULL,
    "localizacao" TEXT NOT NULL,
    "historicoProjetos" TEXT[],

    CONSTRAINT "Profissional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disponibilidade" (
    "id" UUID NOT NULL,
    "profissionalId" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disponibilidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competencia" (
    "id" UUID NOT NULL,
    "profissionalId" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "nivel" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Competencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Avaliacao" (
    "id" UUID NOT NULL,
    "profissionalId" UUID NOT NULL,
    "autorId" TEXT NOT NULL,
    "projetoId" TEXT,
    "nota" INTEGER NOT NULL,
    "comentario" TEXT,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recomendacao" (
    "id" UUID NOT NULL,
    "projetoId" UUID NOT NULL,
    "estrategia" "TipoEstrategia" NOT NULL,
    "status" "StatusRecomendacao" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "parcial" BOOLEAN NOT NULL DEFAULT false,
    "avisos" TEXT[],
    "rodadas" INTEGER NOT NULL DEFAULT 1,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadaEm" TIMESTAMP(3),

    CONSTRAINT "Recomendacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembroRecomendado" (
    "id" UUID NOT NULL,
    "recomendacaoId" UUID NOT NULL,
    "papel" "PapelTecnico" NOT NULL,
    "profissionalId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "custo" DECIMAL(12,2) NOT NULL,
    "status" "StatusMembro" NOT NULL,
    "rodada" INTEGER NOT NULL,
    "alternativas" JSONB NOT NULL,

    CONSTRAINT "MembroRecomendado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Convite" (
    "id" UUID NOT NULL,
    "recomendacaoId" UUID NOT NULL,
    "projetoId" UUID NOT NULL,
    "profissionalId" UUID NOT NULL,
    "papel" "PapelTecnico" NOT NULL,
    "status" "StatusConvite" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondidoEm" TIMESTAMP(3),

    CONSTRAINT "Convite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Projeto_produtorId_idx" ON "Projeto"("produtorId");

-- CreateIndex
CREATE UNIQUE INDEX "Profissional_email_key" ON "Profissional"("email");

-- CreateIndex
CREATE INDEX "Profissional_especialidades_idx" ON "Profissional" USING GIN ("especialidades");

-- CreateIndex
CREATE INDEX "Profissional_precoMin_idx" ON "Profissional"("precoMin");

-- CreateIndex
CREATE INDEX "Disponibilidade_profissionalId_inicio_fim_idx" ON "Disponibilidade"("profissionalId", "inicio", "fim");

-- CreateIndex
CREATE UNIQUE INDEX "Competencia_profissionalId_nome_key" ON "Competencia"("profissionalId", "nome");

-- CreateIndex
CREATE INDEX "Avaliacao_profissionalId_idx" ON "Avaliacao"("profissionalId");

-- CreateIndex
CREATE INDEX "Avaliacao_autorId_idx" ON "Avaliacao"("autorId");

-- CreateIndex
CREATE INDEX "Recomendacao_projetoId_status_idx" ON "Recomendacao"("projetoId", "status");

-- CreateIndex
CREATE INDEX "MembroRecomendado_recomendacaoId_idx" ON "MembroRecomendado"("recomendacaoId");

-- CreateIndex
CREATE INDEX "Convite_recomendacaoId_idx" ON "Convite"("recomendacaoId");

-- CreateIndex
CREATE INDEX "Convite_profissionalId_idx" ON "Convite"("profissionalId");

-- AddForeignKey
ALTER TABLE "ProjetoPapel" ADD CONSTRAINT "ProjetoPapel_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disponibilidade" ADD CONSTRAINT "Disponibilidade_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competencia" ADD CONSTRAINT "Competencia_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Avaliacao" ADD CONSTRAINT "Avaliacao_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recomendacao" ADD CONSTRAINT "Recomendacao_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembroRecomendado" ADD CONSTRAINT "MembroRecomendado_recomendacaoId_fkey" FOREIGN KEY ("recomendacaoId") REFERENCES "Recomendacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembroRecomendado" ADD CONSTRAINT "MembroRecomendado_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Convite" ADD CONSTRAINT "Convite_recomendacaoId_fkey" FOREIGN KEY ("recomendacaoId") REFERENCES "Recomendacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Convite" ADD CONSTRAINT "Convite_projetoId_fkey" FOREIGN KEY ("projetoId") REFERENCES "Projeto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Convite" ADD CONSTRAINT "Convite_profissionalId_fkey" FOREIGN KEY ("profissionalId") REFERENCES "Profissional"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


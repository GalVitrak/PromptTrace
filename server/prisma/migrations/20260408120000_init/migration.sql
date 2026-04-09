-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EvaluationVerdict" AS ENUM ('SAFE', 'BORDERLINE', 'FAILED');

-- CreateTable
CREATE TABLE "test_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "modelNameOrNotes" TEXT,
    "category" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "objective" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_turns" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "turnNumber" INTEGER NOT NULL,
    "generatedPrompt" TEXT NOT NULL,
    "generatedMeta" JSONB,
    "pastedModelResponse" TEXT,
    "evaluationVerdict" "EvaluationVerdict",
    "evaluationScore" INTEGER,
    "evaluationConfidence" INTEGER,
    "evaluationReasoning" TEXT,
    "observedWeakness" TEXT,
    "recommendedNextPrompt" TEXT,
    "heuristicFlags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "test_turns_sessionId_turnNumber_key" ON "test_turns"("sessionId", "turnNumber");

-- AddForeignKey
ALTER TABLE "test_turns" ADD CONSTRAINT "test_turns_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

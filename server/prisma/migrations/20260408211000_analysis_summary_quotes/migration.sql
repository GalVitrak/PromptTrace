-- AlterTable
ALTER TABLE "test_turns" ADD COLUMN "evaluationSummary" TEXT;
ALTER TABLE "test_turns" ADD COLUMN "quotedFailures" JSONB;
ALTER TABLE "test_turns" ADD COLUMN "discriminatoryBias" JSONB;

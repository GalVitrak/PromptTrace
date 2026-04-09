-- AlterTable
ALTER TABLE "test_turns" ADD COLUMN "explicitContentReport" JSONB;
ALTER TABLE "test_turns" ADD COLUMN "misinformationReport" JSONB;
ALTER TABLE "test_turns" ADD COLUMN "categorySpecificReport" JSONB;

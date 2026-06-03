-- Imported KB-card frontmatter (reference-format ingestion).
-- All classification fields are dynamic TEXT (not enums) so future datasets that introduce new
-- pillars / intents / survey statuses need no migration. "frontmatter" keeps the entire original
-- YAML block as a lossless catch-all for anything not promoted to a typed column.
ALTER TABLE "Article" ADD COLUMN "kbId" TEXT;
ALTER TABLE "Article" ADD COLUMN "question" TEXT;
ALTER TABLE "Article" ADD COLUMN "entryKind" TEXT;
ALTER TABLE "Article" ADD COLUMN "intent" TEXT;
ALTER TABLE "Article" ADD COLUMN "productPillar" TEXT;
ALTER TABLE "Article" ADD COLUMN "classification" TEXT;
ALTER TABLE "Article" ADD COLUMN "surveyStatus" TEXT;
ALTER TABLE "Article" ADD COLUMN "appUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "docCanonical" TEXT;
ALTER TABLE "Article" ADD COLUMN "searchAliases" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Article" ADD COLUMN "offers" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Article" ADD COLUMN "similarTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Article" ADD COLUMN "frontmatter" JSONB;

-- kbId is the stable identity of an imported card; unique so re-ingest upserts instead of duplicating.
-- (All existing rows are NULL, and Postgres treats NULLs as distinct, so this is safe to add.)
CREATE UNIQUE INDEX "Article_kbId_key" ON "Article"("kbId");
CREATE INDEX "Article_entryKind_idx" ON "Article"("entryKind");
CREATE INDEX "Article_productPillar_idx" ON "Article"("productPillar");

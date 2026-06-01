-- Flags a (usually bulk-uploaded) draft as a likely duplicate of another article,
-- pending human review. Single uploads resolve duplicates interactively and don't set this.
ALTER TABLE "Article" ADD COLUMN "duplicateOf" TEXT;
ALTER TABLE "Article" ADD COLUMN "duplicateScore" DOUBLE PRECISION;
CREATE INDEX "Article_duplicateOf_idx" ON "Article"("duplicateOf");

-- Settings key/value store (API keys stored encrypted by the app layer)
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- Track which model produced each Article.embedding so we never compare across
-- embedding spaces (local 384-dim vs OpenAI 1536-dim).
ALTER TABLE "Article" ADD COLUMN "embeddingModel" TEXT;

-- Backfill: existing embeddings were produced by the local MiniLM model.
UPDATE "Article" SET "embeddingModel" = 'Xenova/all-MiniLM-L6-v2' WHERE "embedding" IS NOT NULL;

-- Allow vectors of different dimensions to coexist (so the provider can be switched
-- at runtime). Drop the fixed-dimension ANN index and relax the column to an
-- unsized vector. Search becomes exact KNN filtered by embeddingModel, which is
-- well within budget at this scale.
DROP INDEX IF EXISTS "Article_embedding_idx";
ALTER TABLE "Article" ALTER COLUMN "embedding" TYPE vector USING "embedding"::vector;

-- Index used by search to restrict candidates to the active embedding model.
CREATE INDEX "Article_embeddingModel_idx" ON "Article"("embeddingModel");

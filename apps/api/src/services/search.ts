import type { Article } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding, toPgVector } from './embedding.js';

const RRF_K = 60;
const VECTOR_CANDIDATES = 10;
const FTS_CANDIDATES = 10;
// Cosine-similarity floor for pulling in articles beyond the primary, so a multi-topic
// ("combination") question can be answered across more than one article. Tuned for local MiniLM.
const SECONDARY_SIM_FLOOR = 0.4;

interface ScoredRow {
  id: string;
  similarity: number;
  rank: number;
}

interface SearchResult {
  primary: ArticleWithRelations | null;
  // Additional articles relevant to a multi-topic question (empty for single-topic queries).
  supporting: ArticleWithRelations[];
  // The fused top candidates (full data, ranking order) for the chat layer to AI-rerank.
  candidates: ArticleWithRelations[];
  prerequisites: ArticleRef[];
  related: ArticleRef[];
  confidence: number;
  topMatches: { id: string; similarity: number }[];
}

type ArticleWithRelations = Article & {
  steps: { id: string; order: number; title: string; content: string; imageUrl: string | null }[];
  tags: { id: string; name: string }[];
  prerequisites: ArticleRef[];
  relatedTo: ArticleRef[];
};

type ArticleRef = {
  id: string;
  title: string;
  slug: string;
  productArea: Article['productArea'];
  status: Article['status'];
};

export async function hybridSearch(question: string, limit = 5): Promise<SearchResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      primary: null,
      supporting: [],
      candidates: [],
      prerequisites: [],
      related: [],
      confidence: 0,
      topMatches: [],
    };
  }

  // Vector search is an enhancement, not a hard dependency. If the embedding provider is
  // down, rate-limited, or misconfigured, degrade gracefully to full-text search rather
  // than failing the whole request — this path also serves the public chatbot.
  let vectorRows: { id: string; similarity: number }[] = [];
  try {
    const { vector: queryVec, model: activeModel } = await generateEmbedding(trimmed);
    const vecLiteral = toPgVector(queryVec);
    vectorRows = await prisma.$queryRawUnsafe<{ id: string; similarity: number }[]>(
      `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
       FROM "Article"
       WHERE status = 'PUBLISHED' AND embedding IS NOT NULL AND "embeddingModel" = $2
       ORDER BY embedding <=> $1::vector
       LIMIT ${VECTOR_CANDIDATES}`,
      vecLiteral,
      activeModel,
    );
  } catch (err) {
    console.warn(
      '[search] vector lookup unavailable, falling back to full-text only:',
      err instanceof Error ? err.message : err,
    );
  }

  // The searchable document includes the article's STEP text too, so step-level facts
  // (e.g. "logo" living inside a Site Settings step) are findable — not just title/summary/content.
  const ARTICLE_DOC =
    `to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(content,'') || ' ' || ` +
    `coalesce((SELECT string_agg(st.title || ' ' || st.content, ' ') FROM "Step" st WHERE st."articleId" = "Article".id), ''))`;
  const ftsRows = await prisma.$queryRawUnsafe<{ id: string; rank: number }[]>(
    `SELECT id, ts_rank(${ARTICLE_DOC}, plainto_tsquery('english', $1)) AS rank
     FROM "Article"
     WHERE status = 'PUBLISHED'
       AND ${ARTICLE_DOC} @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC
     LIMIT ${FTS_CANDIDATES}`,
    trimmed,
  );

  const fused = fuseRankings(vectorRows, ftsRows, limit);
  const topMatches = vectorRows.map((r) => ({ id: r.id, similarity: r.similarity }));

  if (fused.length === 0) {
    return {
      primary: null,
      supporting: [],
      candidates: [],
      prerequisites: [],
      related: [],
      confidence: 0,
      topMatches,
    };
  }

  const primaryId = fused[0].id;
  // Prefer vector cosine similarity; if it's unavailable (vector search degraded) the primary
  // came from a full-text keyword match, whose `@@` already guarantees relevance — give it a
  // solid baseline so a good keyword hit isn't rejected by the confidence gate.
  const confidence =
    vectorRows.find((r) => r.id === primaryId)?.similarity ?? (ftsRows.length ? 0.5 : 0);

  // Beyond the primary, pull in up to two more articles that are clearly relevant on their own
  // (strong vector similarity), so a multi-topic "combination" question gets every part answered.
  // Off-topic neighbours fall below the floor and are dropped, keeping single-topic answers focused.
  // Load the fused top candidates (full data) so the chat layer can let the AI rerank them.
  const candidateIds = fused.slice(0, 6).map((f) => f.id);
  const loaded = (await prisma.article.findMany({
    where: { id: { in: candidateIds } },
    include: {
      steps: { orderBy: { order: 'asc' } },
      tags: true,
      prerequisites: {
        select: { id: true, title: true, slug: true, productArea: true, status: true },
      },
      relatedTo: {
        select: { id: true, title: true, slug: true, productArea: true, status: true },
      },
    },
  })) as ArticleWithRelations[];

  // Preserve fused ranking order (findMany doesn't guarantee it).
  const byId = new Map(loaded.map((a) => [a.id, a]));
  const candidates = candidateIds
    .map((id) => byId.get(id))
    .filter((a): a is ArticleWithRelations => Boolean(a));

  if (candidates.length === 0) {
    return {
      primary: null,
      supporting: [],
      candidates: [],
      prerequisites: [],
      related: [],
      confidence: 0,
      topMatches,
    };
  }

  // Default (pre-rerank) primary + the strong secondary matches for multi-topic questions.
  const primary = candidates[0];
  const supportingIds = fused
    .slice(1)
    .filter((f) => (vectorRows.find((r) => r.id === f.id)?.similarity ?? 0) >= SECONDARY_SIM_FLOOR)
    .slice(0, 2)
    .map((f) => f.id);
  const supporting = supportingIds
    .map((id) => byId.get(id))
    .filter((a): a is ArticleWithRelations => Boolean(a));

  return {
    primary,
    supporting,
    candidates,
    prerequisites: primary.prerequisites,
    related: primary.relatedTo,
    confidence,
    topMatches,
  };
}

function fuseRankings(
  vector: { id: string; similarity: number }[],
  fts: { id: string; rank: number }[],
  limit: number,
): ScoredRow[] {
  const scores = new Map<string, number>();

  vector.forEach((row, idx) => {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + idx + 1));
  });
  fts.forEach((row, idx) => {
    scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + idx + 1));
  });

  const merged: ScoredRow[] = [];
  for (const [id, fusedScore] of scores) {
    const sim = vector.find((r) => r.id === id)?.similarity ?? 0;
    merged.push({ id, similarity: sim, rank: fusedScore });
  }
  merged.sort((a, b) => b.rank - a.rank);
  return merged.slice(0, limit);
}

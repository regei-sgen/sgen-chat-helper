import type { StructuredArticle, DiffEntry, DuplicateCandidate } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding, toPgVector } from './embedding.js';

// Local MiniLM cosine scores run lower than larger models (same-topic ~0.6-0.95,
// unrelated ~0.3-0.55), and the whole flow is review-gated (single = popup,
// bulk = flag only), so favor recall over precision. Stronger embedding providers
// (OpenAI/Gemini) score higher and more discriminative if tighter matching is wanted.
const SIM_THRESHOLD = 0.6;
const TOP_K = 5;

interface ExistingArticle {
  id: string;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  summary: string | null;
  feature: string | null;
  productArea: string | null;
  difficulty: string | null;
  sgenUrl: string | null;
  content: string;
  steps: { id: string }[];
  tags: { name: string }[];
}

function structuredEmbeddingText(s: StructuredArticle): string {
  return [s.title, s.summary, s.content, s.tags.join(' ')].filter(Boolean).join('\n\n');
}

function field(
  name: string,
  label: string,
  oldVal: string | null | undefined,
  newVal: string | null | undefined,
): DiffEntry {
  const o = oldVal ?? null;
  const n = newVal ?? null;
  return { field: name, label, changed: (o ?? '') !== (n ?? ''), old: o, new: n, note: null };
}

export function buildDiff(existing: ExistingArticle, s: StructuredArticle): DiffEntry[] {
  const entries: DiffEntry[] = [
    field('title', 'Title', existing.title, s.title),
    field('summary', 'Summary', existing.summary, s.summary),
    field('feature', 'Feature', existing.feature, s.feature),
    field('productArea', 'Product area', existing.productArea, s.productArea),
    field('difficulty', 'Difficulty', existing.difficulty, s.difficulty),
    field('sgenUrl', 'SGEN URL', existing.sgenUrl, s.sgenUrl),
  ];

  const oldLen = existing.content?.length ?? 0;
  const newLen = s.content?.length ?? 0;
  entries.push({
    field: 'content',
    label: 'Content',
    changed: existing.content !== s.content,
    old: null,
    new: null,
    note: `${oldLen} → ${newLen} chars`,
  });

  const oldSteps = existing.steps?.length ?? 0;
  const newSteps = s.steps?.length ?? 0;
  entries.push({
    field: 'steps',
    label: 'Steps',
    changed: oldSteps !== newSteps,
    old: null,
    new: null,
    note: `${oldSteps} → ${newSteps} steps`,
  });

  const oldTags = (existing.tags ?? []).map((t) => t.name);
  const newTags = s.tags ?? [];
  const added = newTags.filter((t) => !oldTags.includes(t));
  const removed = oldTags.filter((t) => !newTags.includes(t));
  entries.push({
    field: 'tags',
    label: 'Tags',
    changed: added.length > 0 || removed.length > 0,
    old: oldTags.join(', ') || null,
    new: newTags.join(', ') || null,
    note: added.length || removed.length ? `+${added.length} / -${removed.length}` : null,
  });

  return entries;
}

export async function findDuplicates(
  structured: StructuredArticle,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const { vector, model } = await generateEmbedding(structuredEmbeddingText(structured));
  const vecLiteral = toPgVector(vector);

  const rows = excludeId
    ? await prisma.$queryRawUnsafe<{ id: string; similarity: number }[]>(
        `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
         FROM "Article"
         WHERE embedding IS NOT NULL AND "embeddingModel" = $2 AND id <> $3
         ORDER BY embedding <=> $1::vector
         LIMIT ${TOP_K}`,
        vecLiteral,
        model,
        excludeId,
      )
    : await prisma.$queryRawUnsafe<{ id: string; similarity: number }[]>(
        `SELECT id, 1 - (embedding <=> $1::vector) AS similarity
         FROM "Article"
         WHERE embedding IS NOT NULL AND "embeddingModel" = $2
         ORDER BY embedding <=> $1::vector
         LIMIT ${TOP_K}`,
        vecLiteral,
        model,
      );

  const titleMatch = await prisma.article.findFirst({
    where: {
      title: { equals: structured.title, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  const simById = new Map<string, number>();
  const ids = new Set<string>();
  for (const r of rows) {
    simById.set(r.id, r.similarity);
    if (r.similarity >= SIM_THRESHOLD) ids.add(r.id);
  }
  if (titleMatch) ids.add(titleMatch.id);
  if (ids.size === 0) return [];

  const articles = (await prisma.article.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      summary: true,
      feature: true,
      productArea: true,
      difficulty: true,
      sgenUrl: true,
      content: true,
      steps: { select: { id: true } },
      tags: { select: { name: true } },
    },
  })) as ExistingArticle[];

  const candidates: DuplicateCandidate[] = articles.map((a) => {
    const sim = simById.get(a.id) ?? 0;
    const isTitle = titleMatch?.id === a.id;
    const pct = `${Math.round(sim * 100)}% similar`;
    const matchReason = isTitle ? (sim >= SIM_THRESHOLD ? `${pct} · same title` : 'Same title') : pct;
    return {
      id: a.id,
      title: a.title,
      slug: a.slug,
      status: a.status,
      similarity: sim,
      matchReason,
      diff: buildDiff(a, structured),
    };
  });

  candidates.sort((x, y) => y.similarity - x.similarity);
  return candidates;
}

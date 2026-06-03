import { prisma } from '../lib/prisma.js';
import type { ArticleCreateInput, StructuredArticle } from '@kb/shared';
import { structureArticle, structureAsIs } from './structure.js';
import { createArticle, updateArticle } from './article.js';
import { findDuplicates } from './dedup.js';
import { isKbCard, parseKbCard } from './kb-card.js';

interface ProcessSingleArgs {
  content: string;
  authorId: string;
  autoPublish: boolean;
  // When true, skip AI structuring and store the markdown verbatim (see structureAsIs).
  asIs?: boolean;
  // Original filename — used as a title fallback for the as-is path.
  filename?: string;
}

interface ProcessSingleResult {
  articleId: string;
  slug: string;
  structured: StructuredArticle;
  duplicateOf: string | null;
}

// Maps an AI-structured article to article-create input, resolving suggested
// prerequisite/related titles to existing article ids. Status is set by the caller.
export async function structuredToInput(
  structured: StructuredArticle,
): Promise<Omit<ArticleCreateInput, 'status'>> {
  const prereqMatches = structured.suggestedPrerequisites.length
    ? await prisma.article.findMany({
        where: { title: { in: structured.suggestedPrerequisites } },
        select: { id: true },
      })
    : [];
  const relatedMatches = structured.suggestedRelated.length
    ? await prisma.article.findMany({
        where: { title: { in: structured.suggestedRelated } },
        select: { id: true },
      })
    : [];
  return {
    title: structured.title,
    summary: structured.summary,
    content: structured.content,
    feature: structured.feature,
    productArea: structured.productArea,
    difficulty: structured.difficulty,
    sgenUrl: structured.sgenUrl,
    steps: structured.steps.map((s) => ({
      order: s.order,
      title: s.title,
      content: s.content,
      imageUrl: null,
    })),
    tags: structured.tags,
    prerequisiteIds: prereqMatches.map((p) => p.id),
    relatedIds: relatedMatches.map((p) => p.id),
  };
}

// Present a parsed KB card in the StructuredArticle shape the /upload + /analyze responses expect,
// so the existing review UI keeps working without an AI round-trip.
export function kbCardToStructured(input: Omit<ArticleCreateInput, 'status'>): StructuredArticle {
  return {
    title: input.title,
    summary: input.summary || input.question || input.title,
    feature: input.feature ?? null,
    productArea: input.productArea ?? null,
    difficulty: input.difficulty ?? null,
    content: input.content,
    steps: (input.steps ?? []).map((s, i) => ({
      order: s.order ?? i,
      title: s.title,
      content: s.content,
    })),
    tags: input.tags ?? [],
    suggestedPrerequisites: [],
    suggestedRelated: [],
    sgenUrl: input.sgenUrl ?? null,
  };
}

export async function processSingleMarkdown(
  args: ProcessSingleArgs,
): Promise<ProcessSingleResult> {
  // 1) PRIORITY PATH: a reference KB card (rich frontmatter) is ingested DIRECTLY — no AI, lossless.
  //    Re-ingesting the same kb_id OVERRIDES the existing record (idempotent) rather than duplicating.
  //    This wins regardless of the AI toggle: the authored, QA-verified structure is the source of truth.
  if (isKbCard(args.content)) {
    let parsed: ReturnType<typeof parseKbCard> | null = null;
    try {
      parsed = parseKbCard(args.content, args.filename);
    } catch (err) {
      // Looked like a card but the YAML failed to parse — fall through to the AI / as-is path.
      console.warn(
        '[upload] KB-card frontmatter parse failed, falling back:',
        err instanceof Error ? err.message : err,
      );
    }
    if (parsed) {
      const status = args.autoPublish ? 'PUBLISHED' : 'DRAFT';
      const existing = parsed.kbId
        ? await prisma.article.findUnique({ where: { kbId: parsed.kbId }, select: { id: true } })
        : null;
      const article = existing
        ? await updateArticle(existing.id, { ...parsed.input, status })
        : await createArticle({ ...parsed.input, status }, args.authorId);
      return {
        articleId: article.id,
        slug: article.slug,
        structured: kbCardToStructured(parsed.input),
        duplicateOf: null,
      };
    }
  }

  // 2) PLAIN MARKDOWN: AI structuring is a toggle. "Upload as is" → build deterministically with NO
  // AI. Otherwise structure it with the local Claude Code CLI (which needs existing titles to
  // suggest prerequisites/related).
  let structured: StructuredArticle;
  if (args.asIs) {
    structured = structureAsIs(args.content, args.filename);
  } else {
    const existing = await prisma.article.findMany({
      select: { title: true },
      where: { status: 'PUBLISHED' },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    structured = await structureArticle(
      args.content,
      existing.map((a) => a.title),
    );
  }

  // Detect near-duplicates BEFORE creating, so bulk can flag for review instead
  // of overriding automatically.
  const candidates = await findDuplicates(structured);

  const input = await structuredToInput(structured);
  const article = await createArticle(
    { ...input, status: args.autoPublish ? 'PUBLISHED' : 'DRAFT' },
    args.authorId,
  );

  const top = candidates[0];
  if (top) {
    await prisma.article.update({
      where: { id: article.id },
      data: { duplicateOf: top.id, duplicateScore: top.similarity },
    });
  }

  return { articleId: article.id, slug: article.slug, structured, duplicateOf: top?.id ?? null };
}

export async function recordJobProgress(
  jobId: string,
  outcome: 'completed' | 'failed',
  errorInfo?: { file: string; message: string },
) {
  // Append the error atomically (jsonb concat) so concurrent failures don't clobber it.
  if (errorInfo) {
    await prisma.$executeRawUnsafe(
      `UPDATE "UploadJob" SET errors = COALESCE(errors, '[]'::jsonb) || $1::jsonb WHERE id = $2`,
      JSON.stringify([errorInfo]),
      jobId,
    );
  }

  // Atomic increment — avoids the lost-update race when the worker finishes
  // multiple files concurrently (which previously left the job stuck PROCESSING).
  const job = await prisma.uploadJob
    .update({
      where: { id: jobId },
      data: {
        status: 'PROCESSING',
        completed: outcome === 'completed' ? { increment: 1 } : undefined,
        failed: outcome === 'failed' ? { increment: 1 } : undefined,
      },
    })
    .catch(() => null);
  if (!job) return; // job no longer exists

  if (job.completed + job.failed >= job.total) {
    await prisma.uploadJob.update({
      where: { id: jobId },
      data: {
        status: job.failed > 0 && job.completed === 0 ? 'FAILED' : 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
}

import { prisma } from '../lib/prisma.js';
import type { ArticleCreateInput, StructuredArticle } from '@kb/shared';
import { structureArticle } from './structure.js';
import { createArticle } from './article.js';
import { findDuplicates } from './dedup.js';

interface ProcessSingleArgs {
  content: string;
  authorId: string;
  autoPublish: boolean;
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

export async function processSingleMarkdown(
  args: ProcessSingleArgs,
): Promise<ProcessSingleResult> {
  const existing = await prisma.article.findMany({
    select: { title: true },
    where: { status: 'PUBLISHED' },
    take: 200,
    orderBy: { createdAt: 'desc' },
  });
  const titles = existing.map((a) => a.title);

  const structured = await structureArticle(args.content, titles);

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

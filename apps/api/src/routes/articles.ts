import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import {
  ArticleCreateSchema,
  ArticleListQuerySchema,
  ArticleUpdateSchema,
  ApplyRequestSchema,
  ResolveDuplicateSchema,
  AutoLinkApplyRequestSchema,
  BulkArticleActionSchema,
  BulkAllActionSchema,
  UploadOptionsSchema,
} from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { BadRequest, Unauthorized } from '../lib/errors.js';
import {
  createArticle,
  deleteArticle,
  findArticleOrFail,
  publishArticle,
  updateArticle,
  ARTICLE_INCLUDE,
} from '../services/article.js';
import {
  processSingleMarkdown,
  structuredToInput,
  kbCardToStructured,
} from '../services/upload-processor.js';
import { structureArticle, structureAsIs } from '../services/structure.js';
import { isKbCard, parseKbCard } from '../services/kb-card.js';
import { findDuplicates } from '../services/dedup.js';
import { analyzeRelationships, applyArrangement, analyzeAndApply } from '../services/auto-link.js';
import { previewVectorArrangement, applyVectorArrangement } from '../services/vector-arranger.js';
import { uploadQueue } from '../lib/queue.js';

export async function articleRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (request, reply) => {
    const query = ArticleListQuerySchema.parse(request.query);
    const where: Prisma.ArticleWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.productArea) where.productArea = query.productArea;
    if (query.feature) where.feature = { contains: query.feature, mode: 'insensitive' };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.duplicates) where.duplicateOf = { not: null };
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { summary: { contains: query.search, mode: 'insensitive' } },
        { content: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      prisma.article.findMany({
        where,
        include: ARTICLE_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.article.count({ where }),
    ]);

    return reply.send({ items, total, page: query.page, pageSize: query.pageSize });
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const article = await findArticleOrFail(id);
    return reply.send(article);
  });

  app.post('/', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = ArticleCreateSchema.parse(request.body);
    const created = await createArticle(body, request.user.sub);
    return reply.status(201).send(created);
  });

  // Bulk action over a set of selected articles. Each item is processed independently so a
  // single failure (e.g. already-deleted id) doesn't abort the rest; failures are reported back.
  app.post('/bulk', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const userId = request.user.sub;
    const { ids, action } = BulkArticleActionSchema.parse(request.body);
    const uniqueIds = Array.from(new Set(ids));

    const failed: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of uniqueIds) {
      try {
        if (action === 'publish') await publishArticle(id, userId);
        else if (action === 'draft') await updateArticle(id, { status: 'DRAFT' });
        else if (action === 'archive') await updateArticle(id, { status: 'ARCHIVED' });
        else await deleteArticle(id);
        succeeded++;
      } catch (err) {
        failed.push({ id, message: err instanceof Error ? err.message : String(err) });
      }
    }

    return reply.send({ action, requested: uniqueIds.length, succeeded, failed });
  });

  // Apply an action to EVERY article matching the given filter, server-side — powers "Publish all"
  // / "Delete all". Unlike /bulk (a capped id list), this is NOT limited to the rows the client has
  // loaded on the current page; it acts on the whole filtered set in one query.
  app.post('/bulk-all', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const { action, filter } = BulkAllActionSchema.parse(request.body ?? {});

    // Mirror the GET / list filter so "all matching" means exactly what the list is showing.
    const where: Prisma.ArticleWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.productArea) where.productArea = filter.productArea;
    if (filter.feature) where.feature = { contains: filter.feature, mode: 'insensitive' };
    if (filter.categoryId) where.categoryId = filter.categoryId;
    if (filter.duplicates) where.duplicateOf = { not: null };
    if (filter.search) {
      where.OR = [
        { title: { contains: filter.search, mode: 'insensitive' } },
        { summary: { contains: filter.search, mode: 'insensitive' } },
        { content: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    let affected: number;
    if (action === 'delete') {
      // Steps cascade via their DB FK; tag / prerequisite / related join rows cascade via Prisma's
      // implicit m2m relation tables — so one deleteMany cleans everything up.
      affected = (await prisma.article.deleteMany({ where })).count;
    } else {
      const status =
        action === 'publish' ? 'PUBLISHED' : action === 'draft' ? 'DRAFT' : 'ARCHIVED';
      const data: Prisma.ArticleUpdateManyMutationInput = { status };
      if (action === 'publish') {
        data.reviewedAt = new Date();
        data.reviewedBy = request.user.sub;
      }
      affected = (await prisma.article.updateMany({ where, data })).count;
    }
    return reply.send({ action, affected });
  });

  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ArticleUpdateSchema.parse(request.body);
    const updated = await updateArticle(id, body);
    return reply.send(updated);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteArticle(id);
    return reply.status(204).send();
  });

  app.post('/:id/publish', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const { id } = request.params as { id: string };
    const published = await publishArticle(id, request.user.sub);
    return reply.send(published);
  });

  app.post('/:id/restructure', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const { id } = request.params as { id: string };
    const article = await findArticleOrFail(id);
    const result = await processSingleMarkdown({
      content: article.content,
      authorId: request.user.sub,
      autoPublish: false,
    });
    return reply.send({ structured: result.structured });
  });

  // Structure an uploaded file and find near-duplicates WITHOUT saving (review step).
  app.post('/analyze', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const data = await request.file();
    if (!data) throw BadRequest('No file provided');
    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    if (!content.trim()) throw BadRequest('Uploaded file is empty');

    // PRIORITY: a reference KB card (rich frontmatter) is parsed directly — no AI, no dedup
    // (re-ingest is idempotent by kbId at /apply). `card` carries the full parsed input so /apply
    // persists every frontmatter field losslessly.
    if (isKbCard(content)) {
      try {
        const { input } = parseKbCard(content, data.filename);
        return reply.send({ structured: kbCardToStructured(input), candidates: [], card: input });
      } catch (err) {
        request.log.warn(
          `[analyze] KB-card parse failed, falling back to AI/as-is: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // "Upload as is" (no AI) is requested via an `asIs` form field sent alongside the file.
    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const asIs = String(fields.asIs?.value ?? 'false').toLowerCase() === 'true';
    let structured: Awaited<ReturnType<typeof structureArticle>>;
    if (asIs) {
      structured = structureAsIs(content, data.filename);
    } else {
      const existing = await prisma.article.findMany({
        select: { title: true },
        where: { status: 'PUBLISHED' },
        take: 200,
        orderBy: { createdAt: 'desc' },
      });
      structured = await structureArticle(
        content,
        existing.map((a) => a.title),
      );
    }
    const candidates = await findDuplicates(structured);
    return reply.send({ structured, candidates });
  });

  // Apply a reviewed structured article: create new, or override an existing one.
  app.post('/apply', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = ApplyRequestSchema.parse(request.body);

    // Reference KB card → ingest the parsed frontmatter directly, upserting by kbId so re-applying
    // the same card OVERRIDES its record instead of duplicating. All frontmatter fields persist.
    if (body.card) {
      const card = body.card;
      const status = body.autoPublish ? ('PUBLISHED' as const) : ('DRAFT' as const);
      const existing = card.kbId
        ? await prisma.article.findUnique({ where: { kbId: card.kbId }, select: { id: true } })
        : null;
      if (existing) {
        const updated = await updateArticle(existing.id, { ...card, status });
        return reply.send(updated);
      }
      const created = await createArticle({ ...card, status }, request.user.sub);
      return reply.status(201).send(created);
    }

    const input = await structuredToInput(body.structured);

    if (body.action === 'override') {
      if (!body.targetId) throw BadRequest('targetId is required for override');
      const updated = await updateArticle(
        body.targetId,
        body.autoPublish ? { ...input, status: 'PUBLISHED' } : input,
      );
      return reply.send(updated);
    }

    const created = await createArticle(
      { ...input, status: body.autoPublish ? 'PUBLISHED' : 'DRAFT' },
      request.user.sub,
    );
    return reply.status(201).send(created);
  });

  // Resolve a bulk-flagged duplicate draft: override the original with it, or dismiss the flag.
  app.post('/:id/resolve-duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = ResolveDuplicateSchema.parse(request.body);
    const draft = await findArticleOrFail(id);
    if (!draft.duplicateOf) throw BadRequest('This article is not flagged as a duplicate');

    if (body.action === 'dismiss') {
      await prisma.article.update({
        where: { id },
        data: { duplicateOf: null, duplicateScore: null },
      });
      return reply.send(await findArticleOrFail(id));
    }

    const targetId = draft.duplicateOf;
    const updated = await updateArticle(targetId, {
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      feature: draft.feature,
      productArea: draft.productArea,
      difficulty: draft.difficulty,
      sgenUrl: draft.sgenUrl,
      steps: draft.steps.map((s) => ({
        order: s.order,
        title: s.title,
        content: s.content,
        imageUrl: s.imageUrl,
      })),
      tags: draft.tags.map((t) => t.name),
      prerequisiteIds: draft.prerequisites.map((p) => p.id),
      relatedIds: draft.relatedTo.map((p) => p.id),
    });
    await deleteArticle(id);
    return reply.send(updated);
  });

  // AI auto-arrange: analyze all articles and propose/apply prerequisite + related links.
  app.post('/auto-link/preview', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    return reply.send(await analyzeRelationships());
  });

  app.post('/auto-link/apply', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = AutoLinkApplyRequestSchema.parse(request.body ?? {});
    if (body.proposals && body.proposals.length > 0) {
      const { updated } = await applyArrangement(body.proposals);
      return reply.send({ updated });
    }
    return reply.send(await analyzeAndApply());
  });

  // No-AI auto-arrange: connect articles purely by stored-embedding similarity (pgvector). Scales to
  // any corpus with no token limits / API cost, and is non-destructive (only ADDS related links,
  // never touches prerequisites). Apply recomputes server-side, so it ignores any client payload.
  app.post('/auto-link/vector/preview', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    return reply.send(await previewVectorArrangement());
  });

  app.post('/auto-link/vector/apply', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    return reply.send(await applyVectorArrangement());
  });

  app.post('/upload', async (request, reply) => {
    if (!request.user) throw Unauthorized();

    const data = await request.file();
    if (!data) throw BadRequest('No file provided');
    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    if (!content.trim()) throw BadRequest('Uploaded file is empty');

    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const { autoPublish, asIs } = UploadOptionsSchema.parse({
      autoPublish: fields.autoPublish?.value ?? 'false',
      asIs: fields.asIs?.value ?? 'false',
    });

    const result = await processSingleMarkdown({
      content,
      authorId: request.user.sub,
      autoPublish,
      asIs,
      filename: data.filename,
    });

    const article = await findArticleOrFail(result.articleId);
    return reply.status(201).send({ article, structured: result.structured });
  });

  // Bulk upload, chunk-friendly. The client splits a large selection into small batches so a
  // 1000-file import never rides on one giant multipart request (which 413s at the multipart
  // `parts` limit and is a single point of failure). The FIRST chunk omits `jobId` and passes
  // `expectedTotal` (the grand total) so the job is created sized to the whole import and the worker
  // can't mark it complete after just the first batch. Later chunks pass `jobId` and append. A
  // single-shot upload (no jobId, no expectedTotal) still works: it's just a one-batch job.
  app.post('/upload-bulk', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const userId = request.user.sub;

    const files: { filename: string; content: string }[] = [];
    let autoPublish = false;
    let asIs = false;
    let jobId: string | null = null;
    let expectedTotal: number | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        files.push({ filename: part.filename, content: buf.toString('utf-8') });
      } else if (part.fieldname === 'autoPublish') {
        autoPublish = String(part.value).toLowerCase() === 'true';
      } else if (part.fieldname === 'asIs') {
        asIs = String(part.value).toLowerCase() === 'true';
      } else if (part.fieldname === 'jobId') {
        jobId = String(part.value);
      } else if (part.fieldname === 'expectedTotal') {
        const n = Number(part.value);
        if (Number.isFinite(n) && n > 0) expectedTotal = Math.floor(n);
      }
    }

    if (files.length === 0) throw BadRequest('No files provided');

    let job;
    if (jobId) {
      // Append this chunk to an existing job (total stays the grand total set by the first chunk).
      job = await prisma.uploadJob.findUnique({ where: { id: jobId } });
      if (!job) throw BadRequest('Upload job not found');
      if (job.createdBy !== userId) throw Unauthorized();
    } else {
      job = await prisma.uploadJob.create({
        data: {
          total: Math.max(expectedTotal ?? files.length, files.length),
          createdBy: userId,
          status: 'PENDING',
        },
      });
    }

    await Promise.all(
      files.map((f) =>
        uploadQueue.add('process', {
          jobId: job.id,
          filename: f.filename,
          content: f.content,
          authorId: userId,
          autoPublish,
          asIs,
        }),
      ),
    );

    return reply.status(202).send({ jobId: job.id, total: job.total });
  });

  // Finalize a chunked upload: reconcile the job's total to however many files were actually
  // enqueued (some chunks may have failed to upload) and mark it done if everything has already
  // processed. Idempotent and safe to call in the happy path (where it's a no-op confirmation).
  app.post('/upload-bulk/:jobId/finalize', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { total?: number };

    const job = await prisma.uploadJob.findUnique({ where: { id: jobId } });
    if (!job) throw BadRequest('Upload job not found');
    if (job.createdBy !== request.user.sub) throw Unauthorized();

    // Never set total below what's already been processed, or the job could never reconcile.
    const processed = job.completed + job.failed;
    const total =
      typeof body.total === 'number' && body.total > 0
        ? Math.max(Math.floor(body.total), processed)
        : job.total;
    const done = processed >= total;

    const updated = await prisma.uploadJob.update({
      where: { id: jobId },
      data: {
        total,
        ...(done
          ? {
              status: job.failed > 0 && job.completed === 0 ? 'FAILED' : 'COMPLETED',
              completedAt: new Date(),
            }
          : {}),
      },
    });
    return reply.send(updated);
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.uploadJob.findUnique({ where: { id } });
    if (!job) throw BadRequest('Job not found');
    return reply.send(job);
  });
}

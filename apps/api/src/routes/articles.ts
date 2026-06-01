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
import { processSingleMarkdown, structuredToInput } from '../services/upload-processor.js';
import { structureArticle } from '../services/structure.js';
import { findDuplicates } from '../services/dedup.js';
import { analyzeRelationships, applyArrangement, analyzeAndApply } from '../services/auto-link.js';
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

    const existing = await prisma.article.findMany({
      select: { title: true },
      where: { status: 'PUBLISHED' },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
    const structured = await structureArticle(
      content,
      existing.map((a) => a.title),
    );
    const candidates = await findDuplicates(structured);
    return reply.send({ structured, candidates });
  });

  // Apply a reviewed structured article: create new, or override an existing one.
  app.post('/apply', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = ApplyRequestSchema.parse(request.body);
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

  app.post('/upload', async (request, reply) => {
    if (!request.user) throw Unauthorized();

    const data = await request.file();
    if (!data) throw BadRequest('No file provided');
    const buffer = await data.toBuffer();
    const content = buffer.toString('utf-8');
    if (!content.trim()) throw BadRequest('Uploaded file is empty');

    const fields = data.fields as Record<string, { value?: string } | undefined>;
    const autoPublishRaw = fields.autoPublish?.value;
    const { autoPublish } = UploadOptionsSchema.parse({ autoPublish: autoPublishRaw ?? 'false' });

    const result = await processSingleMarkdown({
      content,
      authorId: request.user.sub,
      autoPublish,
    });

    const article = await findArticleOrFail(result.articleId);
    return reply.status(201).send({ article, structured: result.structured });
  });

  app.post('/upload-bulk', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const userId = request.user.sub;

    const files: { filename: string; content: string }[] = [];
    let autoPublish = false;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        files.push({ filename: part.filename, content: buf.toString('utf-8') });
      } else if (part.fieldname === 'autoPublish') {
        autoPublish = String(part.value).toLowerCase() === 'true';
      }
    }

    if (files.length === 0) throw BadRequest('No files provided');

    const job = await prisma.uploadJob.create({
      data: {
        total: files.length,
        createdBy: userId,
        status: 'PENDING',
      },
    });

    await Promise.all(
      files.map((f) =>
        uploadQueue.add('process', {
          jobId: job.id,
          filename: f.filename,
          content: f.content,
          authorId: userId,
          autoPublish,
        }),
      ),
    );

    return reply.status(202).send({ jobId: job.id, total: files.length });
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = await prisma.uploadJob.findUnique({ where: { id } });
    if (!job) throw BadRequest('Job not found');
    return reply.send(job);
  });
}

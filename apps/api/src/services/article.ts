import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { generateEmbedding, toPgVector } from './embedding.js';
import { getActiveEmbeddingModel } from './settings.js';
import { uniqueArticleSlug } from '../lib/slug.js';
import { NotFound } from '../lib/errors.js';
import type {
  ArticleCreateInput,
  ArticleUpdateInput,
} from '@kb/shared';

const ARTICLE_INCLUDE = {
  steps: { orderBy: { order: 'asc' as const } },
  tags: true,
  category: true,
  prerequisites: {
    select: { id: true, title: true, slug: true, productArea: true, status: true },
  },
  relatedTo: {
    select: { id: true, title: true, slug: true, productArea: true, status: true },
  },
};

export async function findArticleOrFail(id: string) {
  const article = await prisma.article.findUnique({
    where: { id },
    include: ARTICLE_INCLUDE,
  });
  if (!article) throw NotFound(`Article ${id} not found`);
  return article;
}

export async function findArticleBySlug(slug: string) {
  return prisma.article.findUnique({
    where: { slug },
    include: ARTICLE_INCLUDE,
  });
}

function embeddingText(args: {
  title: string;
  summary?: string | null;
  content: string;
  tags?: string[];
  steps?: { title: string; content: string }[];
}): string {
  const stepText = (args.steps ?? []).map((s) => `${s.title}. ${s.content}`).join('\n');
  return [args.title, args.summary ?? '', args.content, stepText, (args.tags ?? []).join(' ')]
    .filter(Boolean)
    .join('\n\n');
}

async function setEmbedding(articleId: string, text: string) {
  const { vector, model } = await generateEmbedding(text);
  await prisma.$executeRawUnsafe(
    `UPDATE "Article" SET "embedding" = $1::vector, "embeddingModel" = $2 WHERE id = $3`,
    toPgVector(vector),
    model,
    articleId,
  );
}

async function upsertTags(names: string[]): Promise<{ id: string }[]> {
  if (names.length === 0) return [];
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  return Promise.all(
    unique.map((name) =>
      prisma.tag.upsert({
        where: { name },
        create: { name },
        update: {},
        select: { id: true },
      }),
    ),
  );
}

export async function createArticle(input: ArticleCreateInput, authorId: string) {
  const slug = input.slug ?? (await uniqueArticleSlug(input.title));
  const tagRecords = await upsertTags(input.tags);

  const data: Prisma.ArticleCreateInput = {
    title: input.title,
    slug,
    summary: input.summary ?? null,
    content: input.content,
    feature: input.feature ?? null,
    productArea: input.productArea ?? null,
    difficulty: input.difficulty ?? null,
    sgenUrl: input.sgenUrl ?? null,
    status: input.status,
    category: input.categoryId ? { connect: { id: input.categoryId } } : undefined,
    author: { connect: { id: authorId } },
    tags: { connect: tagRecords.map((t) => ({ id: t.id })) },
    prerequisites: { connect: input.prerequisiteIds.map((id) => ({ id })) },
    relatedTo: { connect: input.relatedIds.map((id) => ({ id })) },
    steps: {
      create: input.steps.map((s, idx) => ({
        order: s.order ?? idx,
        title: s.title,
        content: s.content,
        imageUrl: s.imageUrl ?? null,
      })),
    },
  };

  const created = await prisma.article.create({ data, include: ARTICLE_INCLUDE });

  await setEmbedding(
    created.id,
    embeddingText({
      title: created.title,
      summary: created.summary,
      content: created.content,
      tags: created.tags.map((t) => t.name),
      steps: created.steps,
    }),
  );

  return findArticleOrFail(created.id);
}

export async function updateArticle(id: string, input: ArticleUpdateInput) {
  const existing = await findArticleOrFail(id);

  const data: Prisma.ArticleUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.slug !== undefined && input.slug && input.slug !== existing.slug) {
    data.slug = input.slug;
  } else if (input.title !== undefined && input.title !== existing.title && !input.slug) {
    data.slug = await uniqueArticleSlug(input.title, id);
  }
  if (input.summary !== undefined) data.summary = input.summary;
  if (input.content !== undefined) data.content = input.content;
  if (input.feature !== undefined) data.feature = input.feature;
  if (input.productArea !== undefined) data.productArea = input.productArea;
  if (input.difficulty !== undefined) data.difficulty = input.difficulty;
  if (input.sgenUrl !== undefined) data.sgenUrl = input.sgenUrl;
  if (input.status !== undefined) data.status = input.status;
  if (input.categoryId !== undefined) {
    data.category = input.categoryId
      ? { connect: { id: input.categoryId } }
      : { disconnect: true };
  }

  if (input.tags !== undefined) {
    const tagRecords = await upsertTags(input.tags);
    data.tags = { set: tagRecords.map((t) => ({ id: t.id })) };
  }
  if (input.prerequisiteIds !== undefined) {
    data.prerequisites = { set: input.prerequisiteIds.map((pid) => ({ id: pid })) };
  }
  if (input.relatedIds !== undefined) {
    data.relatedTo = { set: input.relatedIds.map((pid) => ({ id: pid })) };
  }

  if (input.steps !== undefined) {
    await prisma.step.deleteMany({ where: { articleId: id } });
    data.steps = {
      create: input.steps.map((s, idx) => ({
        order: s.order ?? idx,
        title: s.title,
        content: s.content,
        imageUrl: s.imageUrl ?? null,
      })),
    };
  }

  await prisma.article.update({ where: { id }, data });

  const contentChanged =
    input.content !== undefined ||
    input.title !== undefined ||
    input.summary !== undefined ||
    input.tags !== undefined ||
    input.steps !== undefined;

  if (contentChanged) {
    const fresh = await findArticleOrFail(id);
    await setEmbedding(
      id,
      embeddingText({
        title: fresh.title,
        summary: fresh.summary,
        content: fresh.content,
        tags: fresh.tags.map((t) => t.name),
        steps: fresh.steps,
      }),
    );
  }

  return findArticleOrFail(id);
}

export async function deleteArticle(id: string) {
  await findArticleOrFail(id);
  await prisma.article.delete({ where: { id } });
}

export async function publishArticle(id: string, userId: string) {
  await findArticleOrFail(id);
  await prisma.article.update({
    where: { id },
    data: {
      status: 'PUBLISHED',
      reviewedAt: new Date(),
      reviewedBy: userId,
    },
  });
  return findArticleOrFail(id);
}

export async function reembedAllArticles(): Promise<{
  reembedded: number;
  failed: number;
  model: string;
}> {
  const model = await getActiveEmbeddingModel();
  const articles = await prisma.article.findMany({
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      tags: { select: { name: true } },
      steps: { select: { title: true, content: true }, orderBy: { order: 'asc' } },
    },
  });
  let reembedded = 0;
  let failed = 0;
  for (const a of articles) {
    try {
      await setEmbedding(
        a.id,
        embeddingText({
          title: a.title,
          summary: a.summary,
          content: a.content,
          tags: a.tags.map((t) => t.name),
          steps: a.steps,
        }),
      );
      reembedded++;
    } catch (err) {
      console.error(`[reembed] failed for article ${a.id}:`, err);
      failed++;
    }
  }
  return { reembedded, failed, model };
}

export { ARTICLE_INCLUDE, embeddingText, setEmbedding, upsertTags };

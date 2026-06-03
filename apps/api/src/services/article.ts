import { Prisma } from '@prisma/client';
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
  question?: string | null;
  summary?: string | null;
  content: string;
  tags?: string[];
  searchAliases?: string[];
  steps?: { title: string; content: string }[];
}): string {
  const stepText = (args.steps ?? []).map((s) => `${s.title}. ${s.content}`).join('\n');
  // Put the canonical question and the search_aliases near the top: the chat does cosine-similarity
  // retrieval, so embedding the exact phrasings a user is likely to TYPE ("make site live", "launch
  // my site") makes those queries land on this article even when the body never uses those words.
  return [
    args.title,
    args.question ?? '',
    args.summary ?? '',
    (args.searchAliases ?? []).join('\n'),
    args.content,
    stepText,
    (args.tags ?? []).join(' '),
  ]
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

// Prisma's upsert is NOT atomic — it SELECTs then INSERTs — so two concurrent ingests creating the
// SAME new tag both miss the SELECT and one hits a unique-violation (P2002) on Tag.name. Bulk uploads
// process files concurrently and reference cards share many tags ("add", "blog", "what", …), so this
// race is common (it failed 25/805 files on the sg-admin import). On P2002 the row now exists — fetch
// it instead of failing the whole article.
async function upsertOneTag(name: string): Promise<{ id: string }> {
  try {
    return await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.tag.findUnique({ where: { name }, select: { id: true } });
      if (existing) return existing;
    }
    throw err;
  }
}

async function upsertTags(names: string[]): Promise<{ id: string }[]> {
  if (names.length === 0) return [];
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)));
  return Promise.all(unique.map(upsertOneTag));
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
    // ---- Imported KB-card frontmatter ----
    kbId: input.kbId ?? null,
    question: input.question ?? null,
    entryKind: input.entryKind ?? null,
    intent: input.intent ?? null,
    productPillar: input.productPillar ?? null,
    classification: input.classification ?? null,
    surveyStatus: input.surveyStatus ?? null,
    appUrl: input.appUrl ?? null,
    docCanonical: input.docCanonical ?? null,
    searchAliases: input.searchAliases ?? [],
    offers: input.offers ?? [],
    similarTopics: input.similarTopics ?? [],
    frontmatter:
      input.frontmatter == null ? undefined : (input.frontmatter as Prisma.InputJsonValue),
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
      question: created.question,
      summary: created.summary,
      content: created.content,
      tags: created.tags.map((t) => t.name),
      searchAliases: created.searchAliases,
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
  // ---- Imported KB-card frontmatter (re-ingest overrides the matching kbId record) ----
  if (input.kbId !== undefined) data.kbId = input.kbId;
  if (input.question !== undefined) data.question = input.question;
  if (input.entryKind !== undefined) data.entryKind = input.entryKind;
  if (input.intent !== undefined) data.intent = input.intent;
  if (input.productPillar !== undefined) data.productPillar = input.productPillar;
  if (input.classification !== undefined) data.classification = input.classification;
  if (input.surveyStatus !== undefined) data.surveyStatus = input.surveyStatus;
  if (input.appUrl !== undefined) data.appUrl = input.appUrl;
  if (input.docCanonical !== undefined) data.docCanonical = input.docCanonical;
  if (input.searchAliases !== undefined) data.searchAliases = { set: input.searchAliases };
  if (input.offers !== undefined) data.offers = { set: input.offers };
  if (input.similarTopics !== undefined) data.similarTopics = { set: input.similarTopics };
  if (input.frontmatter !== undefined) {
    data.frontmatter =
      input.frontmatter == null ? Prisma.DbNull : (input.frontmatter as Prisma.InputJsonValue);
  }
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
    input.question !== undefined ||
    input.searchAliases !== undefined ||
    input.tags !== undefined ||
    input.steps !== undefined;

  if (contentChanged) {
    const fresh = await findArticleOrFail(id);
    await setEmbedding(
      id,
      embeddingText({
        title: fresh.title,
        question: fresh.question,
        summary: fresh.summary,
        content: fresh.content,
        tags: fresh.tags.map((t) => t.name),
        searchAliases: fresh.searchAliases,
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
      question: true,
      summary: true,
      content: true,
      searchAliases: true,
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
          question: a.question,
          summary: a.summary,
          content: a.content,
          tags: a.tags.map((t) => t.name),
          searchAliases: a.searchAliases,
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

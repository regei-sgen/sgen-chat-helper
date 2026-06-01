import type { FastifyInstance } from 'fastify';
import { ArticleQueryRequestSchema, BotFeedbackSchema, ChatRequestSchema } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { hybridSearch } from '../services/search.js';
import { chat } from '../services/chat.js';
import { NotFound, BadRequest } from '../lib/errors.js';
import { findArticleBySlug } from '../services/article.js';

export async function botRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireApiKey);

  app.post('/query', async (request, reply) => {
    const body = ArticleQueryRequestSchema.parse(request.body);
    const result = await hybridSearch(body.question);

    const botQuery = await prisma.botQuery.create({
      data: {
        question: body.question,
        matchedId: result.primary?.id ?? null,
        confidence: result.confidence,
        apiKeyId: request.apiKey?.id ?? null,
      },
    });

    return reply.send({
      queryId: botQuery.id,
      primary: result.primary,
      prerequisites: result.prerequisites,
      related: result.related,
      confidence: result.confidence,
    });
  });

  // Conversational endpoint: the AI decides whether to consult the knowledge base,
  // then composes a grounded reply (handles greetings/off-topic gracefully).
  app.post('/chat', async (request, reply) => {
    const body = ChatRequestSchema.parse(request.body);
    const result = await chat(body.message, body.history);
    const botQuery = await prisma.botQuery.create({
      data: {
        question: body.message,
        matchedId: result.matchedId,
        confidence: result.confidence,
        apiKeyId: request.apiKey?.id ?? null,
      },
    });
    return reply.send({
      reply: result.reply,
      usedKnowledgeBase: result.usedKnowledgeBase,
      sources: result.sources,
      links: result.links,
      followups: result.followups,
      walkthrough: result.walkthrough ?? null,
      confidence: result.confidence,
      queryId: botQuery.id,
    });
  });

  // Starter suggestions for an empty chat: a welcome line + clickable topic buttons
  // built from your published knowledge base.
  app.get('/suggestions', async (_request, reply) => {
    const articles = await prisma.article.findMany({
      where: { status: 'PUBLISHED' },
      select: { title: true, feature: true },
      orderBy: { createdAt: 'asc' },
      take: 6,
    });
    return reply.send({
      welcome:
        "Hi! I'm the SGEN Help Assistant. Ask me anything about your SGEN site — or pick a topic to get started:",
      suggestions: articles.map((a) => ({ label: a.feature || a.title, message: a.title })),
    });
  });

  app.get('/articles/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const article = await findArticleBySlug(slug);
    if (!article || article.status !== 'PUBLISHED') {
      throw NotFound('Article not found');
    }
    return reply.send(article);
  });

  app.post('/feedback', async (request, reply) => {
    const body = BotFeedbackSchema.parse(request.body);
    const query = await prisma.botQuery.findUnique({ where: { id: body.queryId } });
    if (!query) throw BadRequest('Unknown queryId');
    await prisma.botQuery.update({
      where: { id: body.queryId },
      data: { helpful: body.helpful },
    });
    return reply.send({ ok: true });
  });
}

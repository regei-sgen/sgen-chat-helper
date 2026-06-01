import type { FastifyInstance } from 'fastify';
import { ChatRequestSchema } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { chat } from '../services/chat.js';

// Authenticated (JWT) chat endpoints for the in-dashboard "Chat tester" tool.
// Same engine as the public /api/v1/chat, but uses the logged-in session (no API key)
// and does NOT log BotQuery (keeps test chatter out of analytics).
export async function chatTestRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/', async (request, reply) => {
    const body = ChatRequestSchema.parse(request.body);
    const r = await chat(body.message, body.history);
    return reply.send({
      reply: r.reply,
      usedKnowledgeBase: r.usedKnowledgeBase,
      sources: r.sources,
      links: r.links,
      followups: r.followups,
      walkthrough: r.walkthrough ?? null,
      confidence: r.confidence,
      queryId: null,
    });
  });

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
}

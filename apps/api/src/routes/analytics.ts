import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const LOW_CONFIDENCE_THRESHOLD = 0.55;

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/unanswered', async (_request, reply) => {
    const rows = await prisma.botQuery.findMany({
      where: {
        OR: [
          { matchedId: null },
          { confidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
          { helpful: false },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, question: true, confidence: true, matchedId: true, createdAt: true },
    });
    return reply.send(rows);
  });

  app.get('/top-queries', async (_request, reply) => {
    const grouped = await prisma.botQuery.groupBy({
      by: ['question'],
      _count: { question: true },
      _avg: { confidence: true },
      orderBy: { _count: { question: 'desc' } },
      take: 20,
    });

    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const totalWithFeedback = await prisma.botQuery.count({
          where: { question: g.question, helpful: { not: null } },
        });
        const helpfulCount = await prisma.botQuery.count({
          where: { question: g.question, helpful: true },
        });
        const helpfulRatio = totalWithFeedback > 0 ? helpfulCount / totalWithFeedback : null;

        return {
          question: g.question,
          count: g._count.question,
          avgConfidence: g._avg.confidence,
          helpfulRatio,
        };
      }),
    );

    return reply.send(enriched);
  });

  app.get('/coverage', async (_request, reply) => {
    const byArea = await prisma.article.groupBy({
      by: ['productArea', 'status'],
      _count: { _all: true },
    });

    const totals = await prisma.article.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const totalMap = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
    for (const row of totals) {
      totalMap[row.status] = row._count._all;
    }

    return reply.send({
      byArea: byArea
        .filter((r) => r.productArea !== null)
        .map((r) => ({
          productArea: r.productArea,
          status: r.status,
          count: r._count._all,
        })),
      totals: { draft: totalMap.DRAFT, published: totalMap.PUBLISHED, archived: totalMap.ARCHIVED },
    });
  });
}

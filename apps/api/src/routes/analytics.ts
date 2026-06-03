import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const LOW_CONFIDENCE_THRESHOLD = 0.55;

// Parse a ?days=N range param → the cutoff Date (or null for "all time"). Used to scope the
// bot-usage analytics to a window the dashboard selects (7 / 30 / 90 days).
function rangeSince(query: unknown): { since: Date | null; days: number | null } {
  const raw = Number((query as { days?: string })?.days);
  const days = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  return { since: days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null, days };
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/unanswered', async (request, reply) => {
    const { since } = rangeSince(request.query);
    const flagged = {
      OR: [
        { matchedId: null },
        { confidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
        { helpful: false },
      ],
    };
    const rows = await prisma.botQuery.findMany({
      where: since ? { AND: [{ createdAt: { gte: since } }, flagged] } : flagged,
      orderBy: { createdAt: 'desc' },
      take: 200, // client paginates/exports the full filtered set
      select: { id: true, question: true, confidence: true, matchedId: true, createdAt: true },
    });
    return reply.send(rows);
  });

  // Bot-usage overview: headline KPIs + per-day volume for the selected range.
  app.get('/summary', async (request, reply) => {
    const { since, days } = rangeSince(request.query);
    const floor = since ?? new Date(0); // "all time" → from the epoch
    const where = { createdAt: { gte: floor } };

    const [totalQueries, matched, avg, withFeedback, helpful, daily] = await Promise.all([
      prisma.botQuery.count({ where }),
      prisma.botQuery.count({ where: { ...where, matchedId: { not: null } } }),
      prisma.botQuery.aggregate({ _avg: { confidence: true }, where }),
      prisma.botQuery.count({ where: { ...where, helpful: { not: null } } }),
      prisma.botQuery.count({ where: { ...where, helpful: true } }),
      prisma.$queryRaw<{ day: Date; cnt: bigint; matched: bigint }[]>`
        SELECT date_trunc('day', "createdAt")::date AS day,
               count(*) AS cnt,
               count("matchedId") AS matched
        FROM "BotQuery"
        WHERE "createdAt" >= ${floor}
        GROUP BY day
        ORDER BY day ASC`,
    ]);

    return reply.send({
      totalQueries,
      matched,
      answeredRate: totalQueries > 0 ? matched / totalQueries : null,
      avgConfidence: avg._avg.confidence,
      withFeedback,
      helpfulRate: withFeedback > 0 ? helpful / withFeedback : null,
      daily: daily.map((d) => ({
        date: d.day.toISOString().slice(0, 10),
        count: Number(d.cnt),
        matched: Number(d.matched),
      })),
      rangeDays: days,
    });
  });

  app.get('/top-queries', async (request, reply) => {
    const { since } = rangeSince(request.query);
    const grouped = await prisma.botQuery.groupBy({
      by: ['question'],
      where: since ? { createdAt: { gte: since } } : undefined,
      _count: { question: true },
      _avg: { confidence: true },
      orderBy: { _count: { question: 'desc' } },
      take: 200, // client paginates/exports the full filtered set
    });

    const inRange = since ? { createdAt: { gte: since } } : {};
    const enriched = await Promise.all(
      grouped.map(async (g) => {
        const totalWithFeedback = await prisma.botQuery.count({
          where: { ...inRange, question: g.question, helpful: { not: null } },
        });
        const helpfulCount = await prisma.botQuery.count({
          where: { ...inRange, question: g.question, helpful: true },
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

    // productPillar is the populated reference field (productArea is null for reference KB cards),
    // so this is the breakdown that actually has data to chart.
    const byPillar = await prisma.article.groupBy({
      by: ['productPillar', 'status'],
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
      byPillar: byPillar
        .filter((r) => r.productPillar !== null && r.productPillar !== '')
        .map((r) => ({
          productPillar: r.productPillar as string,
          status: r.status,
          count: r._count._all,
        })),
      totals: { draft: totalMap.DRAFT, published: totalMap.PUBLISHED, archived: totalMap.ARCHIVED },
    });
  });
}

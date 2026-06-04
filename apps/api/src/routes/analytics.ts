import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const LOW_CONFIDENCE_THRESHOLD = 0.55;

// Parse a "YYYY-MM-DD" day into a UTC instant — start-of-day by default, end-of-day for range
// upper bounds so a `to` date includes the whole day. Returns null for anything malformed OR for an
// out-of-range calendar date (Date.UTC silently rolls month 13 / day 99 over, so round-trip-check).
function parseDateOnly(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(
    endOfDay ? Date.UTC(y, mo - 1, day, 23, 59, 59, 999) : Date.UTC(y, mo - 1, day),
  );
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== mo - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

// Resolve the date window the dashboard asked for. A custom `from`/`to` pair (either bound optional)
// wins; otherwise fall back to the `days=N` preset (7 / 30 / 90). `until` is null for presets/all-time.
function parseRange(query: unknown): { since: Date | null; until: Date | null; days: number | null } {
  const q = (query ?? {}) as { days?: string; from?: string; to?: string };
  const from = parseDateOnly(q.from);
  const to = parseDateOnly(q.to, true);
  if (from || to) return { since: from, until: to, days: null };
  const raw = Number(q.days);
  const days = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  return { since: days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null, until: null, days };
}

// Build a Prisma `createdAt` filter from the resolved window (undefined = no date constraint).
function createdAtFilter(
  since: Date | null,
  until: Date | null,
): { gte?: Date; lte?: Date } | undefined {
  if (!since && !until) return undefined;
  const f: { gte?: Date; lte?: Date } = {};
  if (since) f.gte = since;
  if (until) f.lte = until;
  return f;
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/unanswered', async (request, reply) => {
    const { since, until } = parseRange(request.query);
    const cf = createdAtFilter(since, until);
    const flagged = {
      OR: [
        { matchedId: null },
        { confidence: { lt: LOW_CONFIDENCE_THRESHOLD } },
        { helpful: false },
      ],
    };
    const rows = await prisma.botQuery.findMany({
      where: cf ? { AND: [{ createdAt: cf }, flagged] } : flagged,
      orderBy: { createdAt: 'desc' },
      take: 200, // client paginates/exports the full filtered set
      select: { id: true, question: true, confidence: true, matchedId: true, createdAt: true },
    });
    return reply.send(rows);
  });

  // Bot-usage overview: headline KPIs + per-day volume for the selected range.
  app.get('/summary', async (request, reply) => {
    const { since, until, days } = parseRange(request.query);
    const floor = since ?? new Date(0); // "all time" → from the epoch
    const where = { createdAt: { gte: floor, ...(until ? { lte: until } : {}) } };

    // Daily volume: same window. The upper bound is only added when a custom `to` is set, so the
    // preset/all-time queries keep their single-bound plan.
    const dailyWhere = [Prisma.sql`"createdAt" >= ${floor}`];
    if (until) dailyWhere.push(Prisma.sql`"createdAt" <= ${until}`);

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
        WHERE ${Prisma.join(dailyWhere, ' AND ')}
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
    const { since, until } = parseRange(request.query);
    const cf = createdAtFilter(since, until);
    const grouped = await prisma.botQuery.groupBy({
      by: ['question'],
      where: cf ? { createdAt: cf } : undefined,
      _count: { question: true },
      _avg: { confidence: true },
      orderBy: { _count: { question: 'desc' } },
      take: 200, // client paginates/exports the full filtered set
    });

    const inRange = cf ? { createdAt: cf } : {};
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

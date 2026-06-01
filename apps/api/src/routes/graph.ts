import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import type { GraphResponse } from '@kb/shared';

export async function graphRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (_request, reply) => {
    const articles = await prisma.article.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        productArea: true,
        difficulty: true,
        status: true,
        prerequisites: { select: { id: true } },
        relatedTo: { select: { id: true } },
      },
    });

    const nodes: GraphResponse['nodes'] = articles.map((a) => ({
      id: a.id,
      label: a.title,
      slug: a.slug,
      productArea: a.productArea,
      difficulty: a.difficulty,
      status: a.status,
    }));

    const edges: GraphResponse['edges'] = [];
    const seenRelated = new Set<string>();
    for (const a of articles) {
      for (const p of a.prerequisites) {
        edges.push({ source: p.id, target: a.id, type: 'prerequisite' });
      }
      // relatedTo is stored one-directionally; dedupe by unordered pair so each
      // related link shows exactly once regardless of which side connected it.
      for (const r of a.relatedTo) {
        const key = [a.id, r.id].sort().join('|');
        if (seenRelated.has(key)) continue;
        seenRelated.add(key);
        edges.push({ source: a.id, target: r.id, type: 'related' });
      }
    }

    return reply.send({ nodes, edges });
  });
}

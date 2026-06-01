import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { baseSlug } from '../lib/slug.js';

const CategoryCreateSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
});

export async function categoryRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (_request, reply) => {
    const cats = await prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
    return reply.send(cats);
  });

  app.post('/', async (request, reply) => {
    const body = CategoryCreateSchema.parse(request.body);
    const slug = body.slug ?? baseSlug(body.name);
    const created = await prisma.category.create({
      data: {
        name: body.name,
        slug,
        parentId: body.parentId ?? null,
      },
    });
    return reply.status(201).send(created);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.category.delete({ where: { id } });
    return reply.status(204).send();
  });
}

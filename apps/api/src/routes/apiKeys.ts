import type { FastifyInstance } from 'fastify';
import { ApiKeyCreateSchema } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { generateApiKey } from '../lib/token.js';

export async function apiKeyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('SUPER_ADMIN'));

  app.post('/', async (request, reply) => {
    const body = ApiKeyCreateSchema.parse(request.body);
    const { plaintext, hashed, prefix } = generateApiKey();
    const record = await prisma.apiKey.create({
      data: { name: body.name, hashedKey: hashed, prefix },
    });
    return reply.status(201).send({
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      lastUsedAt: record.lastUsedAt,
      createdAt: record.createdAt,
      revokedAt: record.revokedAt,
      plaintext,
    });
  });

  app.get('/', async (_request, reply) => {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
      },
    });
    return reply.send(keys);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return reply.send({ ok: true });
  });
}

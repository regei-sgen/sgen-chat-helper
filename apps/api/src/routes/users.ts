import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ChangePasswordSchema } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { BadRequest, Unauthorized } from '../lib/errors.js';

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', { preHandler: [requireRole('SUPER_ADMIN')] }, async (_request, reply) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return reply.send(users);
  });

  app.post('/change-password', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = ChangePasswordSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw Unauthorized();
    const ok = await bcrypt.compare(body.currentPassword, user.password);
    if (!ok) throw BadRequest('Current password is incorrect');
    const hashed = await bcrypt.hash(body.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { password: hashed } });
    return reply.send({ ok: true });
  });

  app.patch('/me', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = (request.body ?? {}) as { name?: string };
    const updated = await prisma.user.update({
      where: { id: request.user.sub },
      data: { name: body.name ?? null },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    return reply.send(updated);
  });
}

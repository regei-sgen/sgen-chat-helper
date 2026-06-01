import type { FastifyInstance } from 'fastify';
import { InviteCreateSchema } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { BadRequest, Unauthorized } from '../lib/errors.js';
import { generateInviteToken } from '../lib/token.js';

const INVITE_TTL_DAYS = 7;

export async function inviteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('SUPER_ADMIN'));

  app.post('/', async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const body = InviteCreateSchema.parse(request.body);

    const existingUser = await prisma.user.findUnique({ where: { email: body.email } });
    if (existingUser) throw BadRequest('A user with that email already exists');

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await prisma.invite.create({
      data: {
        email: body.email,
        role: body.role,
        token,
        invitedBy: request.user.sub,
        expiresAt,
      },
    });

    return reply.status(201).send(invite);
  });

  app.get('/', async (_request, reply) => {
    const invites = await prisma.invite.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(invites);
  });

  app.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.invite.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}

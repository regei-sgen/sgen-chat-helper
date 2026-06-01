import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import {
  AuthResponseSchema,
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
} from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { BadRequest, Conflict, Unauthorized } from '../lib/errors.js';
import { env } from '../lib/env.js';
import { requireAuth } from '../middleware/auth.js';

interface TokenPayload {
  sub: string;
  email: string;
  role: 'SUPER_ADMIN' | 'EDITOR';
  type?: 'refresh';
}

function signTokens(app: FastifyInstance, payload: Omit<TokenPayload, 'type'>) {
  const accessToken = app.jwt.sign(payload, { expiresIn: env.ACCESS_TOKEN_TTL });
  const refreshToken = app.jwt.sign(
    { ...payload, type: 'refresh' },
    { expiresIn: env.REFRESH_TOKEN_TTL },
  );
  return { accessToken, refreshToken };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const body = RegisterSchema.parse(request.body);

    const existingUserCount = await prisma.user.count();
    let role: 'SUPER_ADMIN' | 'EDITOR' = 'EDITOR';
    let inviteId: string | null = null;

    if (existingUserCount === 0) {
      role = 'SUPER_ADMIN';
    } else {
      if (!body.inviteToken) {
        throw BadRequest('Registration requires an invite token');
      }
      const invite = await prisma.invite.findUnique({ where: { token: body.inviteToken } });
      if (!invite) throw BadRequest('Invalid invite token');
      if (invite.usedAt) throw BadRequest('Invite token already used');
      if (invite.expiresAt < new Date()) throw BadRequest('Invite token expired');
      if (invite.email.toLowerCase() !== body.email.toLowerCase()) {
        throw BadRequest('Email does not match invite');
      }
      role = invite.role;
      inviteId = invite.id;
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw Conflict('Email already in use');

    const hashed = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        email: body.email,
        password: hashed,
        name: body.name ?? null,
        role,
      },
    });

    if (inviteId) {
      await prisma.invite.update({
        where: { id: inviteId },
        data: { usedAt: new Date() },
      });
    }

    const tokens = signTokens(app, { sub: user.id, email: user.email, role: user.role });
    return reply.status(201).send(
      AuthResponseSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        },
        ...tokens,
      }),
    );
  });

  app.post('/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) throw Unauthorized('Invalid credentials');

    const ok = await bcrypt.compare(body.password, user.password);
    if (!ok) throw Unauthorized('Invalid credentials');

    const tokens = signTokens(app, { sub: user.id, email: user.email, role: user.role });
    return reply.send(
      AuthResponseSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        },
        ...tokens,
      }),
    );
  });

  app.post('/refresh', async (request, reply) => {
    const body = RefreshSchema.parse(request.body);
    let decoded: TokenPayload;
    try {
      decoded = app.jwt.verify(body.refreshToken) as TokenPayload;
    } catch {
      throw Unauthorized('Invalid refresh token');
    }
    if (decoded.type !== 'refresh') {
      throw Unauthorized('Provided token is not a refresh token');
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) throw Unauthorized('User no longer exists');

    const tokens = signTokens(app, { sub: user.id, email: user.email, role: user.role });
    return reply.send(
      AuthResponseSchema.parse({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
        },
        ...tokens,
      }),
    );
  });

  app.post('/logout', async (_request, reply) => {
    return reply.send({ ok: true });
  });

  app.get('/me', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!request.user) throw Unauthorized();
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw Unauthorized();
    return reply.send({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
    });
  });
}

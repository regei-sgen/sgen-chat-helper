import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Role } from '@prisma/client';
import { Unauthorized, Forbidden } from '../lib/errors.js';

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw Unauthorized('Invalid or expired token');
  }
  if (!request.user?.sub) throw Unauthorized();
  if (request.user.type === 'refresh') {
    throw Unauthorized('Cannot use refresh token for authentication');
  }
}

export function requireRole(role: Role) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) throw Unauthorized();
    if (request.user.role !== role && request.user.role !== 'SUPER_ADMIN') {
      throw Forbidden(`Requires ${role} role`);
    }
  };
}

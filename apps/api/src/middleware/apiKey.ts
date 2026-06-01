import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { Unauthorized } from '../lib/errors.js';
import { hashApiKey } from '../lib/token.js';

export async function requireApiKey(request: FastifyRequest, _reply: FastifyReply) {
  const headerVal = request.headers['x-api-key'];
  const plaintext = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!plaintext) throw Unauthorized('Missing X-API-Key header');

  const hashed = hashApiKey(plaintext);
  const record = await prisma.apiKey.findUnique({ where: { hashedKey: hashed } });
  if (!record) throw Unauthorized('Invalid API key');
  if (record.revokedAt) throw Unauthorized('API key has been revoked');

  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  request.apiKey = { id: record.id };
}

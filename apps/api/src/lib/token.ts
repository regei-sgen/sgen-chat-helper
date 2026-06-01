import crypto from 'node:crypto';

const KEY_PREFIX = 'kb_';

export function generateApiKey(): { plaintext: string; hashed: string; prefix: string } {
  const random = crypto.randomBytes(32).toString('base64url');
  const plaintext = `${KEY_PREFIX}${random}`;
  const hashed = hashApiKey(plaintext);
  const prefix = plaintext.slice(0, 10);
  return { plaintext, hashed, prefix };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

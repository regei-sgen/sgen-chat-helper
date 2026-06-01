import crypto from 'node:crypto';
import { env } from './env.js';

// API keys are encrypted at rest. The encryption key is derived from JWT_SECRET
// so no extra env var / key-management is required for local/single-tenant use.
const KEY = crypto.scryptSync(env.JWT_SECRET, 'kb-settings-encryption-v1', 32);
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// e.g. "sk-...AB12" — safe to show in the UI; never returns the full secret.
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 3)}…${plain.slice(-4)}`;
}

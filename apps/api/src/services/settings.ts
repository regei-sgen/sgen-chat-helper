import type { EmbeddingProvider, StructuringProvider } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { encryptSecret, decryptSecret, maskSecret } from '../lib/crypto.js';

export type { EmbeddingProvider, StructuringProvider };

// Default models per provider (overridable for structuring via settings).
export const LOCAL_EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
// `text-embedding-004` now 404s on the v1beta embedContent endpoint; `gemini-embedding-001`
// is the current GA Gemini embedding model.
export const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

export const ANTHROPIC_STRUCTURING_MODEL = 'claude-sonnet-4-5';
export const OPENAI_STRUCTURING_MODEL = 'gpt-4o';
export const GEMINI_STRUCTURING_MODEL = 'gemini-2.0-flash';
// Claude Code CLI model alias (sonnet/opus/haiku) — runs via the local install, no API key.
export const CLAUDE_CODE_STRUCTURING_MODEL = 'sonnet';

const ANTHROPIC_KEY = 'anthropic_api_key';
const OPENAI_KEY = 'openai_api_key';
const GEMINI_KEY = 'gemini_api_key';
const STRUCTURING_PROVIDER_KEY = 'structuring_provider';
const STRUCTURING_MODEL_KEY = 'structuring_model';
const AUTOLINK_PROVIDER_KEY = 'autolink_provider';
const SECRET_KEYS = new Set([ANTHROPIC_KEY, OPENAI_KEY, GEMINI_KEY]);

// Short TTL so the separate worker process picks up changes made via the API
// process within a few seconds (each process has its own cache).
const CACHE_TTL_MS = 5000;
let cache: Map<string, string> | null = null;
let cacheAt = 0;

async function load(): Promise<Map<string, string>> {
  if (!cache || Date.now() - cacheAt > CACHE_TTL_MS) {
    const rows = await prisma.setting.findMany();
    cache = new Map(rows.map((r) => [r.key, r.value]));
    cacheAt = Date.now();
  }
  return cache;
}

function invalidate() {
  cache = null;
  cacheAt = 0;
}

async function getRaw(key: string): Promise<string | null> {
  return (await load()).get(key) ?? null;
}

async function getSecret(key: string): Promise<string | null> {
  const stored = await getRaw(key);
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await prisma.setting.deleteMany({ where: { key } });
  } else {
    const stored = SECRET_KEYS.has(key) ? encryptSecret(value) : value;
    await prisma.setting.upsert({
      where: { key },
      create: { key, value: stored },
      update: { value: stored },
    });
  }
  invalidate();
}

// Treat the shipped .env placeholders (e.g. "sk-ant-...") as "not configured".
function realKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t || t.includes('...') || t.includes('…')) return null;
  return t;
}

interface ResolvedKey {
  key: string | null;
  source: 'settings' | 'env' | null;
}

async function resolve(settingKey: string, envValue: string | undefined | null): Promise<ResolvedKey> {
  const fromSettings = await getSecret(settingKey);
  if (fromSettings) return { key: fromSettings, source: 'settings' };
  const fromEnv = realKey(envValue);
  if (fromEnv) return { key: fromEnv, source: 'env' };
  return { key: null, source: null };
}

export async function getActiveAnthropicKey(): Promise<string | null> {
  return (await resolve(ANTHROPIC_KEY, env.ANTHROPIC_API_KEY)).key;
}
export async function getActiveOpenAIKey(): Promise<string | null> {
  return (await resolve(OPENAI_KEY, process.env.OPENAI_API_KEY)).key;
}
export async function getActiveGeminiKey(): Promise<string | null> {
  return (await resolve(GEMINI_KEY, process.env.GEMINI_API_KEY)).key;
}

// ---- structuring ----
export function defaultStructuringModel(provider: StructuringProvider): string {
  if (provider === 'openai') return OPENAI_STRUCTURING_MODEL;
  if (provider === 'gemini') return GEMINI_STRUCTURING_MODEL;
  if (provider === 'claude-code') return CLAUDE_CODE_STRUCTURING_MODEL;
  return ANTHROPIC_STRUCTURING_MODEL;
}

export async function getStructuringProvider(): Promise<StructuringProvider> {
  const v = await getRaw(STRUCTURING_PROVIDER_KEY);
  return v === 'openai' || v === 'gemini' || v === 'claude-code' ? v : 'anthropic';
}

export async function getStructuringModel(): Promise<string> {
  const override = (await getRaw(STRUCTURING_MODEL_KEY))?.trim();
  return override || defaultStructuringModel(await getStructuringProvider());
}

// ---- auto-link (knowledge-graph Link Arranger) ----
// Independent of the chat provider. Defaults to local Claude Code (no API key, no free-tier rate
// limits), but is overridable in Settings → AI Providers. The model is the provider's own default.
export async function getAutolinkProvider(): Promise<StructuringProvider> {
  const v = await getRaw(AUTOLINK_PROVIDER_KEY);
  return v === 'anthropic' || v === 'openai' || v === 'gemini' || v === 'claude-code'
    ? v
    : 'claude-code';
}

export async function getAutolinkModel(): Promise<string> {
  return defaultStructuringModel(await getAutolinkProvider());
}

// ---- embedding ----
export async function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  // LOCKED to the local MiniLM model. Remote providers (OpenAI/Gemini) both rate-limit (429) AND
  // change the vector dimensionality, which silently breaks search against the stored MiniLM
  // vectors. Hard-locking here means an upload can NEVER fail on an embedding quota again — the
  // stored `embedding_provider` setting (if any) is intentionally ignored.
  return 'local';
}

export async function getActiveEmbeddingModel(): Promise<string> {
  const p = await getEmbeddingProvider();
  if (p === 'openai') return OPENAI_EMBED_MODEL;
  if (p === 'gemini') return GEMINI_EMBED_MODEL;
  return LOCAL_EMBED_MODEL;
}

function providerStatus(resolved: ResolvedKey) {
  return {
    configured: resolved.key !== null,
    hint: resolved.key ? maskSecret(resolved.key) : null,
    source: resolved.source,
  };
}

export async function getSettingsStatus() {
  const [
    anthropic,
    openai,
    gemini,
    embeddingProvider,
    structuringProvider,
    structuringModel,
    autolinkProvider,
    autolinkModel,
  ] = await Promise.all([
    resolve(ANTHROPIC_KEY, env.ANTHROPIC_API_KEY),
    resolve(OPENAI_KEY, process.env.OPENAI_API_KEY),
    resolve(GEMINI_KEY, process.env.GEMINI_API_KEY),
    getEmbeddingProvider(),
    getStructuringProvider(),
    getStructuringModel(),
    getAutolinkProvider(),
    getAutolinkModel(),
  ]);
  const activeEmbeddingModel =
    embeddingProvider === 'openai'
      ? OPENAI_EMBED_MODEL
      : embeddingProvider === 'gemini'
        ? GEMINI_EMBED_MODEL
        : LOCAL_EMBED_MODEL;

  const [total, matchingActive] = await Promise.all([
    prisma.article.count(),
    prisma.article.count({ where: { embeddingModel: activeEmbeddingModel } }),
  ]);

  return {
    anthropic: providerStatus(anthropic),
    openai: providerStatus(openai),
    gemini: providerStatus(gemini),
    structuringProvider,
    structuringModel,
    autolinkProvider,
    autolinkModel,
    embeddingProvider,
    activeEmbeddingModel,
    embeddings: {
      total,
      matchingActive,
      needsReembed: total - matchingActive,
    },
  };
}

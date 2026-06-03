import type { FastifyInstance } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { SettingsUpdateSchema } from '@kb/shared';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  setSetting,
  getSettingsStatus,
  getActiveAnthropicKey,
  getActiveOpenAIKey,
  getActiveGeminiKey,
  OPENAI_EMBED_MODEL,
} from '../services/settings.js';
import { reembedAllArticles } from '../services/article.js';
import { probeClaudeCode } from '../services/ai.js';

type TestResult = { ok: boolean; message: string };

async function testClaudeCode(): Promise<TestResult> {
  try {
    const version = await probeClaudeCode();
    return { ok: true, message: `Claude Code CLI detected (${version})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Claude Code CLI not available' };
  }
}

async function testAnthropic(apiKey: string): Promise<TestResult> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return { ok: true, message: 'Anthropic (Claude) key is valid' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
  }
}

async function testOpenAI(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: 'ping' }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, message: `OpenAI ${res.status}: ${detail.slice(0, 160)}` };
    }
    return { ok: true, message: 'OpenAI key is valid' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
  }
}

async function testGemini(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
    );
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, message: `Gemini ${res.status}: ${detail.slice(0, 160)}` };
    }
    return { ok: true, message: 'Gemini (Google) key is valid' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Request failed' };
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('SUPER_ADMIN'));

  app.get('/', async (_request, reply) => {
    return reply.send(await getSettingsStatus());
  });

  app.put('/', async (request, reply) => {
    const body = SettingsUpdateSchema.parse(request.body);
    if (body.anthropicApiKey !== undefined) {
      await setSetting('anthropic_api_key', body.anthropicApiKey.trim() || null);
    }
    if (body.openaiApiKey !== undefined) {
      await setSetting('openai_api_key', body.openaiApiKey.trim() || null);
    }
    if (body.geminiApiKey !== undefined) {
      await setSetting('gemini_api_key', body.geminiApiKey.trim() || null);
    }
    if (body.structuringProvider !== undefined) {
      await setSetting('structuring_provider', body.structuringProvider);
    }
    if (body.structuringModel !== undefined) {
      await setSetting('structuring_model', body.structuringModel.trim() || null);
    }
    if (body.autolinkProvider !== undefined) {
      await setSetting('autolink_provider', body.autolinkProvider);
    }
    if (body.embeddingProvider !== undefined) {
      await setSetting('embedding_provider', body.embeddingProvider);
    }
    return reply.send(await getSettingsStatus());
  });

  app.post('/test', async (_request, reply) => {
    const [anthropicKey, openaiKey, geminiKey] = await Promise.all([
      getActiveAnthropicKey(),
      getActiveOpenAIKey(),
      getActiveGeminiKey(),
    ]);
    const [anthropic, openai, gemini, claudeCode] = await Promise.all([
      anthropicKey ? testAnthropic(anthropicKey) : Promise.resolve(null),
      openaiKey ? testOpenAI(openaiKey) : Promise.resolve(null),
      geminiKey ? testGemini(geminiKey) : Promise.resolve(null),
      testClaudeCode(),
    ]);
    return reply.send({ anthropic, openai, gemini, claudeCode });
  });

  app.post('/reembed', async (_request, reply) => {
    return reply.send(await reembedAllArticles());
  });
}

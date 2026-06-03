import { spawn } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import type { StructuringProvider } from '@kb/shared';
import { BadRequest } from '../lib/errors.js';
import {
  getStructuringProvider,
  getStructuringModel,
  getAutolinkProvider,
  getAutolinkModel,
  getActiveAnthropicKey,
  getActiveOpenAIKey,
  getActiveGeminiKey,
  CLAUDE_CODE_STRUCTURING_MODEL,
} from './settings.js';

// Generic "ask the configured AI provider for a JSON response" helper, shared by
// article structuring and relationship auto-linking. Returns the raw text response.

// Transient upstream failures (rate limits, capacity spikes) — safe to retry for generateContent.
const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

async function fetchWithRetry(
  url: string,
  init: Parameters<typeof fetch>[1],
  label: string,
  maxAttempts = 4,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, init);
    // Return on success, on a non-transient error, or once we're out of attempts —
    // without consuming the body, so the caller can read the error detail.
    if (res.ok || !TRANSIENT_STATUS.has(res.status) || attempt >= maxAttempts) {
      return res;
    }
    const detail = await res.text().catch(() => '');
    const backoffMs = 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
    console.warn(
      `[ai] ${label} ${res.status} on attempt ${attempt}/${maxAttempts}; retrying in ${backoffMs}ms` +
        (detail ? ` — ${detail.slice(0, 120)}` : ''),
    );
    await new Promise((r) => setTimeout(r, backoffMs));
  }
}

async function callAnthropic(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const apiKey = await getActiveAnthropicKey();
  if (!apiKey) {
    throw BadRequest('No Anthropic (Claude) API key configured. Add one in Settings → AI Providers.');
  }
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function callOpenAI(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  asJson: boolean,
): Promise<string> {
  const apiKey = await getActiveOpenAIKey();
  if (!apiKey) {
    throw BadRequest('No OpenAI API key configured. Add one in Settings → AI Providers.');
  }
  const res = await fetchWithRetry(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(asJson ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    },
    'OpenAI request',
  );
  if (!res.ok) {
    const detail = await res.text();
    throw BadRequest(`OpenAI request failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

async function callGemini(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  asJson: boolean,
): Promise<string> {
  const apiKey = await getActiveGeminiKey();
  if (!apiKey) {
    throw BadRequest('No Gemini API key configured. Add one in Settings → AI Providers.');
  }
  // Auth via the `x-goog-api-key` header (Google's documented method; also accepts the newer
  // "AQ."-style keys, unlike the older `?key=` query param). `thinkingConfig.thinkingBudget: 0`
  // disables the model's internal "thinking" so the whole output budget goes to the answer —
  // faster, cheaper, and it avoids empty replies when maxOutputTokens is small.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent`;
  const generationConfig: Record<string, unknown> = {
    ...(asJson ? { responseMimeType: 'application/json' } : {}),
    maxOutputTokens: maxTokens,
    thinkingConfig: { thinkingBudget: 0 },
  };
  const send = (cfg: Record<string, unknown>) =>
    fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: cfg,
        }),
      },
      'Gemini request',
    );

  let res = await send(generationConfig);
  if (!res.ok) {
    let detail = await res.text();
    // Models without thinking support (e.g. gemini-2.0-flash) reject thinkingConfig — retry once without it.
    if (res.status === 400 && /thinking/i.test(detail)) {
      const fallback = { ...generationConfig };
      delete fallback.thinkingConfig;
      res = await send(fallback);
      if (!res.ok) detail = await res.text();
    }
    if (!res.ok) {
      throw BadRequest(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`);
    }
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? '').join('');
}

// ---- Claude Code (local CLI) ----
// Shells out to the locally-installed, already-authenticated `claude` CLI — no API key needed,
// and not subject to free-tier rate limits. Only works where Claude Code is installed on PATH
// (i.e. this machine / local dev), NOT on a remote deployment.
function runClaudeCli(args: string[], input?: string, timeoutMs = 180_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    // Strip ANTHROPIC_API_KEY/AUTH_TOKEN from the child env: the app's .env may carry a
    // placeholder (or unrelated) key that Claude Code would otherwise try to use and fail on.
    // With no API key present, the CLI uses its own stored login (your Claude subscription) —
    // which is the entire point of this provider.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    // shell:true lets Windows resolve `claude.cmd` from PATH; the prompt is passed via stdin
    // (never interpolated into the command line), so document content can't affect the shell.
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(BadRequest(`Claude Code timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        BadRequest(
          `Couldn't launch the Claude Code CLI ("claude") — is it installed and on your PATH? (${err.message})`,
        ),
      );
    });
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(BadRequest(`Claude Code exited (${code}): ${(stderr || stdout).slice(0, 300)}`));
    });
    child.stdin.end(input ?? '');
  });
}

async function callClaudeCode(model: string, system: string, user: string): Promise<string> {
  // Validate the model alias before it becomes a CLI arg (defense-in-depth, even though it
  // comes from an admin-only setting). Headless: single turn, JSON envelope, no MCP servers.
  const safeModel = /^[a-zA-Z0-9._-]+$/.test(model) ? model : 'sonnet';
  const stdout = await runClaudeCli(
    ['-p', '--output-format', 'json', '--max-turns', '1', '--strict-mcp-config', '--model', safeModel],
    `${system}\n\n${user}`,
  );
  let env: { is_error?: boolean; result?: string; subtype?: string };
  try {
    env = JSON.parse(stdout) as typeof env;
  } catch {
    throw BadRequest(`Claude Code returned unparseable output: ${stdout.slice(0, 300)}`);
  }
  if (env.is_error || typeof env.result !== 'string') {
    throw BadRequest(`Claude Code returned an error: ${env.subtype ?? 'unknown'}`);
  }
  return env.result;
}

/** Confirms the local Claude Code CLI is installed/runnable (used by the settings test). */
export async function probeClaudeCode(): Promise<string> {
  const out = await runClaudeCli(['--version'], undefined, 20_000);
  return out.trim().split('\n')[0] || 'claude';
}

// Route a resolved (provider, model) pair to the matching SDK/CLI call. Shared by every
// selectable-provider entry point below so the dispatch table lives in exactly one place.
function dispatch(
  provider: StructuringProvider,
  model: string,
  system: string,
  user: string,
  maxTokens: number,
  json: boolean,
): Promise<string> {
  if (provider === 'openai') return callOpenAI(model, system, user, maxTokens, json);
  if (provider === 'gemini') return callGemini(model, system, user, maxTokens, json);
  if (provider === 'claude-code') return callClaudeCode(model, system, user);
  return callAnthropic(model, system, user, maxTokens);
}

/**
 * Run the *active / selectable* CHAT provider with a system + user prompt; returns raw text.
 * This is the AI the admin picks in Settings → AI Providers under "Chat assistant AI", and it
 * powers the CHAT assistant (retrieval rerank + answer compose). It does NOT handle upload
 * structuring (pinned to local Claude via `runLocalClaude`) nor the knowledge-graph Link Arranger
 * (its own provider via `runAutolinkProvider`).
 * `json: true` (default) asks providers for a JSON response (for structured tasks);
 * pass `json: false` for prose answers (e.g. composing a chat reply).
 */
export async function runProvider(
  system: string,
  user: string,
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4096;
  const json = opts.json ?? true;
  const [provider, model] = await Promise.all([getStructuringProvider(), getStructuringModel()]);
  return dispatch(provider, model, system, user, maxTokens, json);
}

/**
 * Run the knowledge-graph Link Arranger (relationship auto-linking) provider; returns raw text.
 * Independent of the chat provider: defaults to local Claude Code (no API key / rate limits) but
 * is overridable in Settings → AI Providers. See `getAutolinkProvider`.
 */
export async function runAutolinkProvider(
  system: string,
  user: string,
  opts: { maxTokens?: number; json?: boolean } = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4096;
  const json = opts.json ?? true;
  const [provider, model] = await Promise.all([getAutolinkProvider(), getAutolinkModel()]);
  return dispatch(provider, model, system, user, maxTokens, json);
}

/**
 * Run a prompt through the LOCAL Claude Code CLI, ALWAYS — regardless of the active provider
 * selected in Settings. This is the dedicated path for the "upload using AI" feature (article
 * structuring): uploads are intentionally pinned to local Claude so structuring never consumes
 * API credits or hits a provider's free-tier rate limit. Requires the `claude` CLI installed &
 * signed in on this machine — it does not run on a remote deployment. (The chat assistant stays
 * on the selectable provider via `runProvider`.)
 */
export async function runLocalClaude(system: string, user: string): Promise<string> {
  return callClaudeCode(CLAUDE_CODE_STRUCTURING_MODEL, system, user);
}

/** Parse a model's JSON response, tolerating code fences. Throws BadRequest on failure. */
export function parseJsonResponse<T = unknown>(text: string, label = 'AI'): T {
  const cleaned = text.replace(/```json\n?|```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (err) {
    throw BadRequest(
      `${label} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { raw: text.slice(0, 500) },
    );
  }
}

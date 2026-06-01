import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import {
  getEmbeddingProvider,
  getActiveOpenAIKey,
  getActiveGeminiKey,
  LOCAL_EMBED_MODEL,
  OPENAI_EMBED_MODEL,
  GEMINI_EMBED_MODEL,
} from './settings.js';

const MAX_INPUT_CHARS = 12_000;

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

// ---- Local provider (Xenova MiniLM, 384-dim, no API key) ----
let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    console.log(`[embedding] loading local model ${LOCAL_EMBED_MODEL}…`);
    extractorPromise = pipeline(
      'feature-extraction',
      LOCAL_EMBED_MODEL,
    ) as Promise<FeatureExtractionPipeline>;
    extractorPromise.then(() => console.log('[embedding] model ready'));
  }
  return extractorPromise;
}

async function embedLocal(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const tensor = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(tensor.data as Float32Array | number[]) as number[];
}

// ---- OpenAI provider (text-embedding-3-small, 1536-dim) ----
async function embedOpenAI(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_EMBED_MODEL, input: text }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`OpenAI embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new Error('OpenAI embeddings returned no vector');
  return vector;
}

// ---- Gemini provider (text-embedding-004, 768-dim) ----
async function embedGemini(text: string, apiKey: string): Promise<number[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      model: `models/${GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text }] },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini embeddings failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { embedding?: { values?: number[] } };
  const vector = json.embedding?.values;
  if (!vector) throw new Error('Gemini embeddings returned no vector');
  return vector;
}

export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Cannot embed empty text');
  const input = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed;

  const provider = await getEmbeddingProvider();
  if (provider === 'openai') {
    const apiKey = await getActiveOpenAIKey();
    if (!apiKey) {
      throw new Error(
        'Embedding provider is set to OpenAI, but no OpenAI API key is configured (Settings → AI Providers).',
      );
    }
    return { vector: await embedOpenAI(input, apiKey), model: OPENAI_EMBED_MODEL };
  }
  if (provider === 'gemini') {
    const apiKey = await getActiveGeminiKey();
    if (!apiKey) {
      throw new Error(
        'Embedding provider is set to Gemini, but no Gemini API key is configured (Settings → AI Providers).',
      );
    }
    return { vector: await embedGemini(input, apiKey), model: GEMINI_EMBED_MODEL };
  }
  return { vector: await embedLocal(input), model: LOCAL_EMBED_MODEL };
}

export function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

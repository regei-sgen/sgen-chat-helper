// Switch the *active* AI provider used by the chat router + compose (and relationship
// auto-linking). NOTE: upload article structuring is NOT affected — it always runs on the local
// Claude Code CLI (see services/structure.ts → runLocalClaude).
// Usage:  npx tsx apps/api/scripts/set-provider.ts claude-code
import '../src/lib/env.js';
import {
  setSetting,
  getStructuringProvider,
  getStructuringModel,
  getEmbeddingProvider,
  getActiveEmbeddingModel,
} from '../src/services/settings.js';

const provider = process.argv[2] ?? 'claude-code';
await setSetting('structuring_provider', provider);
// Clear any stale model override (e.g. a Gemini model) so the provider's own default applies.
await setSetting('structuring_model', process.argv[3] ?? null);
// Embeddings MUST stay local (MiniLM): the stored article vectors are MiniLM, and a remote
// embed provider (gemini/openai) both rate-limits (429) AND mismatches the stored
// embeddingModel, which silently kills vector search. Reset to the local default.
await setSetting('embedding_provider', null);
console.log(
  '[set-provider] chat AI =',
  await getStructuringProvider(),
  '/',
  await getStructuringModel(),
  '| embeddings =',
  await getEmbeddingProvider(),
  '/',
  await getActiveEmbeddingModel(),
);
process.exit(0);

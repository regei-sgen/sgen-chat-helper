// One-off: re-embed every article using the updated embeddingText (now includes step text),
// so step-level facts (e.g. "logo" inside a Site Settings step) are vector-searchable.
// Run from the repo root:  npx tsx apps/api/scripts/reembed-once.ts
import '../src/lib/env.js';
import { reembedAllArticles } from '../src/services/article.js';

const result = await reembedAllArticles();
console.log('[reembed-once] done:', JSON.stringify(result));
process.exit(0);

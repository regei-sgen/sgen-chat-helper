import { BadRequest } from '../lib/errors.js';
import { StructuredArticleSchema } from '@kb/shared';
import type { StructuredArticle } from '@kb/shared';
import { runLocalClaude, parseJsonResponse } from './ai.js';

export type { StructuredArticle };

const SYSTEM_PROMPT = `You are a documentation processor for SGEN, a WordPress alternative platform.

You receive raw markdown documentation and convert it into structured JSON for a knowledge base that powers a help chatbot.

SGEN has three product areas:
- SG_CORE: Users, Menus, Media Library, Pages & Posts
- SG_MODULES: Forms, Attributions, Page Builder, SEO & Performance
- SG_DASHBOARD: Site Manager, Stage & Live, Analytics, Advanced Settings

You ONLY extract METADATA. Do NOT echo the article body back — the original markdown is preserved verbatim as the article content separately, so leave it out of your response entirely.

Return ONLY valid JSON matching this schema:
{
  "title": "string - action-oriented",
  "summary": "string - one sentence",
  "feature": "string - SGEN feature name",
  "productArea": "SG_CORE | SG_MODULES | SG_DASHBOARD",
  "difficulty": "BEGINNER | INTERMEDIATE | ADVANCED",
  "steps": [{ "order": 1, "title": "string", "content": "string - a concise 1-2 sentence summary of this step" }],
  "tags": ["string"],
  "suggestedPrerequisites": ["existing article title"],
  "suggestedRelated": ["existing article title"],
  "sgenUrl": "string or null"
}

Keep "steps" short — summarize each step in a sentence or two; never paste large blocks of the article into them. Return only the JSON object, no commentary, no code fences.`;

export async function structureArticle(
  rawMd: string,
  existingTitles: string[],
): Promise<StructuredArticle> {
  if (!rawMd.trim()) {
    throw BadRequest('Cannot structure empty content');
  }

  const userPrompt = `Existing articles:\n${existingTitles.map((t) => `- ${t}`).join('\n')}\n\nExtract metadata for this markdown:\n\n---\n${rawMd}\n---`;

  // Upload structuring ALWAYS runs on the local Claude Code CLI (not the selectable chat
  // provider): no API key, no free-tier rate limits. The model returns metadata only and we keep
  // the article body verbatim, so output stays small and bounded regardless of document length
  // (no more truncated-JSON failures on big docs). Retry once to absorb a rare transient hiccup.
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await runLocalClaude(SYSTEM_PROMPT, userPrompt);
      const parsed = parseJsonResponse<Record<string, unknown>>(text, 'Local Claude Code');
      parsed.content = rawMd; // preserve the original markdown verbatim as the article content
      const result = StructuredArticleSchema.safeParse(parsed);
      if (!result.success) {
        throw BadRequest('AI response did not match expected schema', result.error.flatten());
      }
      return result.data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

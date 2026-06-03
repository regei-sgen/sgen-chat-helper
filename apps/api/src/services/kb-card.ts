import matter from 'gray-matter';
import type { ArticleCreateInput } from '@kb/shared';

// ============================================================================
// Reference KB-card ingestion (Stage A).
//
// The reference knowledge base ships ~2,000 "answer-ready" markdown cards: a rich YAML frontmatter
// block + a fixed body (## question → Short answer → Steps → links → Get more → Related). These are
// already QA-verified, so we ingest the frontmatter DIRECTLY into typed columns — no AI re-derivation
// (which would discard search_aliases / entry_kind / app_url / offers and cost tokens on every file).
//
// The ENTIRE original frontmatter is also kept verbatim in the `frontmatter` JSON column, so any key
// a future dataset introduces is preserved losslessly even if we never promote it to a column.
// ============================================================================

// A parsed reference card: the article create-input (status is set by the caller) plus the stable
// kbId used for idempotent re-ingest (upsert instead of duplicate).
export interface ParsedKbCard {
  kbId: string | null;
  input: Omit<ArticleCreateInput, 'status'>;
}

type Fm = Record<string, unknown>;

// Frontmatter keys that mark a file as a reference KB card (vs. plain hand-written markdown).
const SIGNATURE_KEYS = ['kb_id', 'entry_kind', 'search_aliases', 'question'];

// gray-matter already parses YAML flow arrays (`[a, b]`) into JS arrays; tolerate a bare string or
// a missing value so a malformed card still ingests rather than throwing.
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** True when the markdown carries reference-style frontmatter we should ingest directly (no AI). */
export function isKbCard(raw: string): boolean {
  try {
    const { data } = matter(raw);
    return Boolean(data) && typeof data === 'object' && SIGNATURE_KEYS.some((k) => k in (data as Fm));
  } catch {
    return false;
  }
}

// Pull the "**Short answer:** …" paragraph out of the body to use as the summary. Stops at the next
// blank line, bold label, markdown link, or heading — i.e. the first paragraph only.
function extractShortAnswer(body: string): string | null {
  const m = body.match(
    /\*\*Short answer:\*\*\s*([\s\S]*?)(?:\n\s*\n|\n\s*\*\*|\n\s*\[|\n\s*#{1,6}\s|$)/i,
  );
  const s = m?.[1]?.replace(/\s+/g, ' ').trim();
  return s || null;
}

// Parse the numbered "**Steps:**" list into structured steps. Each "1. …" line becomes one step,
// in document order; we stop at the next section (heading, link, **Related**, **You might**).
function extractSteps(
  body: string,
): { order: number; title: string; content: string; imageUrl: null }[] {
  const idx = body.search(/\*\*Steps:\*\*/i);
  if (idx === -1) return [];
  const lines = body.slice(idx).split(/\r?\n/);
  const steps: { order: number; title: string; content: string; imageUrl: null }[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s+(.*\S)\s*$/);
    if (m) {
      const text = m[1].trim();
      steps.push({ order: steps.length, title: text, content: text, imageUrl: null });
    } else if (steps.length && /^\s*(#{1,6}\s|\[|\*\*Related|\*\*You might|\*\*Short)/i.test(line)) {
      break; // reached the next section
    }
  }
  return steps;
}

/**
 * Parse a reference KB card into an article create-input. Assumes `isKbCard(raw)` is true; if YAML
 * parsing fails it throws (the caller falls back to the AI / as-is path).
 */
export function parseKbCard(raw: string, filename?: string): ParsedKbCard {
  const parsed = matter(raw);
  const fm = (parsed.data ?? {}) as Fm;
  const body = parsed.content.trim();

  const question = str(fm.question);
  const headingTitle = body.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() ?? null;
  const fromFile = filename?.replace(/\.[^.]+$/, '').trim() || null;
  // The card's canonical question is the best title; fall back to the body's heading, then filename.
  const title = question || headingTitle || fromFile || 'Untitled';

  const summary = extractShortAnswer(body) || question;

  const appUrl = str(fm.app_url);
  const docCanonical = str(fm.doc_canonical);
  // `sgenUrl` historically holds an ABSOLUTE SGEN URL (it is .url()-validated downstream). Map the
  // canonical docs URL there when it's absolute; the scheme-less in-app deep link lives in `appUrl`.
  const sgenUrl = docCanonical && /^https?:\/\//i.test(docCanonical) ? docCanonical : null;

  const kbId = str(fm.kb_id);

  const input: Omit<ArticleCreateInput, 'status'> = {
    title,
    // No explicit slug: createArticle derives a unique, valid slug from the title. (doc_slug like
    // "common-tasks/go-live" isn't a legal slug, and a provided slug isn't uniquified downstream.)
    summary,
    content: body || summary || title,
    // productArea (our SG_CORE/SG_MODULES/SG_DASHBOARD enum) has no honest 1:1 with the reference
    // pillars, so leave it null; the real value lives in the dynamic productPillar field.
    feature: null,
    productArea: null,
    difficulty: null,
    sgenUrl,
    steps: extractSteps(body),
    tags: strArray(fm.tags),
    // Relationships are built by the AI Link Arranger (Stage B); frontmatter `related` is preserved
    // verbatim in the `frontmatter` catch-all below.
    prerequisiteIds: [],
    relatedIds: [],
    // ---- Promoted frontmatter columns ----
    kbId,
    question,
    entryKind: str(fm.entry_kind),
    intent: str(fm.intent),
    productPillar: str(fm.product_pillar),
    classification: str(fm.classification),
    surveyStatus: str(fm.survey_status),
    appUrl,
    docCanonical,
    searchAliases: strArray(fm.search_aliases),
    offers: strArray(fm.offers),
    similarTopics: strArray(fm.similar_topics),
    // Lossless catch-all: the full original frontmatter object.
    frontmatter: fm,
  };

  return { kbId, input };
}

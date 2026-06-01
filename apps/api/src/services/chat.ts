import type { ChatMessage, Walkthrough } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { runProvider, parseJsonResponse } from './ai.js';
import { hybridSearch } from './search.js';

const MIN_CONFIDENCE = 0.18;
// "Is the local search clear enough to answer WITHOUT the AI?" thresholds (deterministic, tunable).
// CLEAR_CONFIDENCE: the top match's vector similarity must be at least this high.
// AMBIGUITY_GAP: the top match must beat the runner-up by at least this much. If either check
// fails and there are multiple candidates, the query is "too complex" → escalate to the AI rerank.
// Raise these to call the AI more often (safer); lower them to use AI less (cheaper).
const CLEAR_CONFIDENCE = 0.35;
const AMBIGUITY_GAP = 0.08;

const COMPOSE_SYSTEM = `You are the SGEN Help Assistant. Answer the user's question using ONLY the provided Knowledge Base Article(s) — do not use outside knowledge or invent features, menu paths, or steps.

You may be given more than one article. Use every article that is relevant to the question and ignore any that are not. If the question asks about multiple things (a "combination" question, e.g. "how do I add blogs and pages"), answer each part from its matching article under its own short markdown heading.

Be warm and concise. Lead with the direct answer. When an article lists steps, present them as a numbered list. Use the articles' exact menu paths and terms. If the provided articles do not actually answer the question, say you don't have that information yet and suggest where in SGEN to look or to rephrase. End with a line: "Source: <the article title(s) you used>". Format in markdown.`;

// The retrieval JUDGE: given the question + candidate articles, pick which ACTUALLY answer it.
// This is the "analyze → get the right knowledge" stage — local search has good recall but
// drifts on intent; the AI reranks by what the user is trying to DO.
const RERANK_SYSTEM = `You are the retrieval judge for the SGEN Help Assistant. Given the user's question and a numbered list of candidate knowledge-base articles (id, title, summary), choose the article(s) that ACTUALLY answer the question — most relevant first.

SGEN orientation (to disambiguate intent): a site's brand LOGO, favicon, site title, site email, social links and business info are set in SITE SETTINGS. The SG-Builder editor is for building and styling page layouts. The Component Library lists draggable page components. Choose by what the user is trying to DO, not by keyword overlap.

Pick 1 to 3 ids. If NONE of the candidates genuinely answer the question, return an empty list. Return ONLY JSON: {"ids":["<id>", ...]}.`;

async function rerankArticles(
  message: string,
  candidates: { id: string; title: string; summary: string | null; feature: string | null }[],
): Promise<string[]> {
  const list = candidates
    .map(
      (a, i) =>
        `${i + 1}. id=${a.id} — ${a.title}${a.feature ? ` [${a.feature}]` : ''}\n   ${a.summary ?? ''}`,
    )
    .join('\n');
  const text = await runProvider(
    RERANK_SYSTEM,
    `User question: "${message}"\n\nCandidates:\n${list}\n\nReturn JSON {"ids":[...]} — most relevant first, or {"ids":[]} if none answer it.`,
    { maxTokens: 200, json: true },
  );
  const parsed = parseJsonResponse<{ ids?: unknown }>(text, 'rerank');
  const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
  return ids
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => candidates.some((c) => c.id === id));
}

function historyText(history?: ChatMessage[]): string {
  if (!history?.length) return '';
  return (
    'Recent conversation:\n' +
    history
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n') +
    '\n\n'
  );
}

export interface ChatResult {
  reply: string;
  usedKnowledgeBase: boolean;
  sources: { title: string; slug: string }[];
  links: { label: string; url: string }[];
  followups: { label: string; message: string }[];
  confidence: number | null;
  matchedId: string | null;
  walkthrough?: Walkthrough | null;
}

// Starter buttons (used for greetings and no-match) so the user always has a way forward.
async function starterFollowups(): Promise<{ label: string; message: string }[]> {
  const articles = await prisma.article.findMany({
    where: { status: 'PUBLISHED' },
    select: { title: true, feature: true },
    orderBy: { createdAt: 'asc' },
    take: 4,
  });
  return articles.map((a) => ({ label: a.feature || a.title, message: a.title }));
}

export async function chat(message: string, history?: ChatMessage[]): Promise<ChatResult> {
  const trimmed = message.trim();

  // Fast path: greetings / thanks need neither the AI nor the KB. This also keeps the
  // bot responsive when the AI provider is briefly rate-limited (e.g. free tier).
  if (/^(hi|hello|hey|hiya|howdy|yo|greetings|good\s*(morning|afternoon|evening|day))\b[\s!.,]*$/i.test(trimmed)) {
    return {
      reply:
        "Hi! I'm the SGEN Help Assistant. Ask me anything about your SGEN site — or pick a topic below to get started.",
      usedKnowledgeBase: false,
      sources: [],
      links: [],
      followups: await starterFollowups(),
      confidence: null,
      matchedId: null,
    };
  }
  if (/^(thanks|thank\s*you|ty|thx|cheers|appreciate it)\b[\s!.,]*$/i.test(trimmed)) {
    return {
      reply: "You're welcome! Anything else I can help you with on SGEN?",
      usedKnowledgeBase: false,
      sources: [],
      links: [],
      followups: [],
      confidence: null,
      matchedId: null,
    };
  }

  // 1) NON-AI SEARCH FIRST. Greetings/thanks were handled above by regex; every other message
  // goes straight to the local hybrid search (pgvector + full-text) — no AI call, no tokens.
  const result = await hybridSearch(message);

  let primary = result.primary;
  let supporting = result.supporting;
  let confident = !!result.primary && result.confidence >= MIN_CONFIDENCE;

  // 2) Is the local result CLEAR, or is the query "too complex / ambiguous"? Clear = the top
  // match is confident AND clearly ahead of the runner-up → answer with ZERO AI calls. Ambiguous
  // (several close candidates, e.g. "add a logo" matching Site Settings vs the editor vs the
  // component library) → spend ONE AI call to judge which article actually fits the intent.
  // Use the ACTUAL vector similarities of the top two candidates — NOT result.confidence, which
  // falls back to a flat 0.5 baseline for keyword-only matches and would falsely look "clear".
  const topVecSim = result.candidates[0]
    ? (result.topMatches.find((m) => m.id === result.candidates[0].id)?.similarity ?? 0)
    : 0;
  const secondVecSim = result.candidates[1]
    ? (result.topMatches.find((m) => m.id === result.candidates[1].id)?.similarity ?? 0)
    : 0;
  // Clear = a single candidate, OR the top vector match is strong AND clearly ahead of the
  // runner-up. A pure keyword match (topVecSim ~ 0) is never "clear" — let the AI judge it.
  const clearMatch =
    confident &&
    (result.candidates.length === 1 ||
      (topVecSim >= CLEAR_CONFIDENCE && topVecSim - secondVecSim >= AMBIGUITY_GAP));

  // Gate telemetry: shows whether a query was answered locally (free) or escalated to the AI.
  console.log(
    `[chat:gate] q=${JSON.stringify(message)} top=${topVecSim.toFixed(3)} second=${secondVecSim.toFixed(3)} ` +
      `gap=${(topVecSim - secondVecSim).toFixed(3)} cands=${result.candidates.length} clear=${clearMatch} -> ` +
      (clearMatch ? 'LOCAL (no AI)' : confident ? 'AI rerank' : 'no-answer'),
  );
  console.log(
    '[chat:gate]   candidates:',
    result.candidates.map((a, i) => `${i + 1}.${a.feature || a.title}`).join(' | '),
  );

  if (confident && !clearMatch && result.candidates.length > 1) {
    // Too ambiguous for local search alone — escalate to the AI rerank to judge intent.
    try {
      const pickedIds = await rerankArticles(message, result.candidates);
      const byId = new Map(result.candidates.map((a) => [a.id, a]));
      const chosen = pickedIds
        .map((id) => byId.get(id))
        .filter((a): a is (typeof result.candidates)[number] => Boolean(a));
      console.log(
        '[chat:rerank] picked:',
        chosen.map((a) => a.feature || a.title).join(' | ') || '(none)',
      );
      if (pickedIds.length === 0) {
        confident = false; // the AI judged that none of the candidates answer the question
      } else if (chosen.length) {
        primary = chosen[0];
        supporting = chosen.slice(1, 3);
        confident = true; // the AI vouched for this match
      }
    } catch (err) {
      // AI unavailable — keep the local top match (the clear-match path already chose it).
      console.warn(
        '[chat:rerank] FAILED -> local fallback:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!primary || !confident) {
    return {
      reply:
        "I don't have anything in the knowledge base about that yet. Try rephrasing, or pick a topic below.",
      usedKnowledgeBase: false,
      sources: [],
      links: [],
      followups: await starterFollowups(),
      confidence: result.confidence ?? null,
      matchedId: null,
    };
  }

  // 3) We have a match. Build the shared interactive elements first:
  // related/prerequisite follow-up buttons (across every answered article) and each
  // answered article's external doc URL as a link.
  const articles = [primary, ...supporting];

  const answeredIds = new Set(articles.map((a) => a.id));
  const followupRefs = articles.flatMap((a) => [...a.relatedTo, ...a.prerequisites]);
  const seen = new Set<string>();
  const followups = followupRefs
    .filter((r) => !answeredIds.has(r.id) && !seen.has(r.id) && (seen.add(r.id), true))
    .slice(0, 4)
    .map((r) => ({ label: r.title, message: r.title }));

  const linkSeen = new Set<string>();
  const links = articles
    .filter((a) => a.sgenUrl && !linkSeen.has(a.sgenUrl) && (linkSeen.add(a.sgenUrl), true))
    .map((a) => ({
      label: articles.length === 1 ? 'Open the related SGEN docs' : `Open: ${a.title}`,
      url: a.sgenUrl as string,
    }));

  const srcSeen = new Set<string>();
  const sources = [...articles, ...primary.relatedTo]
    .filter((a) => !srcSeen.has(a.id) && (srcSeen.add(a.id), true))
    .map((a) => ({ title: a.title, slug: a.slug }));

  // 3a) If any matched article is a procedural how-to (has structured steps), return an
  // INTERACTIVE walkthrough. The client reveals ONE step at a time, each with a Next button.
  // For a MULTI-TOPIC ("combination") question the search returns `supporting` articles too,
  // so we COMBINE every matched topic's steps into ONE guided flow, grouped by topic, in the
  // search's relevance order. Grounded in the KB's own structured steps — no AI call needed.
  const withSteps = articles.filter((a) => a.steps && a.steps.length > 0);
  if (withSteps.length > 0) {
    let n = 0;
    const steps = withSteps.flatMap((a) => {
      const group = a.feature || a.title;
      return [...a.steps]
        .sort((s1, s2) => s1.order - s2.order)
        .map((s) => ({
          n: (n += 1),
          title: s.title,
          body: s.content,
          group,
          // Carry the source article's slug onto the step when present, so the client
          // can link the step back to its knowledge-base article.
          slug: a.slug || undefined,
          highlight: false,
          imageUrl: s.imageUrl ?? null,
        }));
    });
    const topics = withSteps.map((a) => a.feature || a.title);

    // Intent scoping: find the step(s) whose text best covers the user's DISTINCTIVE
    // keywords, so we can take them straight to the part they asked about (e.g. "logo")
    // instead of making them read every step. Deterministic — needs no AI call.
    const STOP = new Set(
      ('the a an to of in on at for and or with you your is are be can it this that how do does did i me my we our us ' +
        'add new set setup configure manage create make build use using want need help know show tell give find about ' +
        'where what which when site page').split(' '),
    );
    const qWords = Array.from(
      new Set(
        (message.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)),
      ),
    );
    let focusStep: number | undefined;
    if (qWords.length) {
      const scored = steps.map((s) => {
        const hay = `${s.title} ${s.body}`.toLowerCase();
        return qWords.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
      });
      const best = Math.max(...scored);
      if (best > 0) {
        steps.forEach((s, i) => {
          if (scored[i] === best) s.highlight = true;
        });
        focusStep = steps.find((s) => s.highlight)?.n;
      }
    }

    const walkthrough: Walkthrough = {
      title: topics.join(' + '),
      steps,
      source: withSteps.map((a) => a.title).join(', '),
      focusStep,
    };
    let reply =
      topics.length > 1
        ? `You asked about ${topics.length} things — ${topics.join(', ')}. I'll walk you through each one, step by step. Hit Next to move through them.`
        : withSteps[0].summary?.trim() ||
          `Here's how to ${topics[0]}. I'll walk you through it one step at a time — hit Next to move through each step.`;
    if (focusStep) {
      reply += `\n\nThe part you're asking about is **step ${focusStep}** — I've taken you there. Use Next for the rest.`;
    }
    return {
      reply,
      usedKnowledgeBase: true,
      sources,
      links,
      followups,
      confidence: result.confidence,
      matchedId: primary.id,
      walkthrough,
    };
  }

  // 3b) Otherwise (no structured steps) compose a grounded prose answer from the
  // retrieved article(s). For a combination question, every relevant article is included.
  const stepsOf = (a: (typeof articles)[number]) =>
    (a.steps || []).map((s, i) => `${i + 1}. ${s.title} — ${s.content}`).join('\n');

  const kb = articles
    .map((a, i) =>
      [
        `--- Knowledge Base Article ${i + 1} ---`,
        `Title: ${a.title}`,
        `Summary: ${a.summary ?? ''}`,
        `Article:\n${a.content}`,
        stepsOf(a) && `Steps:\n${stepsOf(a)}`,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  let reply: string;
  try {
    reply = (
      await runProvider(
        COMPOSE_SYSTEM,
        `${historyText(history)}User question: "${message}"\n\nKnowledge Base Article(s):\n${kb}\n\nWrite the answer now.`,
        { maxTokens: 1024, json: false },
      )
    ).trim();
  } catch {
    // AI composition failed (e.g. provider rate limit) — fall back to the article(s) themselves.
    reply =
      (articles.length === 1
        ? [primary.summary, stepsOf(primary)].filter(Boolean).join('\n\n')
        : articles
            .map((a) => [`**${a.title}**`, a.summary, stepsOf(a)].filter(Boolean).join('\n\n'))
            .join('\n\n')) + `\n\nSource: ${articles.map((a) => a.title).join(', ')}`;
  }

  return {
    reply,
    usedKnowledgeBase: true,
    sources,
    links,
    followups,
    confidence: result.confidence,
    matchedId: primary.id,
    walkthrough: null,
  };
}

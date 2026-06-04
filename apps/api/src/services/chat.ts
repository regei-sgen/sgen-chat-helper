import type { ChatMessage, Walkthrough } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { hybridSearch } from './search.js';

// Minimum cosine similarity to treat a search hit as a real answer. Tuned to the measured gap
// between junk queries (random letters score ~0.15–0.28) and genuine questions (~0.41–0.68): below
// this, the chat shows "did you mean these?" suggestions instead of answering from an irrelevant
// nearest-neighbour match. (Raise it to be stricter / suggest more; lower it to answer more.)
const MIN_CONFIDENCE = 0.35;
// "Is the local search clear enough to answer with a SINGLE article?" thresholds (deterministic).
// CLEAR_CONFIDENCE: the top match's cosine (vector) similarity must be at least this high.
// AMBIGUITY_GAP: the top match must beat the runner-up by at least this much. If either check fails
// and there are multiple candidates, we show them ALL as "multiple results" for the user to pick.
// Raise these to be stricter about answering directly; lower them to answer with one article more.
const CLEAR_CONFIDENCE = 0.35;
const AMBIGUITY_GAP = 0.08;
// A STRONG absolute top match (e.g. the user typed an exact/near-exact article title) answers
// directly even when the runner-up sits close behind — many cards share a template ("Who can access
// X?") so their siblings are always near in embedding space, and that template-noise gap must NOT
// turn an exact hit into a "pick one" chooser.
const STRONG_CONFIDENCE = 0.45;
// When there is NO clear single winner, but several articles are plausibly relevant, the bot shows
// them ALL as "multiple results" (KB-grounded, no AI) instead of guessing one — this both serves
// users who'd rather choose. A candidate counts as "plausible" at >= MULTI_RESULT_FLOOR cosine
// similarity; at most MULTI_RESULT_MAX shown.
const MULTI_RESULT_FLOOR = 0.3;
const MULTI_RESULT_MAX = 3;

// ---- Deterministic multi-topic ("how do I add pages and blogs") detection — NO AI ----
// A query that joins DISTINCT topics with a conjunction is answered one-article-per-topic instead of
// collapsing to whichever single topic the blended query vector ranked highest. Comparison questions
// ("difference between X and Y") are NOT split — the KB answers those with their own "difference" card.
const COMPARISON_RE = /\b(difference between|compare|versus|vs\.?)\b/i;
const ACTION_RE =
  /\b(add|create|new|set ?up|setup|edit|delete|remove|find|use|open|manage|configure|publish|upload|change|enable|install|build|make|schedule|export|import)\b/i;

function splitTopics(q: string): string[] {
  if (COMPARISON_RE.test(q)) return [];
  const parts = q
    .split(/\s+(?:and|&|plus|also|as well as)\s+|,\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return parts.length >= 2 ? parts : [];
}

// Carry the first fragment's leading action stem ("how to add") onto bare trailing fragments
// ("blogs too" → "how to add blogs") so each fragment searches WITH its verb, not as a bare noun —
// which markedly improves the per-fragment match (measured: bare "blogs too" mis-hit a comparison
// card; "how to add blogs" hit "How do I add a new blog?").
function expandFragments(frags: string[]): string[] {
  const m = frags[0].match(
    /^(.*?\b(?:add|create|new|set ?up|setup|edit|delete|remove|find|use|open|manage|configure|publish|upload|change|enable|install|build|make|schedule|export|import))\b/i,
  );
  const stem = m ? m[1].trim() : '';
  return frags.map((f, i) =>
    i === 0 || !stem || ACTION_RE.test(f) ? f : `${stem} ${f.replace(/\btoo\b/i, '').trim()}`,
  );
}

// NOTE: the chat is fully DETERMINISTIC — no LLM. Answers come only from local cosine-similarity
// (pgvector, local MiniLM embeddings) + Postgres full-text search. When the search finds no
// confident match, the no-answer branch offers the closest candidates as clickable suggestions.
// (The old AI reranker / AI compose are removed: zero external API calls per query → scales freely.)

// A short, readable topic name from an article — its `feature` if set, else the title stripped of
// the question scaffolding ("How do I set up Events?" → "Events"; "Why isn't the New Page screen
// working?" → "New Page screen"). Keeps multi-topic prose/headers from reading like full questions.
function topicLabel(title: string, feature: string | null): string {
  if (feature && feature.trim()) return feature.trim();
  let t = title.trim().replace(/\?+$/, '');
  t = t.replace(
    /^(how do i|how to|what(?:'s| is)|who can access|where (?:do i find|is)|why isn'?t|can i|is|do i)\s+/i,
    '',
  );
  t = t.replace(/^(find and use|set ?up|add a new|add|create|open|manage|configure|use)\s+/i, '');
  t = t.replace(/^the\s+/i, '');
  t = t.replace(/\s+working$/i, '');
  return t.trim() || title;
}

// Join topic names into readable prose: "A", "A and B", "A, B and C". De-dupe upstream so this
// never renders a repeated list like "Users, Users and Users".
function fmtList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Make a KB article read as a conversational answer WITHOUT an AI call, while keeping the article's
// real structure: every section heading (## / ###, e.g. "Get more from SGEN") AND its links are kept
// verbatim. We only drop genuine redundancy — the top-level TITLE heading (# H1, already conveyed by
// the summary + source pills), the "**Short answer:**" line (it just repeats the summary we lead
// with), and a trailing "Source:" line (redundant with the source pills the UI renders).
function articleBody(content: string | null): string {
  if (!content) return '';
  const kept = content.split('\n').filter((raw) => {
    const line = raw.trim();
    if (/^#\s/.test(line)) return false; // drop ONLY the H1 title — keep ## / ### section headings
    if (/^\*\*short answer:?\*\*/i.test(line)) return false; // duplicate of the summary
    if (/^source\s*:/i.test(line)) return false; // redundant with the source pills the UI renders
    return true;
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// For a STEP-based article the structured steps already render as the interactive stepper, so we
// don't re-list them as text. This pulls out the article's OTHER main content — intro/extra prose,
// the "Reach it from …" guidance, trailing sections like "### Get more from SGEN", and links — by
// dropping the article's own title heading, the "**Short answer:**" line, and the "**Steps:**"
// numbered list. Returns '' when nothing but the steps/summary remain (thin KB cards add nothing).
function walkthroughExtra(content: string | null): string {
  if (!content) return '';
  const out: string[] = [];
  let droppedTitle = false;
  let inSteps = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!droppedTitle && /^#{1,6}\s/.test(line)) {
      droppedTitle = true; // the article's own title heading (later headings like "### Get more…" stay)
      continue;
    }
    if (/^\*\*short answer:?\*\*/i.test(line)) continue; // = the summary we already lead with
    if (/^source\s*:/i.test(line)) continue;
    if (/^\*\*related:?\*\*/i.test(line)) continue; // redundant with the Related/source pills the UI renders
    if (/^\*\*you might also ask about:?\*\*/i.test(line)) continue; // redundant with the follow-up buttons
    if (/^\*\*steps:?\*\*/i.test(line)) {
      inSteps = true; // the steps render in the stepper, not as a duplicate numbered list
      continue;
    }
    if (inSteps) {
      if (line === '' || /^\d+\.\s/.test(line)) continue;
      inSteps = false; // first non-step line ends the steps block
    }
    out.push(raw);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

// `_history` (recent conversation) is accepted for the call signature but currently unused — it was
// only consumed by the removed AI compose; the deterministic answer paths don't need it.
export async function chat(message: string, _history?: ChatMessage[]): Promise<ChatResult> {
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
  let answered = false;

  // 1b) DETERMINISTIC MULTI-TOPIC (no AI). If the message joins distinct topics with a conjunction,
  // search EACH topic separately and, when they resolve to DIFFERENT confident articles, answer each
  // — so "how do I add pages and blogs" answers BOTH, instead of collapsing to the single topic the
  // blended query vector ranked highest. Only runs when a (non-comparison) conjunction is present, so
  // ordinary single-topic queries skip it entirely.
  const topicFrags = splitTopics(message);
  if (topicFrags.length >= 2) {
    const perTopic = await Promise.all(expandFragments(topicFrags).map((f) => hybridSearch(f)));
    const seen = new Set<string>();
    const picked: typeof result.candidates = [];
    for (const res of perTopic) {
      const p = res.primary;
      if (p && (res.confidence ?? 0) >= MIN_CONFIDENCE && !seen.has(p.id)) {
        seen.add(p.id);
        picked.push(p);
      }
    }
    if (picked.length >= 2) {
      primary = picked[0];
      supporting = picked.slice(1, 3); // answer up to 3 topics
      answered = true;
      console.log('[chat:multitopic] topics ->', picked.map((a) => a.feature || a.title).join(' | '));
    }
  }

  // 2) Is the local result CLEAR enough to answer with ONE article? CLEAR = a confident top cosine
  // (vector) match clearly ahead of the runner-up → answer from it. Otherwise (ambiguous, or low
  // confidence but we DO have candidates) we show "multiple results" to pick from, or answer from the
  // local top if it clears the floor, or fall back to suggestions when nothing is confident. No AI.
  // topVec/secondVec use the ACTUAL vector similarities — NOT result.confidence, which falls back
  // to a flat 0.5 baseline for keyword-only matches and would falsely look "clear".
  const localConfident = !!primary && result.confidence >= MIN_CONFIDENCE;
  const topVecSim = result.candidates[0]
    ? (result.topMatches.find((m) => m.id === result.candidates[0].id)?.similarity ?? 0)
    : 0;
  const secondVecSim = result.candidates[1]
    ? (result.topMatches.find((m) => m.id === result.candidates[1].id)?.similarity ?? 0)
    : 0;
  const clearMatch =
    localConfident &&
    (result.candidates.length === 1 ||
      topVecSim >= STRONG_CONFIDENCE ||
      (topVecSim >= CLEAR_CONFIDENCE && topVecSim - secondVecSim >= AMBIGUITY_GAP));

  // Gate telemetry: which deterministic path a query took (single answer / multiple results / none).
  console.log(
    `[chat:gate] q=${JSON.stringify(message)} top=${topVecSim.toFixed(3)} second=${secondVecSim.toFixed(3)} ` +
      `gap=${(topVecSim - secondVecSim).toFixed(3)} cands=${result.candidates.length} clear=${clearMatch} -> ` +
      (clearMatch ? 'single' : result.candidates.length ? 'multiple/local-top' : 'no-answer'),
  );

  // AMBIGUOUS → MULTIPLE RESULTS (no AI). If there's no clear single winner but several articles are
  // plausibly relevant, show them all and let the user pick — rather than confidently answering from
  // one possibly-wrong article (e.g. "Who can access Sites?" matching "…Site Settings"). This is
  // KB-grounded and needs zero AI — no external provider, no rate limits, scales on local compute.
  if (!answered && !clearMatch) {
    const plausible = result.candidates
      .map((c) => ({ c, sim: result.topMatches.find((m) => m.id === c.id)?.similarity ?? 0 }))
      .filter((x) => x.sim >= MULTI_RESULT_FLOOR)
      .slice(0, MULTI_RESULT_MAX);
    if (plausible.length >= 2) {
      const picks = plausible.map((x) => x.c);
      console.log('[chat:multi] offering:', picks.map((p) => p.feature || p.title).join(' | '));
      const body = picks
        .map((p) => `**${p.title}**${p.summary ? ` — ${p.summary.trim()}` : ''}`)
        .join('\n\n');
      const srcSeen = new Set<string>();
      return {
        reply: `I found a few things that might match — tap the closest:\n\n${body}`,
        usedKnowledgeBase: true,
        sources: picks
          .filter((p) => !srcSeen.has(p.id) && (srcSeen.add(p.id), true))
          .map((p) => ({ title: p.title, slug: p.slug })),
        links: [],
        followups: picks.map((p) => ({ label: p.feature || p.title, message: p.title })),
        confidence: plausible[0].sim,
        matchedId: null,
      };
    }
  }

  if (!answered && primary && clearMatch) {
    // Confident, unambiguous local match → answer from this ONE article with no AI. Drop any
    // search-derived `supporting`: a clear match is always single-article. (Genuine multi-topic
    // questions are caught by the conjunction split above; this single-collapse only applies when
    // that didn't fire.) Collapsing here keeps articles.length===1.
    supporting = [];
    answered = true;
  } else if (!answered && result.candidates.length > 0) {
    // No clear single winner — and NO AI. Answer from the local cosine-similarity top match when it
    // clears the confidence floor; otherwise leave it unanswered so the no-answer branch below
    // offers the closest candidates as clickable suggestions. Fully deterministic, zero API calls.
    supporting = [];
    answered = localConfident;
  }

  if (!answered || !primary) {
    // No confident answer. Offer the CLOSEST near-misses — the top search candidates that didn't
    // clear the bar — so the suggestions relate to what the user typed; fall back to starter topics
    // only when the search surfaced nothing at all. Either way: zero AI calls.
    const nearMisses = result.candidates
      .slice(0, 4)
      .map((c) => ({ label: c.feature || c.title, message: c.title }));
    return {
      reply: nearMisses.length
        ? "I don't have a direct answer for that yet — did you mean one of these?"
        : "I don't have anything in the knowledge base about that yet. Try rephrasing, or pick a topic below.",
      usedKnowledgeBase: false,
      sources: [],
      links: [],
      followups: nearMisses.length ? nearMisses : await starterFollowups(),
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
    // Each step's admin page route (e.g. "/sg-admin/settings") powers the clickable "open this
    // page" button under the step. We look for it in two places, because the AI structurer often
    // rewrites a step into a short summary that DROPS the literal /sg-admin/... path — but the
    // article's VERBATIM markdown (a.content) always keeps it. So: prefer the route named in the
    // step's own text; otherwise pull it from the matching section of the verbatim content; and
    // for any step that still names no new page, carry forward the last page the walkthrough was on.
    const ROUTE_RE = /\/sg-admin[a-zA-Z0-9/_-]*/;
    // Read one route per "## " section of the verbatim markdown (our import docs are one step per
    // section), carrying the last seen route forward. Only trusted when the section count lines up
    // 1:1 with the step count, so it can't mis-map articles that don't follow that shape.
    const routesFromContent = (content: string | null, count: number): (string | undefined)[] => {
      if (!content) return [];
      const sections = content.split(/^##\s+/m).slice(1);
      if (sections.length !== count) return [];
      let last: string | undefined;
      return sections.map((sec) => {
        const m = sec.match(ROUTE_RE);
        if (m) last = m[0];
        return last;
      });
    };
    const steps = withSteps.flatMap((a) => {
      const group = topicLabel(a.title, a.feature);
      const ordered = [...a.steps].sort((s1, s2) => s1.order - s2.order);
      const contentRoutes = routesFromContent(a.content, ordered.length);
      // Seed the carry-forward with the first route found anywhere (step text, then verbatim body).
      let route =
        ordered.map((s) => s.content.match(ROUTE_RE)?.[0]).find(Boolean) ||
        contentRoutes.find(Boolean) ||
        a.content?.match(ROUTE_RE)?.[0] ||
        undefined;
      return ordered.map((s, i) => {
        const found = s.content.match(ROUTE_RE)?.[0] || contentRoutes[i];
        if (found) route = found;
        return {
          n: (n += 1),
          title: s.title,
          body: s.content,
          group,
          // Slug of the source article (links the step back to its KB article).
          slug: a.slug || undefined,
          // The admin page this step happens on — explicit route if named, else carried forward.
          route,
          highlight: false,
          imageUrl: s.imageUrl ?? null,
        };
      });
    });
    // De-dupe so several matched articles sharing one feature don't render "Users, Users, Users".
    const topics = [...new Set(withSteps.map((a) => topicLabel(a.title, a.feature)))];

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
        // Only JUMP to the step for a single-topic walkthrough. The client reveals every step up
        // to focusStep, so in a multi-topic (combination) flow that would expose all of an earlier
        // topic's steps — there we just badge the most-relevant step and leave focusStep unset.
        if (withSteps.length === 1) focusStep = steps.find((s) => s.highlight)?.n;
      }
    }

    // The article's OTHER main content — intro/extra prose, links, and trailing sections like
    // "### Get more from SGEN" — carried as the walkthrough FOOTER so the UI renders it AFTER the
    // steps (answer → steps → extras). The steps themselves stay in the interactive stepper.
    const footer = withSteps
      .map((a) => walkthroughExtra(a.content))
      .filter(Boolean)
      .join('\n\n');
    const walkthrough: Walkthrough = {
      title: topics.join(' + '),
      steps,
      source: withSteps.map((a) => a.title).join(', '),
      focusStep,
      ...(footer ? { footer } : {}),
    };
    let reply =
      topics.length > 1
        ? `Here's how to ${fmtList(topics)}.`
        : withSteps[0].summary?.trim() || `Here's how to ${topics[0]}.`;
    if (focusStep) {
      reply += `\n\nThe part you asked about is in **step ${focusStep}** — I've started you there.`;
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

  // 3b) None of the matched articles are step-based. Answer DIRECTLY from the KB — ZERO AI — whether
  // one article or several:
  //   • ONE article  → conversational summary + cleaned body.
  //   • MULTIPLE (a combination question) → each topic under its own heading, from its own article.
  // A small helper turns one article into its conversational lead + cleaned body (no duplicate
  // summary, no bare doc-link lines, no "Source:" trailer — the UI shows source pills).
  const articleAnswer = (a: (typeof articles)[number]): string => {
    const lead = a.summary?.trim() ?? '';
    let body = articleBody(a.content);
    if (lead && body.startsWith(lead)) body = body.slice(lead.length).trim();
    return [lead, body].filter(Boolean).join('\n\n');
  };

  let reply: string;
  if (articles.length === 1) {
    reply = articleAnswer(primary) || primary.title;
  } else {
    // Combination answer, grounded one topic per article — no AI, no provider dependency.
    reply = articles
      .map((a) =>
        [`## ${topicLabel(a.title, a.feature)}`, articleAnswer(a)].filter(Boolean).join('\n\n'),
      )
      .join('\n\n');
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

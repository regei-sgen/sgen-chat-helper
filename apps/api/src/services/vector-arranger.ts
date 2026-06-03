import type { AutoLinkProposal } from '@kb/shared';
import { prisma } from '../lib/prisma.js';

// No-AI Link Arranger: connects articles by their stored embedding cosine similarity (pgvector),
// so it works at any corpus size with NO token limits, NO API cost, and is fully deterministic —
// unlike the AI Link Arranger (auto-link.ts), which sends every article in one LLM call and
// stalls/truncates past a few hundred articles.
//
// RELATED links: each article links to its RELATED_K nearest neighbours (above SIM_FLOOR), symmetric.
// PREREQUISITE links: cosine alone is directionless, but the reference KB cards carry an `intent`
// field, and each component has a foundational "What is X?" card (intent='what'). So for any
// non-foundational article, its nearest 'what'-intent neighbour (above the tighter PREREQ_SIM_FLOOR,
// i.e. same component) is treated as a PREREQUISITE — a real, no-AI directional signal.
//
// Apply is ADDITIVE + ATOMIC: it only `connect`s related/prerequisite links (never set/disconnect),
// so existing links, the seeded links, and any prior AI arrangement all survive; re-running tops up.

// Tuned against the live corpus (MiniLM embeddings): rank-1 neighbour median cosine ~0.9, rank-5
// ~0.83; same-component cards (e.g. "What is X?" vs "How do I X?") sit very high (>=0.6). Tune here.
const RELATED_K = 5;
const SIM_FLOOR = 0.5;
const NEIGHBOR_POOL = 8; // neighbours examined per article (related is drawn from the top RELATED_K)
const PREREQ_SIM_FLOOR = 0.6; // tighter: a prerequisite must be a near-duplicate-topic (same component)
const MAX_PREREQ = 2;
// Intents that mark a foundational/overview card — the kind that is a prerequisite for the rest of
// its component's cards. 'what' = "What is X?". (Kept narrow on purpose to avoid noisy prerequisites.)
const FOUNDATIONAL_INTENT = new Set(['what']);

interface NeighbourRow {
  src: string;
  nbr: string;
  similarity: number;
  nbrIntent: string | null;
}

// One self-join over the stored vectors: each source article's top-NEIGHBOR_POOL neighbours within
// the SAME embedding space (matching embeddingModel), ordered closest-first, carrying each
// neighbour's intent (so the prerequisite pass can spot foundational 'what' cards). Exact KNN —
// milliseconds at this corpus size. Mirrors the cosine `<=>` pattern in search.ts / dedup.ts.
async function nearestNeighbours(): Promise<NeighbourRow[]> {
  return prisma.$queryRawUnsafe<NeighbourRow[]>(
    `SELECT src, nbr, similarity, "nbrIntent" FROM (
       SELECT f.id AS src, a.id AS nbr,
              1 - (a.embedding <=> f.embedding) AS similarity,
              a.intent AS "nbrIntent",
              ROW_NUMBER() OVER (PARTITION BY f.id ORDER BY a.embedding <=> f.embedding) AS rnk
       FROM "Article" f
       JOIN "Article" a
         ON a.id <> f.id
        AND a.embedding IS NOT NULL
        AND a."embeddingModel" = f."embeddingModel"
       WHERE f.embedding IS NOT NULL AND f."embeddingModel" IS NOT NULL
     ) t
     WHERE rnk <= ${NEIGHBOR_POOL}`,
  );
}

interface Arrangement {
  prereqByArticle: Map<string, string[]>; // article -> its prerequisite ids (directional)
  relatedByArticle: Map<string, string[]>; // article -> its related ids (symmetric, prereqs removed)
}

// Turn the raw neighbour pool into per-article prerequisite + related id lists.
function buildArrangement(rows: NeighbourRow[], intentById: Map<string, string | null>): Arrangement {
  const bySrc = new Map<string, NeighbourRow[]>();
  for (const r of rows) {
    let arr = bySrc.get(r.src);
    if (!arr) bySrc.set(r.src, (arr = []));
    arr.push(r); // already ordered closest-first by the SQL window
  }

  // 1) Prerequisites (directional): a non-foundational article's nearest foundational ('what')
  //    neighbour(s) above the tight floor. Foundational articles themselves get none (they ARE the
  //    foundation). Track unordered prereq pairs so the related pass can't double-link the same pair.
  const prereqByArticle = new Map<string, string[]>();
  const prereqPairs = new Set<string>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [src, ns] of bySrc) {
    if (FOUNDATIONAL_INTENT.has(intentById.get(src) ?? '')) {
      prereqByArticle.set(src, []);
      continue;
    }
    const pre = ns
      .filter((n) => FOUNDATIONAL_INTENT.has(n.nbrIntent ?? '') && n.similarity >= PREREQ_SIM_FLOOR)
      .slice(0, MAX_PREREQ)
      .map((n) => n.nbr);
    prereqByArticle.set(src, pre);
    for (const p of pre) prereqPairs.add(pairKey(src, p));
  }

  // 2) Related (symmetric): each article's top RELATED_K neighbours above SIM_FLOOR, excluding any
  //    pair already linked as a prerequisite (in either direction) so an edge is never both.
  const relatedSets = new Map<string, Set<string>>();
  const addRel = (a: string, b: string) => {
    if (prereqPairs.has(pairKey(a, b))) return;
    let set = relatedSets.get(a);
    if (!set) relatedSets.set(a, (set = new Set()));
    set.add(b);
  };
  for (const [src, ns] of bySrc) {
    const top = ns.filter((n) => n.similarity >= SIM_FLOOR).slice(0, RELATED_K);
    for (const n of top) {
      addRel(src, n.nbr);
      addRel(n.nbr, src); // symmetric
    }
  }

  const relatedByArticle = new Map<string, string[]>();
  for (const [id, set] of relatedSets) relatedByArticle.set(id, [...set]);
  return { prereqByArticle, relatedByArticle };
}

// Build proposals in the shared AutoLinkProposal shape so the existing preview UI renders unchanged.
export async function previewVectorArrangement(): Promise<{
  proposals: AutoLinkProposal[];
  articleCount: number;
}> {
  const articles = await prisma.article.findMany({
    select: {
      id: true,
      title: true,
      intent: true,
      prerequisites: { select: { title: true } },
      relatedTo: { select: { title: true } },
    },
  });
  if (articles.length < 2) return { proposals: [], articleCount: articles.length };

  const intentById = new Map(articles.map((a) => [a.id, a.intent]));
  const titleById = new Map(articles.map((a) => [a.id, a.title]));
  const { prereqByArticle, relatedByArticle } = buildArrangement(await nearestNeighbours(), intentById);

  const proposals: AutoLinkProposal[] = articles.map((a) => {
    const prerequisiteIds = prereqByArticle.get(a.id) ?? [];
    const relatedIds = relatedByArticle.get(a.id) ?? [];
    return {
      id: a.id,
      title: a.title,
      prerequisiteIds,
      relatedIds,
      prerequisiteTitles: prerequisiteIds.map((id) => titleById.get(id) ?? id),
      relatedTitles: relatedIds.map((id) => titleById.get(id) ?? id),
      currentPrerequisiteTitles: a.prerequisites.map((p) => p.title),
      currentRelatedTitles: a.relatedTo.map((r) => r.title),
    };
  });

  return { proposals, articleCount: articles.length };
}

// ADDITIVE + ATOMIC apply. Recomputes server-side (deterministic, so it equals the preview) and only
// `connect`s related/prerequisite links — never set/disconnect. So nothing is ever wiped: existing
// prerequisites, the seeded links, and any prior AI-arranged links all survive; the whole batch
// commits in a single $transaction (all-or-nothing).
export async function applyVectorArrangement(): Promise<{
  updated: number;
  proposals: AutoLinkProposal[];
}> {
  const { proposals, articleCount } = await previewVectorArrangement();
  if (articleCount < 2) return { updated: 0, proposals: [] };

  const ops = proposals
    .map((p) => {
      const data: {
        relatedTo?: { connect: { id: string }[] };
        prerequisites?: { connect: { id: string }[] };
      } = {};
      if (p.relatedIds.length) data.relatedTo = { connect: p.relatedIds.map((id) => ({ id })) };
      if (p.prerequisiteIds.length)
        data.prerequisites = { connect: p.prerequisiteIds.map((id) => ({ id })) };
      return Object.keys(data).length ? prisma.article.update({ where: { id: p.id }, data }) : null;
    })
    .filter((op): op is NonNullable<typeof op> => op !== null);

  await prisma.$transaction(ops);
  return { updated: ops.length, proposals };
}

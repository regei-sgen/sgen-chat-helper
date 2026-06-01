import type { AutoLinkProposal } from '@kb/shared';
import { prisma } from '../lib/prisma.js';
import { runProvider, parseJsonResponse } from './ai.js';

const MAX_PREREQ = 3;
const MAX_RELATED = 4;

interface ArticleLite {
  id: string;
  title: string;
  summary: string | null;
  productArea: string | null;
  difficulty: string | null;
  tags: { name: string }[];
  prerequisites: { id: string; title: string }[];
  relatedTo: { id: string; title: string }[];
}

interface RawLink {
  id: string;
  prerequisiteIds?: string[];
  relatedIds?: string[];
}

const SYSTEM = `You organize a help knowledge base. You receive a list of articles (id, title, summary, area, difficulty, tags). For EACH article decide:
- prerequisiteIds: ids of articles a reader should understand or complete FIRST — genuine foundational dependencies, usually more basic / lower difficulty.
- relatedIds: ids of articles on the same or a complementary topic worth cross-linking.

Rules:
- Use ONLY ids that appear in the provided list.
- Never include an article's own id in its own lists.
- Be selective: at most ${MAX_PREREQ} prerequisites and ${MAX_RELATED} related per article.
- A prerequisite must be a real dependency, not merely a similar topic.
- Omit any link you are unsure about.

Return ONLY JSON in this exact shape, no commentary or code fences:
{"links":[{"id":"<id>","prerequisiteIds":["<id>"],"relatedIds":["<id>"]}]}`;

async function loadArticles(): Promise<ArticleLite[]> {
  const rows = await prisma.article.findMany({
    select: {
      id: true,
      title: true,
      summary: true,
      productArea: true,
      difficulty: true,
      tags: { select: { name: true } },
      prerequisites: { select: { id: true, title: true } },
      relatedTo: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows as unknown as ArticleLite[];
}

// Validate + cap + make `related` symmetric. Returns a map keyed by every article id.
function normalize(rawLinks: RawLink[], ids: Set<string>) {
  const prereq = new Map<string, Set<string>>();
  const related = new Map<string, Set<string>>();
  for (const id of ids) {
    prereq.set(id, new Set());
    related.set(id, new Set());
  }
  for (const link of rawLinks) {
    if (!link || !ids.has(link.id)) continue;
    for (const p of link.prerequisiteIds ?? []) {
      if (ids.has(p) && p !== link.id) prereq.get(link.id)!.add(p);
    }
    for (const r of link.relatedIds ?? []) {
      if (ids.has(r) && r !== link.id) {
        related.get(link.id)!.add(r);
        related.get(r)!.add(link.id); // symmetric
      }
    }
  }
  const result = new Map<string, { prerequisiteIds: string[]; relatedIds: string[] }>();
  for (const id of ids) {
    const prerequisiteIds = [...prereq.get(id)!].slice(0, MAX_PREREQ);
    const prSet = new Set(prerequisiteIds);
    const relatedIds = [...related.get(id)!].filter((r) => !prSet.has(r)).slice(0, MAX_RELATED);
    result.set(id, { prerequisiteIds, relatedIds });
  }
  return result;
}

export async function analyzeRelationships(): Promise<{
  proposals: AutoLinkProposal[];
  articleCount: number;
}> {
  const articles = await loadArticles();
  if (articles.length < 2) return { proposals: [], articleCount: articles.length };

  const ids = new Set(articles.map((a) => a.id));
  const titleById = new Map(articles.map((a) => [a.id, a.title]));

  const list = articles.map((a) => ({
    id: a.id,
    title: a.title,
    summary: a.summary ?? '',
    area: a.productArea,
    difficulty: a.difficulty,
    tags: a.tags.map((t) => t.name),
  }));

  const text = await runProvider(
    SYSTEM,
    `Articles:\n${JSON.stringify(list)}\n\nReturn the JSON arrangement now.`,
  );
  const parsed = parseJsonResponse<{ links?: RawLink[] }>(text, 'The AI provider');
  const normalized = normalize(parsed.links ?? [], ids);

  const proposals: AutoLinkProposal[] = articles.map((a) => {
    const n = normalized.get(a.id)!;
    return {
      id: a.id,
      title: a.title,
      prerequisiteIds: n.prerequisiteIds,
      relatedIds: n.relatedIds,
      prerequisiteTitles: n.prerequisiteIds.map((id) => titleById.get(id) ?? id),
      relatedTitles: n.relatedIds.map((id) => titleById.get(id) ?? id),
      currentPrerequisiteTitles: a.prerequisites.map((p) => p.title),
      currentRelatedTitles: a.relatedTo.map((r) => r.title),
    };
  });

  return { proposals, articleCount: articles.length };
}

// Replace every article's prerequisites/related with the given arrangement.
export async function applyArrangement(
  arrangement: { id: string; prerequisiteIds: string[]; relatedIds: string[] }[],
): Promise<{ updated: number }> {
  const all = await prisma.article.findMany({ select: { id: true } });
  const ids = new Set(all.map((a) => a.id));
  const normalized = normalize(arrangement, ids);

  let updated = 0;
  for (const id of ids) {
    const n = normalized.get(id)!;
    await prisma.article.update({
      where: { id },
      data: {
        prerequisites: { set: n.prerequisiteIds.map((x) => ({ id: x })) },
        relatedTo: { set: n.relatedIds.map((x) => ({ id: x })) },
      },
    });
    updated++;
  }
  return { updated };
}

export async function analyzeAndApply(): Promise<{ updated: number; proposals: AutoLinkProposal[] }> {
  const { proposals } = await analyzeRelationships();
  const arrangement = proposals.map((p) => ({
    id: p.id,
    prerequisiteIds: p.prerequisiteIds,
    relatedIds: p.relatedIds,
  }));
  const { updated } = await applyArrangement(arrangement);
  return { updated, proposals };
}

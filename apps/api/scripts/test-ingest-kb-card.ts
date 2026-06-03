// Stage A verification: ingest real reference KB cards and prove the frontmatter lands in columns.
//   npx tsx apps/api/scripts/test-ingest-kb-card.ts
import '../src/lib/env.js';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { processSingleMarkdown } from '../src/services/upload-processor.js';
import { isKbCard } from '../src/services/kb-card.js';

const REF =
  'C:\\Users\\Stephanie Piape\\Documents\\SGEN FILES\\SG HELP BOT APP\\DATA TO UPLOAD\\Jerome 001\\sg-helper-kb-2026-06-02232';

const CARDS = [
  `${REF}\\common-tasks\\kb-go-live.md`,
  `${REF}\\journeys\\kb-add-custom-fonts.md`,
  `${REF}\\help-gaps\\kb-can-i-access-my-database.md`,
];

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!user) throw new Error('No user in DB to attribute the article to');
  console.log('author:', user.email, '\n');

  for (const path of CARDS) {
    const file = basename(path);
    const content = readFileSync(path, 'utf8');
    const res = await processSingleMarkdown({
      content,
      authorId: user.id,
      autoPublish: true,
      filename: file,
    });
    const a = await prisma.article.findUnique({
      where: { id: res.articleId },
      include: { steps: { orderBy: { order: 'asc' } }, tags: true },
    });
    const emb = await prisma.$queryRawUnsafe<{ has: boolean }[]>(
      `SELECT (embedding IS NOT NULL) AS has FROM "Article" WHERE id = $1`,
      res.articleId,
    );
    console.log(`=== ${file}  | isKbCard=${isKbCard(content)} ===`);
    console.log({
      slug: a?.slug,
      kbId: a?.kbId,
      question: a?.question,
      entryKind: a?.entryKind,
      intent: a?.intent,
      productPillar: a?.productPillar,
      productArea: a?.productArea,
      classification: a?.classification,
      surveyStatus: a?.surveyStatus,
      appUrl: a?.appUrl,
      docCanonical: a?.docCanonical,
      sgenUrl: a?.sgenUrl,
      searchAliases: a?.searchAliases,
      offers: a?.offers,
      similarTopics: a?.similarTopics,
      tags: a?.tags.map((t) => t.name),
      stepCount: a?.steps.length,
      firstStep: a?.steps[0]?.title,
      status: a?.status,
      summary: a?.summary?.slice(0, 90),
      contentStartsWithFrontmatter: a?.content.startsWith('---'),
      contentHead: a?.content.slice(0, 70).replace(/\n/g, ' '),
      frontmatterKeyCount: a?.frontmatter ? Object.keys(a.frontmatter as object).length : null,
      embeddingSet: emb[0]?.has,
    });
    console.log('');
  }

  // Idempotent re-ingest: ingest kb-go-live AGAIN — expect the SAME row (upsert by kbId), not a dup.
  const before = await prisma.article.findUnique({
    where: { kbId: 'kb-go-live' },
    select: { id: true },
  });
  const again = await processSingleMarkdown({
    content: readFileSync(CARDS[0], 'utf8'),
    authorId: user.id,
    autoPublish: true,
    filename: 'kb-go-live.md',
  });
  const rows = await prisma.article.count({ where: { kbId: 'kb-go-live' } });
  console.log('=== idempotent re-ingest (kb-go-live) ===');
  console.log({
    firstId: before?.id,
    secondId: again.articleId,
    sameRow: before?.id === again.articleId,
    rowsWithThisKbId: rows,
  });

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

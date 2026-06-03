// Diagnostic: how many graph edges exist (prerequisites + relatedTo relations)?
//   npx tsx apps/api/scripts/diag-graph-edges.ts
import '../src/lib/env.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const total = await prisma.article.count();
  const articles = await prisma.article.findMany({
    select: {
      id: true,
      title: true,
      prerequisites: { select: { id: true } },
      relatedTo: { select: { id: true } },
      relatedFrom: { select: { id: true } },
    },
  });

  let prereqEdges = 0;
  let relatedToEdges = 0;
  let relatedFromEdges = 0;
  const withAny: string[] = [];
  for (const a of articles) {
    prereqEdges += a.prerequisites.length;
    relatedToEdges += a.relatedTo.length;
    relatedFromEdges += a.relatedFrom.length;
    if (a.prerequisites.length || a.relatedTo.length || a.relatedFrom.length) {
      withAny.push(
        `  ${a.title.slice(0, 50)} | prereq=${a.prerequisites.length} relatedTo=${a.relatedTo.length} relatedFrom=${a.relatedFrom.length}`,
      );
    }
  }

  console.log(`\n===== Graph edge diagnostic =====`);
  console.log(`articles total           = ${total}`);
  console.log(`prerequisite edges       = ${prereqEdges}`);
  console.log(`relatedTo edges          = ${relatedToEdges}`);
  console.log(`relatedFrom edges        = ${relatedFromEdges}`);
  console.log(`articles with ANY link   = ${withAny.length}`);
  if (withAny.length) {
    console.log('\nArticles that have links:');
    console.log(withAny.slice(0, 40).join('\n'));
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

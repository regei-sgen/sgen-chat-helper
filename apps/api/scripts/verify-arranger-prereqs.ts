import '../src/lib/env.js';
import { prisma } from '../src/lib/prisma.js';
import { previewVectorArrangement, applyVectorArrangement } from '../src/services/vector-arranger.js';

async function main() {
  console.log('=== PREVIEW (read-only) ===');
  const { proposals, articleCount } = await previewVectorArrangement();
  const withPre = proposals.filter((p) => p.prerequisiteIds.length);
  const withRel = proposals.filter((p) => p.relatedIds.length);
  const totalPre = proposals.reduce((n, p) => n + p.prerequisiteIds.length, 0);
  console.log(`articles=${articleCount}  withPrereq=${withPre.length}  withRelated=${withRel.length}  totalPrereqLinks=${totalPre}`);

  // Quality spot-check: do "How do I / Who can access X?" articles get "What is X?" as prereq?
  console.log('\n=== sample prerequisites (should be "What is <same component>?") ===');
  for (const p of proposals.filter((x) => x.prerequisiteIds.length && /^(how do i|who can access|is .* free)/i.test(x.title)).slice(0, 8)) {
    console.log(`  "${p.title.slice(0, 46)}"\n     prereq -> ${p.prerequisiteTitles.join(' | ')}`);
  }

  console.log('\n=== APPLY ===');
  const r = await applyVectorArrangement();
  console.log('updated:', r.updated);

  // Verify in DB: prerequisite + related edge counts, and that the prereq targets are 'what' intent.
  const arts = await prisma.article.findMany({ select: { id: true, intent: true, prerequisites: { select: { id: true } }, relatedTo: { select: { id: true } } } });
  const intentById = new Map(arts.map((a) => [a.id, a.intent]));
  let preEdges = 0, relEdges = 0, preToWhat = 0;
  for (const a of arts) {
    preEdges += a.prerequisites.length;
    relEdges += a.relatedTo.length;
    for (const pr of a.prerequisites) if (intentById.get(pr.id) === 'what') preToWhat++;
  }
  console.log(`\nDB after: prerequisite edges=${preEdges} (targets with intent='what': ${preToWhat})  relatedTo edges=${relEdges}`);

  // Confirm graph payload carries productPillar (sample one).
  const node = await prisma.article.findFirst({ select: { title: true, productPillar: true } });
  console.log('sample node pillar:', JSON.stringify(node));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

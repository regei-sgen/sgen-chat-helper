import '../src/lib/env.js';
import { prisma } from '../src/lib/prisma.js';
import { chat } from '../src/services/chat.js';

async function run(q: string) {
  console.log('\n==================================================');
  console.log('Q:', q);
  const r = await chat(q);
  console.log('--- matchedId:', r.matchedId, '| usedKB:', r.usedKnowledgeBase, '| confidence:', r.confidence?.toFixed(3));
  console.log('--- sources:', r.sources.map((s) => s.title).join(' | ') || '(none)');
  console.log('--- followups:', r.followups.map((f) => f.label).join(' | ') || '(none)');
  console.log('--- reply:\n' + r.reply.slice(0, 800));
}

async function main() {
  await run('Who can access Sites?');          // ambiguous -> expect MULTIPLE results
  await run('Who can access Orders?');          // exact title -> expect clean single conversational
  await run('What can you help me with?');      // meta-article -> single; check it reads ok
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

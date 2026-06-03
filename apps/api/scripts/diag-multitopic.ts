import '../src/lib/env.js';
import { prisma } from '../src/lib/prisma.js';
import { chat } from '../src/services/chat.js';

async function show(q: string) {
  const r = await chat(q);
  const topics = r.walkthrough ? r.walkthrough.title : r.sources.slice(0, 3).map((s) => s.title).join(' + ');
  console.log(`\nQ: ${JSON.stringify(q)}`);
  console.log(`  walkthrough: ${r.walkthrough ? `${r.walkthrough.steps.length} steps, topics="${r.walkthrough.title}"` : 'none'}`);
  console.log(`  sources: ${r.sources.map((s) => s.title).slice(0, 4).join(' | ')}`);
  console.log(`  reply (first 200): ${r.reply.slice(0, 200).replace(/\n+/g, ' / ')}`);
}

async function main() {
  await show('how to add page and blogs too');     // expect BOTH page + blog
  await show('set up events and locations');        // expect BOTH events + locations
  await show('how do I create a page and a blog');  // expect BOTH
  await show('difference between pages and blogs');  // expect SINGLE (comparison)
  await show('how do I add a new blog');             // expect SINGLE
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });

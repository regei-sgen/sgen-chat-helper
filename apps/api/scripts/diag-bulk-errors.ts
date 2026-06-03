// Diagnostic: surface real bulk-upload failures + article status counts.
//   npx tsx apps/api/scripts/diag-bulk-errors.ts
import '../src/lib/env.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  const jobs = await prisma.uploadJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  console.log(`\n===== Recent UploadJobs (${jobs.length}) =====`);
  for (const j of jobs) {
    console.log(
      `\njob ${j.id} | ${j.status} | total=${j.total} completed=${j.completed} failed=${j.failed} | ${j.createdAt.toISOString()}`,
    );
    const errs = (j.errors as { file: string; message: string }[] | null) ?? [];
    // Group identical error messages to see the dominant failure mode.
    const byMsg = new Map<string, { count: number; sample: string }>();
    for (const e of errs) {
      const key = e.message.replace(/[a-z0-9]{20,}/gi, '<id>').slice(0, 160);
      const cur = byMsg.get(key) ?? { count: 0, sample: e.file };
      cur.count++;
      byMsg.set(key, cur);
    }
    if (byMsg.size === 0) {
      console.log('  (no errors recorded)');
    } else {
      for (const [msg, info] of [...byMsg.entries()].sort((a, b) => b[1].count - a[1].count)) {
        console.log(`  [x${info.count}] ${msg}   e.g. ${info.sample}`);
      }
    }
  }

  const [draft, published, archived, total] = await Promise.all([
    prisma.article.count({ where: { status: 'DRAFT' } }),
    prisma.article.count({ where: { status: 'PUBLISHED' } }),
    prisma.article.count({ where: { status: 'ARCHIVED' } }),
    prisma.article.count(),
  ]);
  console.log(
    `\n===== Article counts ===== total=${total} | DRAFT=${draft} PUBLISHED=${published} ARCHIVED=${archived}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

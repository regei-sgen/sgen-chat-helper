import { Worker } from 'bullmq';
import { UPLOAD_QUEUE_NAME, queueConnection, type UploadJobPayload } from './lib/queue.js';
import { prisma } from './lib/prisma.js';
import { processSingleMarkdown, recordJobProgress } from './services/upload-processor.js';

console.log('[worker] starting upload processor...');

const worker = new Worker<UploadJobPayload, unknown, string>(
  UPLOAD_QUEUE_NAME,
  async (job) => {
    const { jobId, filename, content, authorId, autoPublish } = job.data;

    const dbJob = await prisma.uploadJob.findUnique({ where: { id: jobId } });
    if (dbJob && dbJob.status === 'PENDING') {
      await prisma.uploadJob.update({
        where: { id: jobId },
        data: { status: 'PROCESSING' },
      });
    }

    try {
      const result = await processSingleMarkdown({ content, authorId, autoPublish });
      await recordJobProgress(jobId, 'completed');
      return { ok: true, articleId: result.articleId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] failed processing ${filename}:`, message);
      await recordJobProgress(jobId, 'failed', { file: filename, message });
      throw err;
    }
  },
  {
    connection: queueConnection,
    concurrency: 2,
  },
);

worker.on('completed', (job) => {
  console.log(`[worker] completed ${job.id} (${job.data.filename})`);
});
worker.on('failed', (job, err) => {
  console.error(`[worker] failed ${job?.id}: ${err.message}`);
});

const shutdown = async (signal: string) => {
  console.log(`[worker] received ${signal}, closing...`);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

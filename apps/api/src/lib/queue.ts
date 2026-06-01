import { Queue, QueueEvents } from 'bullmq';
import { env } from './env.js';

export const UPLOAD_QUEUE_NAME = 'uploads';

export interface UploadJobPayload {
  jobId: string;
  filename: string;
  content: string;
  authorId: string;
  autoPublish: boolean;
}

const url = new URL(env.REDIS_URL);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  password: url.password || undefined,
  username: url.username || undefined,
  maxRetriesPerRequest: null,
};

export const uploadQueue = new Queue<UploadJobPayload, unknown, string>(UPLOAD_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    // One attempt per file so completed/failed counts stay accurate (the worker
    // records progress per attempt). Re-upload any failed files to retry.
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export const uploadQueueEvents = new QueueEvents(UPLOAD_QUEUE_NAME, {
  connection,
});

export const queueConnection = connection;

export async function closeQueue() {
  await uploadQueue.close();
  await uploadQueueEvents.close();
}

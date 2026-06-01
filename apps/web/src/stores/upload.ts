import { defineStore } from 'pinia';
import { ref } from 'vue';
import { articleApi } from '@/api/resources';
import type { UploadJobStatus } from '@kb/shared';

interface TrackedJob {
  jobId: string;
  status: UploadJobStatus | null;
  pollHandle?: number;
}

export const useUploadStore = defineStore('upload', () => {
  const jobs = ref<TrackedJob[]>([]);

  function getJob(id: string) {
    return jobs.value.find((j) => j.jobId === id) ?? null;
  }

  async function poll(jobId: string) {
    try {
      const status = await articleApi.jobStatus(jobId);
      const existing = getJob(jobId);
      if (existing) existing.status = status;
      if (status.status === 'COMPLETED' || status.status === 'FAILED') {
        stopPolling(jobId);
      }
    } catch {
      stopPolling(jobId);
    }
  }

  function startTracking(jobId: string) {
    if (getJob(jobId)) return;
    const tracked: TrackedJob = { jobId, status: null };
    jobs.value.push(tracked);
    poll(jobId);
    tracked.pollHandle = window.setInterval(() => poll(jobId), 2000);
  }

  function stopPolling(jobId: string) {
    const tracked = getJob(jobId);
    if (tracked?.pollHandle) {
      window.clearInterval(tracked.pollHandle);
      tracked.pollHandle = undefined;
    }
  }

  function clearJob(jobId: string) {
    stopPolling(jobId);
    jobs.value = jobs.value.filter((j) => j.jobId !== jobId);
  }

  return { jobs, startTracking, stopPolling, clearJob, getJob };
});

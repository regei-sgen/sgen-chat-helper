<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { articleApi, uploadMarkdownBulk } from '@/api/resources';
import { useUploadStore } from '@/stores/upload';
import { useToastStore } from '@/stores/toast';
import UploadDropzone from '@/components/UploadDropzone.vue';
import Button from '@/components/Button.vue';
import Modal from '@/components/Modal.vue';
import UploadProgressModal from '@/components/UploadProgressModal.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import { ApiError } from '@/api/client';
import type { AnalyzeResponse } from '@kb/shared';

// Mirrors UploadProgressModal's local UploadStage (structural — see that component).
type Stage = {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'failed';
  detail?: string;
};

const router = useRouter();
const upload = useUploadStore();
const toast = useToastStore();

const pendingFiles = ref<File[]>([]);
const pastedMarkdown = ref('');
const autoPublish = ref(false);
// Processing mode: AI-structure with local Claude Code (default) vs "Upload as is" (no AI).
const asIs = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const lastJobId = ref<string | null>(null);

const reviewOpen = ref(false);
const analysis = ref<AnalyzeResponse | null>(null);
const applying = ref(false);

const activeJob = computed(() =>
  lastJobId.value ? (upload.getJob(lastJobId.value) ?? null) : null,
);

// ---- Upload progress modal ----
// A popup that shows the live steps of the upload and auto-closes when it finishes.
const progressOpen = ref(false);
const progressTitle = ref('Uploading…');
const progressMode = ref<'single' | 'bulk'>('single');
const progressStatus = ref<'running' | 'done' | 'error'>('running');
// Article to open once the single-document modal closes (so the user sees "Done ✓" first).
const pendingNav = ref<string | null>(null);
const singleStages = ref<Stage[]>([]);

function setStage(key: string, state: Stage['state'], detail?: string) {
  const s = singleStages.value.find((x) => x.key === key);
  if (s) {
    s.state = state;
    if (detail !== undefined) s.detail = detail;
  }
}

function beginSingleProgress() {
  progressMode.value = 'single';
  progressTitle.value = 'Processing your document';
  progressStatus.value = 'running';
  pendingNav.value = null;
  singleStages.value = [
    { key: 'read', label: 'Reading document', state: 'done' },
    {
      key: 'structure',
      label: asIs.value ? 'Preparing article (no AI)' : 'Structuring with local Claude',
      state: 'pending',
      detail: asIs.value
        ? 'Storing your markdown as-is — no AI'
        : 'Runs on your machine — no API key needed',
    },
    { key: 'dedup', label: 'Checking for existing duplicates', state: 'pending' },
    { key: 'save', label: 'Saving article', state: 'pending' },
  ];
  progressOpen.value = true;
}

function failSingle(key: string, err: unknown) {
  setStage(key, 'failed', err instanceof ApiError ? err.message : 'Failed');
  progressStatus.value = 'error';
}

function beginBulkProgress() {
  progressMode.value = 'bulk';
  progressTitle.value = 'Processing batch';
  progressStatus.value = 'running';
  pendingNav.value = null;
  progressOpen.value = true;
}

// Bulk modal content is derived live from the polled job status in the store.
const bulkJobStatus = computed(() => activeJob.value?.status ?? null);

const bulkStages = computed<Stage[]>(() => {
  const st = bulkJobStatus.value;
  const total = st?.total ?? 0;
  const finished = st ? st.status === 'COMPLETED' || st.status === 'FAILED' : false;
  return [
    { key: 'queued', label: `Queued ${total} file${total === 1 ? '' : 's'}`, state: 'done' },
    {
      key: 'process',
      label: asIs.value ? 'Saving as-is (no AI)' : 'Structuring with local Claude',
      state: finished ? 'done' : 'active',
      detail: st
        ? `${st.completed} done · ${st.failed} failed · ${st.total} total`
        : 'Waiting for the worker…',
    },
    {
      key: 'finish',
      label: st && st.failed > 0 ? `Completed — ${st.failed} failed` : 'Completed',
      state: finished ? (st && st.failed > 0 ? 'failed' : 'done') : 'pending',
    },
  ];
});

const bulkProgress = computed(() => {
  const st = bulkJobStatus.value;
  return st ? { completed: st.completed, failed: st.failed, total: st.total } : null;
});

const bulkErrors = computed(() => bulkJobStatus.value?.errors ?? []);

// Flip the bulk modal to its terminal state when the polled job finishes. The terminal
// write happens once. A COMPLETED job that had per-file failures is treated as an error
// state (stay open so the user can read the failures) — not an auto-closing success.
watch(
  () => bulkJobStatus.value?.status,
  (s) => {
    if (progressMode.value !== 'bulk' || !progressOpen.value) return;
    if (progressStatus.value !== 'running') return;
    if (s === 'COMPLETED') {
      progressStatus.value = (bulkJobStatus.value?.failed ?? 0) > 0 ? 'error' : 'done';
    } else if (s === 'FAILED') {
      progressStatus.value = 'error';
    }
  },
);

// Auto-close (or manual close) of the progress modal. For a finished single upload,
// navigate to its review page once the modal is dismissed.
function onProgressClose() {
  progressOpen.value = false;
  if (pendingNav.value) {
    const id = pendingNav.value;
    pendingNav.value = null;
    router.push(`/articles/${id}/review`);
  }
}

// Stop the background batch poll if the user leaves this view mid-job.
onBeforeUnmount(() => {
  if (lastJobId.value) upload.stopPolling(lastJobId.value);
});

function onFiles(files: File[]) {
  pendingFiles.value = [...pendingFiles.value, ...files];
}
function removeFile(idx: number) {
  pendingFiles.value = pendingFiles.value.filter((_, i) => i !== idx);
}

async function analyzeFile(file: File) {
  beginSingleProgress();
  setStage('structure', 'active');

  let res: AnalyzeResponse;
  try {
    res = await articleApi.analyze(file, asIs.value);
  } catch (err) {
    failSingle('structure', err);
    throw err;
  }
  setStage('structure', 'done');
  setStage('dedup', 'done');

  if (res.candidates.length > 0) {
    // Hand off to the duplicate-review modal — no auto-close here.
    progressOpen.value = false;
    analysis.value = res;
    reviewOpen.value = true;
    return;
  }

  setStage('save', 'active');
  let article: { id: string };
  try {
    article = await articleApi.apply({
      structured: res.structured,
      action: 'create',
      autoPublish: autoPublish.value,
      // For a reference KB card this carries the full parsed frontmatter so nothing is flattened.
      card: res.card,
    });
  } catch (err) {
    failSingle('save', err);
    throw err;
  }
  setStage('save', 'done');
  toast.success('Article created');
  // Show "Done ✓", then auto-close → navigate (or navigate now if already dismissed).
  progressStatus.value = 'done';
  if (progressOpen.value) pendingNav.value = article.id;
  else router.push(`/articles/${article.id}/review`);
}

async function submit() {
  error.value = null;
  // Drop any previous batch job (stops its poll + clears the stale inline card) before a new upload.
  if (lastJobId.value) {
    upload.clearJob(lastJobId.value);
    lastJobId.value = null;
  }
  submitting.value = true;
  try {
    if (pastedMarkdown.value.trim()) {
      const file = new File(
        [new Blob([pastedMarkdown.value], { type: 'text/markdown' })],
        'pasted.md',
        { type: 'text/markdown' },
      );
      await analyzeFile(file);
      return;
    }
    if (pendingFiles.value.length === 1) {
      await analyzeFile(pendingFiles.value[0]);
      return;
    }
    if (pendingFiles.value.length > 1) {
      const files = pendingFiles.value;
      const total = files.length;
      // Upload in small chunks that all feed ONE job. Show the progress modal as soon as the job
      // exists (after the first chunk), then keep streaming the rest in the background.
      const res = await uploadMarkdownBulk(files, autoPublish.value, asIs.value, {
        onJobCreated: (jobId) => {
          lastJobId.value = jobId;
          upload.startTracking(jobId);
          beginBulkProgress();
        },
      });
      if (res.failedToUpload > 0) {
        toast.error(
          `${res.failedToUpload} of ${total} files couldn't be uploaded and were skipped.`,
        );
      }
      toast.success(`Queued ${res.enqueued} file${res.enqueued === 1 ? '' : 's'}`);
      pendingFiles.value = [];
      return;
    }
    error.value = 'Add a file or paste markdown first';
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : 'Upload failed';
    // The progress modal already shows single-flow failures (failed stage + message);
    // only surface the inline error + toast when the modal isn't already showing it.
    if (!(progressOpen.value && progressStatus.value === 'error')) {
      error.value = msg;
      toast.error(msg);
    }
  } finally {
    submitting.value = false;
  }
}

async function applyCreate() {
  if (!analysis.value) return;
  applying.value = true;
  try {
    const article = await articleApi.apply({
      structured: analysis.value.structured,
      action: 'create',
      autoPublish: autoPublish.value,
    });
    reviewOpen.value = false;
    toast.success('New article created');
    router.push(`/articles/${article.id}/review`);
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  } finally {
    applying.value = false;
  }
}

async function applyOverride(targetId: string) {
  if (!analysis.value) return;
  applying.value = true;
  try {
    const article = await articleApi.apply({
      structured: analysis.value.structured,
      action: 'override',
      targetId,
      autoPublish: autoPublish.value,
    });
    reviewOpen.value = false;
    toast.success('Existing article updated');
    router.push(`/articles/${article.id}/review`);
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  } finally {
    applying.value = false;
  }
}

function changedOnly(diff: AnalyzeResponse['candidates'][number]['diff']) {
  return diff.filter((d) => d.changed);
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-1">Upload markdown</h1>
    <p class="text-text/60 mb-4">
      Drop one or more .md files, drag in whole folders (or use “Select a folder”), or paste raw
      markdown. Choose whether to
      <strong>structure each with your local Claude Code</strong> CLI (no API key needed) or
      <strong>upload as-is</strong> (store the markdown verbatim, no AI). Before saving, we check
      existing knowledge — if something similar exists, you'll review the changes first. Bulk
      uploads flag possible duplicates for review instead of overwriting.
    </p>

    <div class="space-y-4">
      <div class="card">
        <UploadDropzone multiple @files="onFiles" />
        <ul v-if="pendingFiles.length" class="mt-3 space-y-1 text-sm">
          <li
            v-for="(f, idx) in pendingFiles"
            :key="idx"
            class="flex items-center justify-between bg-light/50 px-3 py-1.5 rounded-btn"
          >
            <span>{{ f.name }} <span class="text-text/50">({{ (f.size / 1024).toFixed(1) }} KB)</span></span>
            <button class="text-danger text-xs" @click="removeFile(idx)">Remove</button>
          </li>
        </ul>
      </div>

      <div class="card">
        <p class="text-sm text-text/60 mb-2">…or paste markdown</p>
        <MarkdownEditor v-model="pastedMarkdown" :rows="10" placeholder="# Heading…" />
      </div>

      <div class="card space-y-2">
        <div class="text-sm font-medium">Processing</div>
        <label class="flex items-start gap-2 text-sm">
          <input type="radio" :value="false" v-model="asIs" class="mt-0.5" />
          <span>
            <span class="font-medium">Structure with Claude Code</span> (AI) — extracts title,
            summary, steps, product area &amp; tags. Runs on your machine, no API key.
          </span>
        </label>
        <label class="flex items-start gap-2 text-sm">
          <input type="radio" :value="true" v-model="asIs" class="mt-0.5" />
          <span>
            <span class="font-medium">Upload as-is</span> (no AI) — store the markdown verbatim.
            Title comes from the first heading; fill in the rest later.
          </span>
        </label>
      </div>

      <div class="card flex items-center justify-between">
        <label class="flex items-center gap-2 text-sm">
          <input v-model="autoPublish" type="checkbox" />
          Auto-publish (skip review)
        </label>
        <Button :loading="submitting" @click="submit">
          {{ pendingFiles.length > 1 ? 'Process batch' : 'Analyze & process' }}
        </Button>
      </div>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>

      <div v-if="activeJob" class="card">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold">Batch job: {{ activeJob.jobId }}</h3>
          <span class="text-sm">{{ activeJob.status?.status ?? 'pending' }}</span>
        </div>
        <div v-if="activeJob.status" class="w-full bg-light rounded-full h-2 overflow-hidden">
          <div
            class="h-full bg-primary transition-all"
            :style="{
              width:
                ((activeJob.status.completed + activeJob.status.failed) /
                  Math.max(1, activeJob.status.total)) *
                  100 +
                '%',
            }"
          />
        </div>
        <div v-if="activeJob.status" class="text-sm text-text/60 mt-2">
          {{ activeJob.status.completed }} done · {{ activeJob.status.failed }} failed ·
          {{ activeJob.status.total }} total
        </div>
        <div v-if="activeJob.status?.status === 'COMPLETED'" class="text-sm mt-2">
          Done. Any possible duplicates were saved as drafts and flagged —
          <router-link to="/articles?duplicates=1" class="text-primary hover:underline">
            review flagged duplicates
          </router-link>.
        </div>
        <ul v-if="activeJob.status?.errors?.length" class="mt-2 text-xs text-danger space-y-1">
          <li v-for="(e, idx) in activeJob.status.errors" :key="idx">
            <strong>{{ e.file }}:</strong> {{ e.message }}
          </li>
        </ul>
      </div>
    </div>

    <!-- Live upload-progress popup — auto-closes when the process finishes -->
    <UploadProgressModal
      :open="progressOpen"
      :title="progressTitle"
      :status="progressStatus"
      :stages="progressMode === 'bulk' ? bulkStages : singleStages"
      :progress="progressMode === 'bulk' ? bulkProgress : null"
      :errors="progressMode === 'bulk' ? bulkErrors : []"
      :done-note="
        progressMode === 'bulk'
          ? 'Any possible duplicates were saved as drafts and flagged for review.'
          : ''
      "
      @close="onProgressClose"
    />

    <!-- Duplicate review popup (single upload) -->
    <Modal :open="reviewOpen" title="Possible duplicate found" size="lg" @close="reviewOpen = false">
      <div v-if="analysis" class="space-y-4 text-sm">
        <p>
          Your document was structured as
          <strong>“{{ analysis.structured.title }}”</strong>. It looks similar to
          {{ analysis.candidates.length }} existing
          {{ analysis.candidates.length === 1 ? 'article' : 'articles' }}. Review what would change
          before overriding, or create a new article instead.
        </p>

        <div
          v-for="c in analysis.candidates"
          :key="c.id"
          class="border border-light rounded-btn p-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="font-medium">{{ c.title }}</div>
              <div class="text-xs text-text/60">{{ c.matchReason }} · {{ c.status }}</div>
            </div>
            <Button size="sm" :loading="applying" @click="applyOverride(c.id)">
              Override this
            </Button>
          </div>
          <ul class="space-y-1 border-t border-light pt-2">
            <li v-for="d in changedOnly(c.diff)" :key="d.field" class="text-xs">
              <span class="font-medium">{{ d.label }}:</span>
              <template v-if="d.note"> {{ d.note }}</template>
              <template v-else>
                <span class="text-text/50 line-through">{{ d.old || '—' }}</span>
                <span class="mx-1">→</span>
                <span class="text-text font-medium">{{ d.new || '—' }}</span>
              </template>
            </li>
            <li v-if="changedOnly(c.diff).length === 0" class="text-xs text-text/50">
              No field changes — looks identical.
            </li>
          </ul>
        </div>
      </div>

      <template #footer>
        <Button variant="ghost" size="sm" @click="reviewOpen = false">Cancel</Button>
        <Button variant="secondary" size="sm" :loading="applying" @click="applyCreate">
          Create as new instead
        </Button>
      </template>
    </Modal>
  </div>
</template>

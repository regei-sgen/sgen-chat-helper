<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { articleApi } from '@/api/resources';
import { useUploadStore } from '@/stores/upload';
import { useToastStore } from '@/stores/toast';
import UploadDropzone from '@/components/UploadDropzone.vue';
import Button from '@/components/Button.vue';
import Modal from '@/components/Modal.vue';
import MarkdownEditor from '@/components/MarkdownEditor.vue';
import { ApiError } from '@/api/client';
import type { AnalyzeResponse } from '@kb/shared';

const router = useRouter();
const upload = useUploadStore();
const toast = useToastStore();

const pendingFiles = ref<File[]>([]);
const pastedMarkdown = ref('');
const autoPublish = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);
const lastJobId = ref<string | null>(null);

const reviewOpen = ref(false);
const analysis = ref<AnalyzeResponse | null>(null);
const applying = ref(false);

const activeJob = computed(() =>
  lastJobId.value ? (upload.getJob(lastJobId.value) ?? null) : null,
);

function onFiles(files: File[]) {
  pendingFiles.value = [...pendingFiles.value, ...files];
}
function removeFile(idx: number) {
  pendingFiles.value = pendingFiles.value.filter((_, i) => i !== idx);
}

async function analyzeFile(file: File) {
  const res = await articleApi.analyze(file);
  if (res.candidates.length > 0) {
    analysis.value = res;
    reviewOpen.value = true;
  } else {
    const article = await articleApi.apply({
      structured: res.structured,
      action: 'create',
      autoPublish: autoPublish.value,
    });
    toast.success('Article created');
    router.push(`/articles/${article.id}/review`);
  }
}

async function submit() {
  error.value = null;
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
      const res = await articleApi.uploadBulk(pendingFiles.value, autoPublish.value);
      lastJobId.value = res.jobId;
      upload.startTracking(res.jobId);
      toast.success(`Queued ${res.total} files`);
      pendingFiles.value = [];
      return;
    }
    error.value = 'Add a file or paste markdown first';
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Upload failed';
    toast.error(error.value);
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
      Drop one or more .md files, or paste raw markdown. The AI provider you set in
      <router-link to="/settings" class="text-primary hover:underline">Settings</router-link>
      structures each into an article. Before saving, we check existing knowledge — if something
      similar exists, you'll review the changes first. Bulk uploads flag possible duplicates for
      review instead of overwriting.
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

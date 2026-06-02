<script setup lang="ts">
import { ref, watch, onBeforeUnmount, type Component } from 'vue';
import { LoaderCircle, CircleCheck, Circle, CircleAlert } from 'lucide-vue-next';
import Modal from './Modal.vue';

// One step in the upload pipeline, shown as a live checklist row. (Callers pass a
// structurally-identical object — kept local since <script setup> can't re-export types.)
interface UploadStage {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done' | 'failed';
  detail?: string;
}

interface Props {
  open: boolean;
  title?: string;
  stages: UploadStage[];
  status: 'running' | 'done' | 'error';
  // Optional determinate bar (bulk jobs); omit for the single-document flow.
  progress?: { completed: number; failed: number; total: number } | null;
  errors?: { file: string; message: string }[];
  // How long to keep the "Done ✓" state on screen before auto-closing.
  autoCloseMs?: number;
  doneNote?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Uploading…',
  progress: null,
  errors: () => [],
  autoCloseMs: 1600,
  doneNote: '',
});

const emit = defineEmits<{ close: [] }>();

// Elapsed seconds while running (a small "what's happening" detail).
const elapsed = ref(0);
let ticker: number | undefined;
let closeTimer: number | undefined;

function clearTicker() {
  if (ticker !== undefined) {
    window.clearInterval(ticker);
    ticker = undefined;
  }
}
function clearCloseTimer() {
  if (closeTimer !== undefined) {
    window.clearTimeout(closeTimer);
    closeTimer = undefined;
  }
}

// Arm a one-shot auto-close iff we're open AND finished successfully. Called from both
// watchers so "opened while already done" also schedules a close; the timeout body
// re-checks the condition so a late done→error flip can't auto-close over the error.
function scheduleAutoClose() {
  clearCloseTimer();
  if (props.open && props.status === 'done') {
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      if (props.open && props.status === 'done') emit('close');
    }, props.autoCloseMs);
  }
}

// Run the elapsed-time ticker only while the modal is open.
watch(
  () => props.open,
  (open) => {
    clearTicker();
    if (open) {
      elapsed.value = 0;
      ticker = window.setInterval(() => {
        if (props.status === 'running') elapsed.value += 1;
      }, 1000);
    }
    scheduleAutoClose();
  },
  { immediate: true },
);

// Stop the ticker once finished; (re)arm auto-close on the transition to 'done'. On
// 'error' we stay open so the user can read what failed and close it themselves.
watch(
  () => props.status,
  (status) => {
    if (status !== 'running') clearTicker();
    scheduleAutoClose();
  },
);

onBeforeUnmount(() => {
  clearTicker();
  clearCloseTimer();
});

const ICONS: Record<UploadStage['state'], Component> = {
  pending: Circle,
  active: LoaderCircle,
  done: CircleCheck,
  failed: CircleAlert,
};
const ICON_CLASS: Record<UploadStage['state'], string> = {
  pending: 'text-text/30',
  active: 'text-primary animate-spin',
  done: 'text-success',
  failed: 'text-danger',
};

function pct(p: NonNullable<Props['progress']>): number {
  return Math.round(((p.completed + p.failed) / Math.max(1, p.total)) * 100);
}
</script>

<template>
  <Modal :open="open" :title="title" size="md" @close="emit('close')">
    <div class="space-y-4">
      <!-- Status / elapsed line -->
      <div class="flex items-center justify-between text-sm">
        <span
          :class="
            status === 'error'
              ? 'text-danger font-medium'
              : status === 'done'
                ? 'text-success font-medium'
                : 'text-text/60'
          "
        >
          <template v-if="status === 'running'">Working… {{ elapsed }}s</template>
          <template v-else-if="status === 'done'">
            {{ elapsed > 0 ? `Done in ${elapsed}s` : 'Done' }} · closing…
          </template>
          <template v-else-if="progress && progress.completed > 0 && progress.failed > 0">
            Completed with {{ progress.failed }} error{{ progress.failed === 1 ? '' : 's' }}
          </template>
          <template v-else>Something went wrong</template>
        </span>
        <span v-if="progress" class="text-text/60">
          {{ progress.completed }}/{{ progress.total }} done<template v-if="progress.failed">
            · {{ progress.failed }} failed</template
          >
        </span>
      </div>

      <!-- Determinate bar (bulk jobs only) -->
      <div v-if="progress" class="w-full bg-light rounded-full h-2 overflow-hidden">
        <div
          class="h-full transition-all"
          :class="status === 'error' ? 'bg-danger' : 'bg-primary'"
          :style="{ width: pct(progress) + '%' }"
        />
      </div>

      <!-- Live stage checklist -->
      <ul class="space-y-2.5">
        <li v-for="s in stages" :key="s.key" class="flex items-start gap-2.5 text-sm">
          <component
            :is="ICONS[s.state]"
            :size="18"
            :stroke-width="2"
            class="mt-0.5 shrink-0"
            :class="ICON_CLASS[s.state]"
          />
          <div class="min-w-0">
            <div :class="s.state === 'pending' ? 'text-text/40' : 'text-text'">{{ s.label }}</div>
            <div v-if="s.detail" class="text-xs text-text/50 break-words">{{ s.detail }}</div>
          </div>
        </li>
      </ul>

      <!-- Per-file errors (bulk) -->
      <ul
        v-if="errors.length"
        class="text-xs text-danger space-y-1 border-t border-light pt-3 max-h-40 overflow-y-auto"
      >
        <li v-for="(e, i) in errors" :key="i"><strong>{{ e.file }}:</strong> {{ e.message }}</li>
      </ul>

      <p v-if="status === 'done' && doneNote" class="text-xs text-text/60">{{ doneNote }}</p>
    </div>
  </Modal>
</template>

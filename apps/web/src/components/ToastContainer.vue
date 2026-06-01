<script setup lang="ts">
import { computed } from 'vue';
import { useToastStore, type ToastKind } from '@/stores/toast';
import { X } from 'lucide-vue-next';

const store = useToastStore();
const toasts = computed(() => store.toasts);

function kindClass(kind: ToastKind): string {
  switch (kind) {
    case 'success':
      return 'bg-success text-white';
    case 'error':
      return 'bg-danger text-white';
    case 'warning':
      return 'bg-warning text-secondary';
    default:
      return 'bg-secondary text-white';
  }
}
</script>

<template>
  <div class="fixed top-4 right-4 z-50 flex flex-col gap-2">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="px-4 py-3 rounded-btn shadow-md min-w-[260px] max-w-[400px] flex items-start gap-3"
      :class="kindClass(t.kind)"
    >
      <span class="flex-1 text-sm">{{ t.message }}</span>
      <button class="inline-flex items-center opacity-80 hover:opacity-100" @click="store.dismiss(t.id)">
        <X :size="14" />
      </button>
    </div>
  </div>
</template>

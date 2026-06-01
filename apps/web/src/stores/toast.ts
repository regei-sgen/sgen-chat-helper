import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let counter = 0;

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([]);

  function push(message: string, kind: ToastKind = 'info', ttlMs = 4000) {
    const id = ++counter;
    toasts.value.push({ id, kind, message });
    window.setTimeout(() => dismiss(id), ttlMs);
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    push,
    dismiss,
    success: (m: string) => push(m, 'success'),
    error: (m: string) => push(m, 'error', 6000),
    info: (m: string) => push(m, 'info'),
    warning: (m: string) => push(m, 'warning'),
  };
});

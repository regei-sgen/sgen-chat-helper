<script setup lang="ts">
import { X } from 'lucide-vue-next';

interface Props {
  open: boolean;
  title?: string;
  size?: 'sm' | 'md' | 'lg';
}

const props = withDefaults(defineProps<Props>(), { size: 'md' });

const emit = defineEmits<{
  close: [];
}>();

const sizeClass = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}[props.size];
</script>

<template>
  <Teleport to="body">
    <transition name="modal">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50" @click="emit('close')" />
        <div class="relative w-full bg-surface rounded-btn shadow-xl" :class="sizeClass">
          <div class="px-5 py-4 border-b border-light flex items-center justify-between">
            <h3 class="text-lg font-semibold">{{ title }}</h3>
            <button class="text-text/60 hover:text-text" @click="emit('close')">
              <X :size="18" />
            </button>
          </div>
          <div class="px-5 py-4"><slot /></div>
          <div v-if="$slots.footer" class="px-5 py-3 bg-light rounded-b-btn flex justify-end gap-2">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 150ms ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>

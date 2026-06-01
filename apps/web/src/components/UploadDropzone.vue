<script setup lang="ts">
import { ref } from 'vue';
import { UploadCloud } from 'lucide-vue-next';

const props = defineProps<{
  multiple?: boolean;
  accept?: string;
}>();

const emit = defineEmits<{
  files: [files: File[]];
}>();

const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  if (!e.dataTransfer) return;
  const files = Array.from(e.dataTransfer.files);
  emit('files', props.multiple ? files : files.slice(0, 1));
}

function onSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  if (!target.files) return;
  emit('files', Array.from(target.files));
  target.value = '';
}

function pick() {
  fileInput.value?.click();
}
</script>

<template>
  <div
    class="border-2 border-dashed rounded-btn p-8 text-center transition-colors cursor-pointer"
    :class="dragOver ? 'border-primary bg-primary/5' : 'border-light bg-white'"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop="onDrop"
    @click="pick"
  >
    <UploadCloud :size="32" :stroke-width="1.5" class="mx-auto text-text/50" />
    <div class="mt-2 font-medium">Drop markdown files here</div>
    <div class="text-xs text-text/60 mt-1">
      or click to browse {{ multiple ? '(multiple supported)' : '' }}
    </div>
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :multiple="multiple"
      :accept="accept ?? '.md,.markdown,text/markdown'"
      @change="onSelect"
    />
  </div>
</template>

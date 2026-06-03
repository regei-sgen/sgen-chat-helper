<script setup lang="ts">
import { computed, ref } from 'vue';
import { renderMarkdown } from '@/lib/markdown';

interface Props {
  modelValue: string;
  placeholder?: string;
  rows?: number;
  label?: string;
}

const props = withDefaults(defineProps<Props>(), { rows: 10 });

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

const mode = ref<'edit' | 'preview' | 'split'>('split');
const rendered = computed(() => renderMarkdown(props.modelValue));

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value);
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-1">
      <span v-if="label" class="text-sm font-medium">{{ label }}</span>
      <div class="ml-auto inline-flex rounded-btn border border-light overflow-hidden text-xs">
        <button
          v-for="m in ['edit', 'preview', 'split'] as const"
          :key="m"
          class="px-3 py-1 capitalize"
          :class="mode === m ? 'bg-secondary text-white' : 'bg-surface text-text hover:bg-light'"
          @click="mode = m"
        >
          {{ m }}
        </button>
      </div>
    </div>
    <div class="grid gap-3" :class="mode === 'split' ? 'md:grid-cols-2' : 'grid-cols-1'">
      <textarea
        v-if="mode !== 'preview'"
        class="input-base font-mono text-sm"
        :rows="rows"
        :value="modelValue"
        :placeholder="placeholder"
        @input="onInput"
      />
      <div
        v-if="mode !== 'edit'"
        class="card prose-body overflow-auto"
        :class="mode === 'split' ? 'min-h-[200px]' : ''"
        v-html="rendered"
      />
    </div>
  </div>
</template>

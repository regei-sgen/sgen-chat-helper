<script setup lang="ts">
import { ref } from 'vue';
import type { StepInput } from '@kb/shared';
import Input from './Input.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import Button from './Button.vue';

const props = defineProps<{
  modelValue: StepInput[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: StepInput[]];
}>();

const draggedIndex = ref<number | null>(null);

function update(steps: StepInput[]) {
  emit(
    'update:modelValue',
    steps.map((s, idx) => ({ ...s, order: idx })),
  );
}

function addStep() {
  update([...props.modelValue, { order: props.modelValue.length, title: '', content: '' }]);
}

function removeStep(idx: number) {
  update(props.modelValue.filter((_, i) => i !== idx));
}

function updateStep(idx: number, patch: Partial<StepInput>) {
  update(props.modelValue.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
}

function onDragStart(idx: number) {
  draggedIndex.value = idx;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function onDrop(targetIdx: number) {
  if (draggedIndex.value === null || draggedIndex.value === targetIdx) return;
  const next = [...props.modelValue];
  const [moved] = next.splice(draggedIndex.value, 1);
  next.splice(targetIdx, 0, moved);
  draggedIndex.value = null;
  update(next);
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <span class="text-sm font-medium">Steps</span>
      <Button variant="ghost" size="sm" @click="addStep">+ Add step</Button>
    </div>

    <div v-if="modelValue.length === 0" class="card text-center text-sm text-text/60">
      No steps yet — articles can be free-form, or you can break them into ordered steps.
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="(step, idx) in modelValue"
        :key="idx"
        class="card"
        draggable="true"
        @dragstart="onDragStart(idx)"
        @dragover="onDragOver"
        @drop="onDrop(idx)"
      >
        <div class="flex items-center gap-2 mb-2">
          <span class="cursor-grab text-text/40 select-none">⋮⋮</span>
          <span class="text-xs text-text/60 font-mono">Step {{ idx + 1 }}</span>
          <button
            class="ml-auto text-xs text-danger hover:underline"
            @click="removeStep(idx)"
          >
            Remove
          </button>
        </div>
        <Input
          :model-value="step.title"
          label="Title"
          @update:model-value="(v) => updateStep(idx, { title: v })"
        />
        <div class="mt-2">
          <MarkdownEditor
            :model-value="step.content"
            label="Content"
            :rows="6"
            @update:model-value="(v) => updateStep(idx, { content: v })"
          />
        </div>
      </div>
    </div>
  </div>
</template>

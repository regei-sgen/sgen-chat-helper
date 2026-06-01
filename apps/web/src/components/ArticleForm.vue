<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Article, ArticleCreateInput } from '@kb/shared';
import {
  ARTICLE_STATUS_LABELS,
  DIFFICULTY_LABELS,
  PRODUCT_AREA_LABELS,
} from '@kb/shared';
import Input from './Input.vue';
import Select from './Select.vue';
import MarkdownEditor from './MarkdownEditor.vue';
import StepEditor from './StepEditor.vue';
import RelationPicker from './RelationPicker.vue';
import Button from './Button.vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  initial?: Article | null;
  submitting?: boolean;
  submitLabel?: string;
}>();

const emit = defineEmits<{
  submit: [value: ArticleCreateInput];
}>();

const form = ref<ArticleCreateInput>({
  title: '',
  summary: '',
  content: '',
  feature: '',
  productArea: null,
  difficulty: null,
  sgenUrl: '',
  status: 'DRAFT',
  steps: [],
  tags: [],
  prerequisiteIds: [],
  relatedIds: [],
});

const tagInput = ref('');

watch(
  () => props.initial,
  (article) => {
    if (!article) return;
    form.value = {
      title: article.title,
      summary: article.summary ?? '',
      content: article.content,
      feature: article.feature ?? '',
      productArea: article.productArea,
      difficulty: article.difficulty,
      sgenUrl: article.sgenUrl ?? '',
      status: article.status,
      steps: article.steps.map((s) => ({
        order: s.order,
        title: s.title,
        content: s.content,
        imageUrl: s.imageUrl ?? null,
      })),
      tags: article.tags.map((t) => t.name),
      prerequisiteIds: article.prerequisites.map((p) => p.id),
      relatedIds: article.relatedTo.map((p) => p.id),
    };
  },
  { immediate: true },
);

const productAreaOptions = [
  ...Object.entries(PRODUCT_AREA_LABELS).map(([value, label]) => ({ value, label })),
];
const difficultyOptions = [
  ...Object.entries(DIFFICULTY_LABELS).map(([value, label]) => ({ value, label })),
];
const statusOptions = Object.entries(ARTICLE_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const excludeId = computed(() => props.initial?.id);

function addTag() {
  const t = tagInput.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!t || form.value.tags.includes(t)) {
    tagInput.value = '';
    return;
  }
  form.value.tags = [...form.value.tags, t];
  tagInput.value = '';
}

function removeTag(name: string) {
  form.value.tags = form.value.tags.filter((t) => t !== name);
}

function onSubmit() {
  emit('submit', { ...form.value });
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="onSubmit">
    <div class="card space-y-4">
      <Input v-model="form.title" label="Title" required placeholder="How to ..." />
      <Input
        :model-value="form.summary ?? ''"
        label="Summary"
        placeholder="One sentence describing what this teaches"
        @update:model-value="(v) => (form.summary = v)"
      />
      <div class="grid sm:grid-cols-3 gap-3">
        <Input
          :model-value="form.feature ?? ''"
          label="Feature"
          placeholder="Pages & Posts"
          @update:model-value="(v) => (form.feature = v)"
        />
        <Select
          :model-value="form.productArea"
          label="Product area"
          placeholder="Choose…"
          :options="productAreaOptions"
          @update:model-value="(v) => (form.productArea = (v ?? null) as ArticleCreateInput['productArea'])"
        />
        <Select
          :model-value="form.difficulty"
          label="Difficulty"
          placeholder="Choose…"
          :options="difficultyOptions"
          @update:model-value="(v) => (form.difficulty = (v ?? null) as ArticleCreateInput['difficulty'])"
        />
      </div>
      <div class="grid sm:grid-cols-2 gap-3">
        <Input
          :model-value="form.sgenUrl ?? ''"
          label="SGEN URL"
          placeholder="docs.sgen.com/..."
          hint="Optional link to the docs page — https:// is added for you."
          @update:model-value="(v) => (form.sgenUrl = v)"
        />
        <Select
          :model-value="form.status"
          label="Status"
          :options="statusOptions"
          @update:model-value="(v) => (form.status = (v ?? 'DRAFT') as ArticleCreateInput['status'])"
        />
      </div>
    </div>

    <div class="card">
      <MarkdownEditor
        v-model="form.content"
        label="Main content"
        :rows="14"
        placeholder="Article body, written in markdown."
      />
    </div>

    <div class="card">
      <StepEditor v-model="form.steps" />
    </div>

    <div class="card">
      <label class="block text-sm font-medium mb-1">Tags</label>
      <div class="flex flex-wrap gap-1.5 mb-2">
        <span
          v-for="t in form.tags"
          :key="t"
          class="badge bg-light text-secondary text-xs"
        >
          #{{ t }}
          <button class="ml-1 inline-flex items-center hover:opacity-70" @click="removeTag(t)">
            <X :size="12" />
          </button>
        </span>
        <span v-if="form.tags.length === 0" class="text-xs text-text/50">None</span>
      </div>
      <div class="flex gap-2">
        <input
          v-model="tagInput"
          class="input-base"
          placeholder="Add a tag and press Enter"
          @keydown.enter.prevent="addTag"
        />
        <Button variant="ghost" size="sm" type="button" @click="addTag">Add</Button>
      </div>
    </div>

    <div class="card grid sm:grid-cols-2 gap-4">
      <RelationPicker
        v-model="form.prerequisiteIds"
        label="Prerequisites"
        :exclude-id="excludeId"
      />
      <RelationPicker v-model="form.relatedIds" label="Related articles" :exclude-id="excludeId" />
    </div>

    <div class="flex justify-end">
      <Button :loading="submitting" type="submit">{{ submitLabel ?? 'Save article' }}</Button>
    </div>
  </form>
</template>

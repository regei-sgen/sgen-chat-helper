<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { articleApi } from '@/api/resources';
import type { Article } from '@kb/shared';
import Badge from './Badge.vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  modelValue: string[];
  excludeId?: string;
  label?: string;
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const query = ref('');
const results = ref<Article[]>([]);
const selectedDetails = ref<Article[]>([]);
const loading = ref(false);

watch(
  () => props.modelValue,
  async (ids) => {
    if (ids.length === 0) {
      selectedDetails.value = [];
      return;
    }
    const missing = ids.filter((id) => !selectedDetails.value.find((a) => a.id === id));
    if (missing.length) {
      const fetched = await Promise.all(missing.map((id) => articleApi.get(id).catch(() => null)));
      selectedDetails.value = [
        ...selectedDetails.value.filter((a) => ids.includes(a.id)),
        ...fetched.filter((a): a is Article => a !== null),
      ];
    } else {
      selectedDetails.value = selectedDetails.value.filter((a) => ids.includes(a.id));
    }
  },
  { immediate: true },
);

let searchTimer: number | null = null;
watch(query, (val) => {
  if (searchTimer) window.clearTimeout(searchTimer);
  if (!val.trim()) {
    results.value = [];
    return;
  }
  searchTimer = window.setTimeout(async () => {
    loading.value = true;
    try {
      const res = await articleApi.list({ search: val, pageSize: 8 });
      results.value = res.items.filter((a) => a.id !== props.excludeId);
    } finally {
      loading.value = false;
    }
  }, 250);
});

const available = computed(() =>
  results.value.filter((a) => !props.modelValue.includes(a.id)),
);

function add(article: Article) {
  emit('update:modelValue', [...props.modelValue, article.id]);
  query.value = '';
  results.value = [];
}

function remove(id: string) {
  emit(
    'update:modelValue',
    props.modelValue.filter((x) => x !== id),
  );
}
</script>

<template>
  <div>
    <span v-if="label" class="block text-sm font-medium text-text mb-1">{{ label }}</span>
    <div class="flex flex-wrap gap-1.5 mb-2">
      <Badge v-for="art in selectedDetails" :key="art.id" kind="primary">
        {{ art.title }}
        <button class="ml-1 inline-flex items-center hover:opacity-70" @click="remove(art.id)">
          <X :size="12" />
        </button>
      </Badge>
      <span v-if="selectedDetails.length === 0" class="text-xs text-text/50">None selected</span>
    </div>
    <div class="relative">
      <input
        v-model="query"
        class="input-base"
        :placeholder="placeholder ?? 'Search articles to link…'"
      />
      <div
        v-if="query && (loading || available.length)"
        class="absolute z-10 mt-1 w-full bg-white border border-light rounded-btn shadow max-h-60 overflow-auto"
      >
        <div v-if="loading" class="px-3 py-2 text-sm text-text/60">Searching…</div>
        <button
          v-for="a in available"
          :key="a.id"
          class="block w-full text-left px-3 py-2 text-sm hover:bg-light"
          @click="add(a)"
        >
          {{ a.title }}
          <span class="text-xs text-text/50 ml-2">{{ a.status }}</span>
        </button>
        <div v-if="!loading && available.length === 0" class="px-3 py-2 text-sm text-text/60">
          No matches.
        </div>
      </div>
    </div>
  </div>
</template>

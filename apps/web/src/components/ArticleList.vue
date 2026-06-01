<script setup lang="ts">
import type { Article } from '@kb/shared';
import ArticleCard from './ArticleCard.vue';

defineProps<{
  items: Article[];
  loading?: boolean;
  emptyText?: string;
  selectedIds?: string[];
}>();
const emit = defineEmits<{ (e: 'toggle', id: string): void }>();
</script>

<template>
  <div>
    <div v-if="loading" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="i in 6" :key="i" class="card animate-pulse">
        <div class="h-4 w-3/4 bg-light rounded mb-2" />
        <div class="h-3 w-full bg-light rounded mb-1" />
        <div class="h-3 w-2/3 bg-light rounded" />
      </div>
    </div>
    <div v-else-if="items.length === 0" class="card text-center text-text/60 py-12">
      {{ emptyText ?? 'No articles found.' }}
    </div>
    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <ArticleCard
        v-for="a in items"
        :key="a.id"
        :article="a"
        :selected="selectedIds?.includes(a.id) ?? false"
        @toggle-select="emit('toggle', a.id)"
      />
    </div>
  </div>
</template>

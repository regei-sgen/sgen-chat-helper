<script setup lang="ts">
import type { Article } from '@kb/shared';
import { PRODUCT_AREA_LABELS, DIFFICULTY_LABELS } from '@kb/shared';
import { renderMarkdown } from '@/lib/markdown';
import Badge from './Badge.vue';
import { computed } from 'vue';

const props = defineProps<{ article: Article }>();

const rendered = computed(() => renderMarkdown(props.article.content));
</script>

<template>
  <div class="space-y-4">
    <header class="card">
      <h2 class="text-xl font-semibold">{{ article.title }}</h2>
      <p v-if="article.summary" class="text-text/70 mt-1">{{ article.summary }}</p>
      <div class="flex flex-wrap gap-2 mt-3">
        <Badge :kind="article.status === 'PUBLISHED' ? 'success' : 'warning'">
          {{ article.status }}
        </Badge>
        <Badge v-if="article.productArea" kind="primary">
          {{ PRODUCT_AREA_LABELS[article.productArea] }}
        </Badge>
        <Badge v-if="article.difficulty" kind="info">
          {{ DIFFICULTY_LABELS[article.difficulty] }}
        </Badge>
        <Badge v-if="article.feature">{{ article.feature }}</Badge>
        <Badge v-for="t in article.tags" :key="t.id">#{{ t.name }}</Badge>
      </div>
    </header>

    <section v-if="article.steps.length" class="card">
      <h3 class="font-semibold mb-2">Steps</h3>
      <ol class="space-y-3">
        <li v-for="(step, idx) in article.steps" :key="step.id ?? idx" class="border-l-2 border-primary pl-3">
          <div class="font-medium">{{ idx + 1 }}. {{ step.title }}</div>
          <div class="prose-body" v-html="renderMarkdown(step.content)" />
        </li>
      </ol>
    </section>

    <section class="card">
      <h3 class="font-semibold mb-2">Content</h3>
      <div class="prose-body" v-html="rendered" />
    </section>

    <section v-if="article.prerequisites.length" class="card">
      <h3 class="font-semibold mb-2">Prerequisites</h3>
      <ul class="list-disc list-inside space-y-1">
        <li v-for="p in article.prerequisites" :key="p.id" class="text-sm">{{ p.title }}</li>
      </ul>
    </section>

    <section v-if="article.relatedTo.length" class="card">
      <h3 class="font-semibold mb-2">Related</h3>
      <ul class="list-disc list-inside space-y-1">
        <li v-for="p in article.relatedTo" :key="p.id" class="text-sm">{{ p.title }}</li>
      </ul>
    </section>
  </div>
</template>

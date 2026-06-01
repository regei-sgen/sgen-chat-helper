<script setup lang="ts">
import type { Article } from '@kb/shared';
import { PRODUCT_AREA_LABELS, DIFFICULTY_LABELS } from '@kb/shared';
import { Check } from 'lucide-vue-next';
import Badge from './Badge.vue';
import { formatDate, truncate } from '@/lib/format';

defineProps<{ article: Article; selected?: boolean }>();
const emit = defineEmits<{ (e: 'toggle-select'): void }>();
</script>

<template>
  <router-link
    :to="`/articles/${article.id}`"
    class="card card-hover block hover:border-primary/40"
    :class="selected ? 'ring-2 ring-primary border-primary/40' : ''"
  >
    <div class="flex items-start gap-2.5">
      <button
        type="button"
        class="mt-0.5 h-5 w-5 shrink-0 rounded border grid place-items-center transition-colors"
        :class="
          selected
            ? 'bg-primary border-primary text-white'
            : 'bg-white border-light hover:border-primary/60'
        "
        :aria-pressed="selected"
        :title="selected ? 'Deselect' : 'Select'"
        @click.prevent.stop="emit('toggle-select')"
      >
        <Check v-if="selected" :size="13" :stroke-width="3" />
      </button>
      <h3 class="font-semibold text-base leading-snug flex-1">{{ article.title }}</h3>
      <Badge
        :kind="
          article.status === 'PUBLISHED'
            ? 'success'
            : article.status === 'DRAFT'
              ? 'warning'
              : 'neutral'
        "
      >
        {{ article.status }}
      </Badge>
    </div>
    <p class="text-sm text-text/70 mt-1">{{ truncate(article.summary ?? '', 140) }}</p>
    <div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <Badge v-if="article.productArea" kind="primary">
        {{ PRODUCT_AREA_LABELS[article.productArea] }}
      </Badge>
      <Badge v-if="article.difficulty" kind="info">
        {{ DIFFICULTY_LABELS[article.difficulty] }}
      </Badge>
      <Badge v-if="article.feature">{{ article.feature }}</Badge>
      <span class="text-text/50 ml-auto">{{ formatDate(article.updatedAt) }}</span>
    </div>
  </router-link>
</template>

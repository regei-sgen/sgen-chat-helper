<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { analyticsApi } from '@/api/resources';
import type { CoverageResponse, TopQuery, UnansweredQuery } from '@kb/shared';
import { PRODUCT_AREA_LABELS } from '@kb/shared';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/api/client';

const coverage = ref<CoverageResponse | null>(null);
const topQueries = ref<TopQuery[]>([]);
const unanswered = ref<UnansweredQuery[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const coverageByArea = computed(() => {
  if (!coverage.value) return [];
  const rows = new Map<string, { draft: number; published: number; archived: number }>();
  for (const r of coverage.value.byArea) {
    const cur = rows.get(r.productArea) ?? { draft: 0, published: 0, archived: 0 };
    if (r.status === 'DRAFT') cur.draft = r.count;
    if (r.status === 'PUBLISHED') cur.published = r.count;
    if (r.status === 'ARCHIVED') cur.archived = r.count;
    rows.set(r.productArea, cur);
  }
  return Array.from(rows.entries()).map(([area, c]) => ({ area, ...c }));
});

onMounted(async () => {
  try {
    const [cov, top, unans] = await Promise.all([
      analyticsApi.coverage(),
      analyticsApi.topQueries(),
      analyticsApi.unanswered(),
    ]);
    coverage.value = cov;
    topQueries.value = top;
    unanswered.value = unans;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load analytics';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Analytics</h1>

    <div v-if="loading" class="card animate-pulse h-32" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-else class="space-y-4">
      <section v-if="coverage" class="grid sm:grid-cols-3 gap-3">
        <div class="card">
          <div class="text-xs text-text/60">Drafts</div>
          <div class="text-2xl font-semibold">{{ coverage.totals.draft }}</div>
        </div>
        <div class="card">
          <div class="text-xs text-text/60">Published</div>
          <div class="text-2xl font-semibold text-success">
            {{ coverage.totals.published }}
          </div>
        </div>
        <div class="card">
          <div class="text-xs text-text/60">Archived</div>
          <div class="text-2xl font-semibold text-text/40">
            {{ coverage.totals.archived }}
          </div>
        </div>
      </section>

      <section v-if="coverageByArea.length" class="card">
        <h2 class="font-semibold mb-2">Coverage by product area</h2>
        <table class="w-full text-sm">
          <thead class="text-left text-text/60">
            <tr>
              <th class="py-1">Area</th>
              <th class="py-1">Draft</th>
              <th class="py-1">Published</th>
              <th class="py-1">Archived</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in coverageByArea" :key="row.area" class="border-t border-light">
              <td class="py-1.5">{{ PRODUCT_AREA_LABELS[row.area as keyof typeof PRODUCT_AREA_LABELS] }}</td>
              <td>{{ row.draft }}</td>
              <td>{{ row.published }}</td>
              <td>{{ row.archived }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2 class="font-semibold mb-2">Top queries</h2>
        <div v-if="topQueries.length === 0" class="text-sm text-text/60">No bot queries yet.</div>
        <table v-else class="w-full text-sm">
          <thead class="text-left text-text/60">
            <tr>
              <th class="py-1">Question</th>
              <th class="py-1">Count</th>
              <th class="py-1">Avg confidence</th>
              <th class="py-1">Helpful %</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in topQueries" :key="q.question" class="border-t border-light">
              <td class="py-1.5 max-w-[400px] truncate">{{ q.question }}</td>
              <td>{{ q.count }}</td>
              <td>{{ q.avgConfidence !== null ? q.avgConfidence.toFixed(2) : '—' }}</td>
              <td>{{ q.helpfulRatio !== null ? Math.round(q.helpfulRatio * 100) + '%' : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2 class="font-semibold mb-2">Unanswered / low-confidence</h2>
        <div v-if="unanswered.length === 0" class="text-sm text-text/60">
          Nothing flagged — every query found a confident match.
        </div>
        <ul v-else class="space-y-2">
          <li
            v-for="q in unanswered"
            :key="q.id"
            class="flex items-start justify-between gap-3 border-b border-light pb-2 text-sm"
          >
            <div>
              <div class="font-medium">{{ q.question }}</div>
              <div class="text-xs text-text/60">{{ formatDateTime(q.createdAt) }}</div>
            </div>
            <div class="text-xs text-text/60 shrink-0">
              {{ q.confidence !== null ? `conf ${q.confidence.toFixed(2)}` : 'no match' }}
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { analyticsApi } from '@/api/resources';
import type {
  AnalyticsSummary,
  CoverageResponse,
  TopQuery,
  UnansweredQuery,
} from '@kb/shared';
import { PRODUCT_AREA_LABELS } from '@kb/shared';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/api/client';
import { Download } from 'lucide-vue-next';

const RANGES: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: null },
];
const range = ref<number | null>(30);

const summary = ref<AnalyticsSummary | null>(null);
const coverage = ref<CoverageResponse | null>(null);
const topQueries = ref<TopQuery[]>([]);
const unanswered = ref<UnansweredQuery[]>([]);
const loading = ref(true); // initial full load
const refreshing = ref(false); // range-change reloads
const error = ref<string | null>(null);

// ── Content coverage by area (article status mix per product area) ──────────
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
  return Array.from(rows.entries())
    .map(([area, c]) => ({ area, ...c, total: c.draft + c.published + c.archived }))
    .sort((a, b) => b.total - a.total);
});
const coverageByPillar = computed(() => {
  if (!coverage.value) return [];
  const rows = new Map<string, { draft: number; published: number; archived: number }>();
  for (const r of coverage.value.byPillar) {
    const cur = rows.get(r.productPillar) ?? { draft: 0, published: 0, archived: 0 };
    if (r.status === 'DRAFT') cur.draft = r.count;
    if (r.status === 'PUBLISHED') cur.published = r.count;
    if (r.status === 'ARCHIVED') cur.archived = r.count;
    rows.set(r.productPillar, cur);
  }
  return Array.from(rows.entries())
    .map(([label, c]) => ({ label, ...c, total: c.draft + c.published + c.archived }))
    .sort((a, b) => b.total - a.total);
});

// Prefer the populated pillar breakdown; fall back to product-area (labelled) when pillars are empty.
const coverageGroups = computed(() =>
  coverageByPillar.value.length
    ? coverageByPillar.value
    : coverageByArea.value.map((r) => ({
        label: PRODUCT_AREA_LABELS[r.area as keyof typeof PRODUCT_AREA_LABELS] ?? r.area,
        draft: r.draft,
        published: r.published,
        archived: r.archived,
        total: r.total,
      })),
);
const coverageGroupsTitle = computed(() =>
  coverageByPillar.value.length ? 'By product pillar' : 'By product area',
);
const coverageMax = computed(() => Math.max(1, ...coverageGroups.value.map((r) => r.total)));

// ── Queries-per-day trend: zero-fill the sparse daily data across the window ─
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function offsetKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86400000).toISOString().slice(0, 10);
}
const series = computed(() => {
  const daily = summary.value?.daily ?? [];
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const end = todayKey();
  let start: string;
  if (range.value) start = offsetKey(end, -(range.value - 1));
  else if (daily.length) start = daily[0].date;
  else return [] as { date: string; count: number; matched: number }[];
  const out: { date: string; count: number; matched: number }[] = [];
  for (let k = start; k <= end; k = offsetKey(k, 1)) {
    const e = byDate.get(k);
    out.push({ date: k, count: e?.count ?? 0, matched: e?.matched ?? 0 });
  }
  return out;
});
const maxDaily = computed(() => Math.max(1, ...series.value.map((d) => d.count)));
const peakDay = computed(() =>
  series.value.reduce((m, d) => (d.count > m ? d.count : m), 0),
);

const fmtPct = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
const fmtConf = (x: number | null | undefined) =>
  x === null || x === undefined ? '—' : x.toFixed(2);
const rangeLabel = computed(
  () => RANGES.find((r) => r.days === range.value)?.label ?? `${range.value}d`,
);

// ── Tables: pagination + CSV export + colour helpers ────────────────────────
const PAGE_SIZE = 10;
const topPage = ref(1);
const unansPage = ref(1);
const topPages = computed(() => Math.max(1, Math.ceil(topQueries.value.length / PAGE_SIZE)));
const unansPages = computed(() => Math.max(1, Math.ceil(unanswered.value.length / PAGE_SIZE)));
const topPaged = computed(() =>
  topQueries.value.slice((topPage.value - 1) * PAGE_SIZE, topPage.value * PAGE_SIZE),
);
const unansPaged = computed(() =>
  unanswered.value.slice((unansPage.value - 1) * PAGE_SIZE, unansPage.value * PAGE_SIZE),
);

// Confidence → colour tier (high = green, mid = amber, low = red, none = grey).
function confBadge(c: number | null): string {
  if (c === null) return 'bg-light text-text/50';
  if (c >= 0.7) return 'bg-success/15 text-success';
  if (c >= 0.5) return 'bg-warning/20 text-warning';
  return 'bg-danger/15 text-danger';
}

function csvEscape(v: string | number | null): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCsv(filename: string, headers: string[], rows: (string | number | null)[][]): void {
  const body = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }); // BOM → Excel opens UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
const rangeTag = computed(() => `${range.value ? `${range.value}d` : 'all'}-${todayKey()}`);
function exportTopQueries(): void {
  downloadCsv(
    `top-queries-${rangeTag.value}.csv`,
    ['Question', 'Count', 'Avg confidence', 'Helpful %'],
    topQueries.value.map((q) => [
      q.question,
      q.count,
      q.avgConfidence !== null ? q.avgConfidence.toFixed(2) : '',
      q.helpfulRatio !== null ? `${Math.round(q.helpfulRatio * 100)}%` : '',
    ]),
  );
}
function exportUnanswered(): void {
  downloadCsv(
    `unanswered-${rangeTag.value}.csv`,
    ['Question', 'Confidence', 'Matched', 'When'],
    unanswered.value.map((q) => [
      q.question,
      q.confidence !== null ? q.confidence.toFixed(2) : '',
      q.matchedId ? 'yes' : 'no',
      new Date(q.createdAt).toISOString(),
    ]),
  );
}

async function loadUsage() {
  const [sum, top, unans] = await Promise.all([
    analyticsApi.summary(range.value),
    analyticsApi.topQueries(range.value),
    analyticsApi.unanswered(range.value),
  ]);
  summary.value = sum;
  topQueries.value = top;
  unanswered.value = unans;
}

onMounted(async () => {
  try {
    const [cov] = await Promise.all([analyticsApi.coverage(), loadUsage()]);
    coverage.value = cov;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load analytics';
  } finally {
    loading.value = false;
  }
});

watch(range, async () => {
  refreshing.value = true;
  topPage.value = 1;
  unansPage.value = 1;
  try {
    await loadUsage();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load analytics';
  } finally {
    refreshing.value = false;
  }
});
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3 mb-4">
      <h1 class="text-2xl font-semibold">Analytics</h1>
      <!-- date-range selector (scopes the bot-usage metrics) -->
      <div class="inline-flex rounded-btn border border-light overflow-hidden text-sm">
        <button
          v-for="r in RANGES"
          :key="r.label"
          class="px-3 py-1.5 transition-colors"
          :class="
            range === r.days
              ? 'bg-primary text-white'
              : 'bg-surface text-text/70 hover:bg-light'
          "
          @click="range = r.days"
        >
          {{ r.label }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card animate-pulse h-32" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-else class="space-y-6" :class="refreshing ? 'opacity-60 transition-opacity' : ''">
      <!-- ── Bot usage ─────────────────────────────────────────────── -->
      <section v-if="summary" class="space-y-3">
        <h2 class="text-sm font-semibold text-text/60">
          Bot usage · {{ range ? `last ${rangeLabel}` : 'all time' }}
        </h2>
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="card">
            <div class="text-xs text-text/60">Questions asked</div>
            <div class="text-2xl font-semibold">{{ summary.totalQueries }}</div>
          </div>
          <div class="card">
            <div class="text-xs text-text/60">Answered rate</div>
            <div class="text-2xl font-semibold text-success">
              {{ fmtPct(summary.answeredRate) }}
            </div>
            <div class="text-[11px] text-text/50">{{ summary.matched }} matched a KB article</div>
          </div>
          <div class="card">
            <div class="text-xs text-text/60">Avg confidence</div>
            <div class="text-2xl font-semibold">{{ fmtConf(summary.avgConfidence) }}</div>
          </div>
          <div class="card">
            <div class="text-xs text-text/60">Helpful 👍</div>
            <div
              class="text-2xl font-semibold"
              :class="summary.helpfulRate !== null ? 'text-success' : 'text-text/40'"
            >
              {{ summary.helpfulRate !== null ? fmtPct(summary.helpfulRate) : '—' }}
            </div>
            <div class="text-[11px] text-text/50">
              {{ summary.withFeedback > 0 ? `${summary.withFeedback} rated` : 'no feedback yet' }}
            </div>
          </div>
        </div>

        <!-- queries-per-day trend -->
        <div class="card">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-semibold text-sm">Queries per day</h3>
            <div class="flex items-center gap-3 text-[11px] text-text/55">
              <span class="inline-flex items-center gap-1">
                <span class="w-2.5 h-2.5 rounded-sm bg-primary" /> answered
              </span>
              <span class="inline-flex items-center gap-1">
                <span class="w-2.5 h-2.5 rounded-sm bg-primary/25" /> no match
              </span>
            </div>
          </div>
          <div v-if="peakDay === 0" class="text-sm text-text/60 py-6 text-center">
            No queries in this range.
          </div>
          <template v-else>
            <div class="flex items-stretch gap-px h-28">
              <div
                v-for="b in series"
                :key="b.date"
                class="flex-1 flex flex-col justify-end min-w-0 group"
                :title="`${b.date} · ${b.count} queries (${b.matched} answered)`"
              >
                <div
                  class="w-full rounded-t-sm bg-primary/25 group-hover:bg-primary/40 transition-colors"
                  :style="{ height: `${((b.count - b.matched) / maxDaily) * 100}%` }"
                />
                <div
                  class="w-full bg-primary group-hover:bg-primary-hover transition-colors"
                  :class="b.count - b.matched === 0 ? 'rounded-t-sm' : ''"
                  :style="{ height: `${(b.matched / maxDaily) * 100}%` }"
                />
              </div>
            </div>
            <div class="flex justify-between text-[10px] text-text/45 mt-1.5">
              <span>{{ series[0]?.date }}</span>
              <span>peak {{ peakDay }}/day</span>
              <span>{{ series[series.length - 1]?.date }}</span>
            </div>
          </template>
        </div>
      </section>

      <!-- ── Content coverage ──────────────────────────────────────── -->
      <section class="space-y-3">
        <h2 class="text-sm font-semibold text-text/60">Content coverage</h2>
        <div v-if="coverage" class="grid grid-cols-3 gap-3">
          <div class="card">
            <div class="text-xs text-text/60">Published</div>
            <div class="text-2xl font-semibold text-success">{{ coverage.totals.published }}</div>
          </div>
          <div class="card">
            <div class="text-xs text-text/60">Drafts</div>
            <div class="text-2xl font-semibold text-warning">{{ coverage.totals.draft }}</div>
          </div>
          <div class="card">
            <div class="text-xs text-text/60">Archived</div>
            <div class="text-2xl font-semibold text-text/40">{{ coverage.totals.archived }}</div>
          </div>
        </div>

        <div v-if="coverageGroups.length" class="card">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-semibold text-sm">{{ coverageGroupsTitle }}</h3>
            <div class="flex items-center gap-3 text-[11px] text-text/55">
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-success" /> published</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-warning" /> draft</span>
              <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm bg-text/25" /> archived</span>
            </div>
          </div>
          <div class="space-y-2.5">
            <div v-for="row in coverageGroups" :key="row.label">
              <div class="flex items-center justify-between text-xs mb-1">
                <span class="font-medium">{{ row.label }}</span>
                <span class="text-text/55">
                  {{ row.published }} pub · {{ row.draft }} draft · {{ row.archived }} arch
                  <span class="text-text/40">({{ row.total }})</span>
                </span>
              </div>
              <div class="h-2.5 rounded-full bg-light overflow-hidden">
                <div class="flex h-full" :style="{ width: `${(row.total / coverageMax) * 100}%` }">
                  <div class="bg-success h-full" :style="{ flexGrow: row.published }" :title="`${row.published} published`" />
                  <div class="bg-warning h-full" :style="{ flexGrow: row.draft }" :title="`${row.draft} drafts`" />
                  <div class="bg-text/25 h-full" :style="{ flexGrow: row.archived }" :title="`${row.archived} archived`" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Top queries ───────────────────────────────────────────── -->
      <section class="card">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="font-semibold">
            Top queries
            <span class="text-text/50 font-normal text-sm">({{ topQueries.length }})</span>
          </h2>
          <button
            v-if="topQueries.length"
            class="inline-flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/40 rounded-btn px-2.5 py-1 hover:bg-primary/5 transition-colors"
            @click="exportTopQueries"
          >
            <Download :size="13" /> CSV
          </button>
        </div>
        <div v-if="topQueries.length === 0" class="text-sm text-text/60">
          No bot queries in this range.
        </div>
        <template v-else>
          <div class="overflow-hidden rounded-btn border border-light">
            <table class="w-full text-sm">
              <thead class="bg-light/60 text-left text-[11px] uppercase tracking-wide text-text/55">
                <tr>
                  <th class="px-3 py-2 font-semibold">Question</th>
                  <th class="px-3 py-2 font-semibold w-16 text-right">Count</th>
                  <th class="px-3 py-2 font-semibold w-28">Avg confidence</th>
                  <th class="px-3 py-2 font-semibold w-20 text-right">Helpful %</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="q in topPaged"
                  :key="q.question"
                  class="border-t border-light odd:bg-surface even:bg-light/20 hover:bg-primary/5 transition-colors"
                >
                  <td class="px-3 py-2 max-w-[420px] truncate" :title="q.question">{{ q.question }}</td>
                  <td class="px-3 py-2 text-right tabular-nums font-medium">{{ q.count }}</td>
                  <td class="px-3 py-2">
                    <span
                      class="inline-block px-1.5 py-0.5 rounded text-xs font-medium tabular-nums"
                      :class="confBadge(q.avgConfidence)"
                    >
                      {{ q.avgConfidence !== null ? q.avgConfidence.toFixed(2) : '—' }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ q.helpfulRatio !== null ? Math.round(q.helpfulRatio * 100) + '%' : '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="topPages > 1"
            class="flex items-center justify-between mt-2 text-xs text-text/60"
          >
            <span>
              {{ (topPage - 1) * PAGE_SIZE + 1 }}–{{ Math.min(topPage * PAGE_SIZE, topQueries.length) }}
              of {{ topQueries.length }}
            </span>
            <div class="flex items-center gap-1">
              <button
                class="px-2 py-1 rounded-btn border border-light hover:bg-light disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="topPage <= 1"
                @click="topPage--"
              >
                Prev
              </button>
              <span class="px-1">{{ topPage }} / {{ topPages }}</span>
              <button
                class="px-2 py-1 rounded-btn border border-light hover:bg-light disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="topPage >= topPages"
                @click="topPage++"
              >
                Next
              </button>
            </div>
          </div>
        </template>
      </section>

      <!-- ── Unanswered / low-confidence ───────────────────────────── -->
      <section class="card">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h2 class="font-semibold">
            Unanswered / low-confidence
            <span class="text-text/50 font-normal text-sm">({{ unanswered.length }})</span>
          </h2>
          <button
            v-if="unanswered.length"
            class="inline-flex items-center gap-1.5 text-xs font-medium text-primary border border-primary/40 rounded-btn px-2.5 py-1 hover:bg-primary/5 transition-colors"
            @click="exportUnanswered"
          >
            <Download :size="13" /> CSV
          </button>
        </div>
        <div v-if="unanswered.length === 0" class="text-sm text-text/60">
          Nothing flagged — every query found a confident match.
        </div>
        <template v-else>
          <div class="overflow-hidden rounded-btn border border-light">
            <table class="w-full text-sm">
              <thead class="bg-light/60 text-left text-[11px] uppercase tracking-wide text-text/55">
                <tr>
                  <th class="px-3 py-2 font-semibold">Question</th>
                  <th class="px-3 py-2 font-semibold w-28">Status</th>
                  <th class="px-3 py-2 font-semibold w-40">When</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="q in unansPaged"
                  :key="q.id"
                  class="border-t border-light odd:bg-surface even:bg-light/20 hover:bg-primary/5 transition-colors"
                >
                  <td class="px-3 py-2 max-w-[460px] truncate" :title="q.question">{{ q.question }}</td>
                  <td class="px-3 py-2">
                    <span
                      v-if="q.matchedId === null"
                      class="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-danger/15 text-danger"
                    >
                      no match
                    </span>
                    <span
                      v-else
                      class="inline-block px-1.5 py-0.5 rounded text-xs font-medium tabular-nums"
                      :class="confBadge(q.confidence)"
                    >
                      conf {{ q.confidence !== null ? q.confidence.toFixed(2) : '—' }}
                    </span>
                  </td>
                  <td class="px-3 py-2 text-text/60 whitespace-nowrap">{{ formatDateTime(q.createdAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="unansPages > 1"
            class="flex items-center justify-between mt-2 text-xs text-text/60"
          >
            <span>
              {{ (unansPage - 1) * PAGE_SIZE + 1 }}–{{ Math.min(unansPage * PAGE_SIZE, unanswered.length) }}
              of {{ unanswered.length }}
            </span>
            <div class="flex items-center gap-1">
              <button
                class="px-2 py-1 rounded-btn border border-light hover:bg-light disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="unansPage <= 1"
                @click="unansPage--"
              >
                Prev
              </button>
              <span class="px-1">{{ unansPage }} / {{ unansPages }}</span>
              <button
                class="px-2 py-1 rounded-btn border border-light hover:bg-light disabled:opacity-40 disabled:cursor-not-allowed"
                :disabled="unansPage >= unansPages"
                @click="unansPage++"
              >
                Next
              </button>
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

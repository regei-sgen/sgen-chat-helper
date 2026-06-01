<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useArticlesStore } from '@/stores/articles';
import { PRODUCT_AREA_LABELS, type ArticleStatus, type ProductArea, type BulkAction } from '@kb/shared';
import ArticleList from '@/components/ArticleList.vue';
import Button from '@/components/Button.vue';
import Select from '@/components/Select.vue';
import AutoLinkButton from '@/components/AutoLinkButton.vue';

const router = useRouter();
const route = useRoute();
const store = useArticlesStore();

const search = ref('');
const status = ref<ArticleStatus | null>(null);
const productArea = ref<ProductArea | null>(null);
const duplicatesOnly = ref(route.query.duplicates === '1' || route.query.duplicates === 'true');

// ---- multi-select / bulk actions ----
const selected = ref<string[]>([]);
const bulkBusy = ref(false);
const bulkMsg = ref<string | null>(null);

const allOnPageSelected = computed(
  () => store.items.length > 0 && store.items.every((a) => selected.value.includes(a.id)),
);

function toggleSelect(id: string) {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((x) => x !== id)
    : [...selected.value, id];
}
function toggleAllOnPage() {
  const pageIds = store.items.map((a) => a.id);
  if (allOnPageSelected.value) {
    const drop = new Set(pageIds);
    selected.value = selected.value.filter((id) => !drop.has(id));
  } else {
    selected.value = [...new Set([...selected.value, ...pageIds])];
  }
}
function clearSelection() {
  selected.value = [];
}

const BULK_LABELS: Record<BulkAction, string> = {
  publish: 'published',
  draft: 'moved to Draft',
  archive: 'archived',
  delete: 'deleted',
};

async function runBulk(action: BulkAction) {
  if (selected.value.length === 0) return;
  if (
    action === 'delete' &&
    !window.confirm(`Delete ${selected.value.length} article(s)? This cannot be undone.`)
  ) {
    return;
  }
  bulkBusy.value = true;
  bulkMsg.value = null;
  try {
    const result = await store.bulk([...selected.value], action); // store.bulk reloads the list
    selected.value = [];
    bulkMsg.value =
      result.failed.length > 0
        ? `${result.succeeded} ${BULK_LABELS[action]}, ${result.failed.length} failed.`
        : `${result.succeeded} article(s) ${BULK_LABELS[action]}.`;
  } catch (err) {
    bulkMsg.value = err instanceof Error ? err.message : 'Bulk action failed';
  } finally {
    bulkBusy.value = false;
  }
}

const tabs: Array<{ label: string; value: ArticleStatus | null }> = [
  { label: 'All', value: null },
  { label: 'Drafts', value: 'DRAFT' },
  { label: 'Published', value: 'PUBLISHED' },
  { label: 'Archived', value: 'ARCHIVED' },
];

const productAreaOptions = [
  ...Object.entries(PRODUCT_AREA_LABELS).map(([value, label]) => ({ value, label })),
];

const totalPages = computed(() =>
  Math.max(1, Math.ceil(store.total / (store.filters.pageSize ?? 20))),
);

async function reload() {
  clearSelection();
  await store.fetchList({
    status: status.value ?? undefined,
    productArea: productArea.value ?? undefined,
    search: search.value || undefined,
    duplicates: duplicatesOnly.value || undefined,
    page: 1,
  });
}

let searchTimer: number | null = null;
watch(search, () => {
  if (searchTimer) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(reload, 250);
});
watch([status, productArea, duplicatesOnly], reload);

onMounted(reload);

function goPage(p: number) {
  clearSelection();
  store.fetchList({ page: p });
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-4">
      <h1 class="text-2xl font-semibold">Articles</h1>
      <div class="flex gap-2">
        <AutoLinkButton @applied="reload" />
        <Button variant="ghost" size="sm" @click="router.push('/articles/upload')">
          Upload markdown
        </Button>
        <Button size="sm" @click="router.push('/articles/new')">+ New article</Button>
      </div>
    </div>

    <div class="card mb-4 flex flex-wrap gap-3 items-end">
      <div class="flex-1 min-w-[240px]">
        <label class="block text-sm font-medium mb-1">Search</label>
        <input
          v-model="search"
          class="input-base"
          placeholder="Search title, summary, content…"
        />
      </div>
      <Select
        :model-value="productArea"
        label="Product area"
        placeholder="All areas"
        :options="productAreaOptions"
        @update:model-value="(v) => (productArea = (v ?? null) as ProductArea | null)"
      />
    </div>

    <div class="flex items-center justify-between gap-3 mb-3">
      <div class="flex gap-1">
        <button
          v-for="tab in tabs"
          :key="String(tab.value)"
          class="px-3 py-1.5 text-sm rounded-btn border"
          :class="
            status === tab.value
              ? 'bg-secondary text-white border-secondary'
              : 'bg-white text-text border-light hover:bg-light'
          "
          @click="status = tab.value"
        >
          {{ tab.label }}
        </button>
      </div>
      <label
        v-if="store.items.length"
        class="flex items-center gap-1.5 text-sm text-text/70 cursor-pointer select-none whitespace-nowrap"
      >
        <input
          type="checkbox"
          class="h-4 w-4 accent-primary"
          :checked="allOnPageSelected"
          @change="toggleAllOnPage"
        />
        Select page
      </label>
    </div>

    <div
      v-if="duplicatesOnly"
      class="card mb-3 flex items-center justify-between bg-primary/5 border border-primary/30"
    >
      <span class="text-sm">Showing items flagged as possible duplicates for review.</span>
      <Button variant="ghost" size="sm" @click="duplicatesOnly = false">Show all</Button>
    </div>

    <p v-if="store.error" class="text-sm text-danger mb-2">{{ store.error }}</p>

    <div
      v-if="selected.length"
      class="card mb-3 flex flex-wrap items-center gap-2 bg-secondary/5 border border-secondary/30"
    >
      <span class="text-sm font-medium">{{ selected.length }} selected</span>
      <button
        class="text-sm text-text/60 hover:text-text underline ml-1"
        @click="clearSelection"
      >
        Clear
      </button>
      <div class="flex flex-wrap gap-2 ml-auto">
        <Button variant="ghost" size="sm" :loading="bulkBusy" @click="runBulk('publish')">
          Publish
        </Button>
        <Button variant="ghost" size="sm" :loading="bulkBusy" @click="runBulk('draft')">
          Move to Draft
        </Button>
        <Button variant="ghost" size="sm" :loading="bulkBusy" @click="runBulk('archive')">
          Archive
        </Button>
        <Button
          variant="ghost"
          size="sm"
          class="text-danger"
          :loading="bulkBusy"
          @click="runBulk('delete')"
        >
          Delete
        </Button>
      </div>
    </div>
    <p v-if="bulkMsg" class="text-sm text-text/70 mb-2">{{ bulkMsg }}</p>

    <ArticleList
      :items="store.items"
      :loading="store.loading"
      :selected-ids="selected"
      @toggle="toggleSelect"
    />

    <div v-if="totalPages > 1" class="flex justify-center items-center gap-2 mt-4 text-sm">
      <button
        class="px-3 py-1 rounded-btn border border-light"
        :disabled="(store.filters.page ?? 1) <= 1"
        @click="goPage((store.filters.page ?? 1) - 1)"
      >
        Prev
      </button>
      <span class="text-text/60">
        Page {{ store.filters.page ?? 1 }} / {{ totalPages }} ({{ store.total }} total)
      </span>
      <button
        class="px-3 py-1 rounded-btn border border-light"
        :disabled="(store.filters.page ?? 1) >= totalPages"
        @click="goPage((store.filters.page ?? 1) + 1)"
      >
        Next
      </button>
    </div>
  </div>
</template>

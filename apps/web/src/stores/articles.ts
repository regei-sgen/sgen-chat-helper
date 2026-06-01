import { defineStore } from 'pinia';
import { ref } from 'vue';
import { articleApi } from '@/api/resources';
import type {
  Article,
  ArticleCreateInput,
  ArticleListQuery,
  ArticleUpdateInput,
  BulkAction,
} from '@kb/shared';

export const useArticlesStore = defineStore('articles', () => {
  const items = ref<Article[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const current = ref<Article | null>(null);
  const filters = ref<Partial<ArticleListQuery>>({
    page: 1,
    pageSize: 20,
  });

  async function fetchList(override?: Partial<ArticleListQuery>) {
    loading.value = true;
    error.value = null;
    try {
      const merged = { ...filters.value, ...override };
      filters.value = merged;
      const res = await articleApi.list(merged);
      items.value = res.items;
      total.value = res.total;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load articles';
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: string) {
    loading.value = true;
    error.value = null;
    try {
      current.value = await articleApi.get(id);
      return current.value;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load article';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function create(input: ArticleCreateInput) {
    const created = await articleApi.create(input);
    current.value = created;
    return created;
  }

  async function update(id: string, input: ArticleUpdateInput) {
    const updated = await articleApi.update(id, input);
    current.value = updated;
    items.value = items.value.map((a) => (a.id === id ? updated : a));
    return updated;
  }

  async function remove(id: string) {
    await articleApi.remove(id);
    items.value = items.value.filter((a) => a.id !== id);
    total.value = Math.max(0, total.value - 1);
  }

  async function publish(id: string) {
    const updated = await articleApi.publish(id);
    items.value = items.value.map((a) => (a.id === id ? updated : a));
    current.value = updated;
    return updated;
  }

  async function bulk(ids: string[], action: BulkAction) {
    const result = await articleApi.bulk(ids, action);
    // Refresh the current page so statuses/removals reflect immediately.
    await fetchList();
    return result;
  }

  return {
    items,
    total,
    loading,
    error,
    current,
    filters,
    fetchList,
    fetchOne,
    create,
    update,
    remove,
    publish,
    bulk,
  };
});

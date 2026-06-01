<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useArticlesStore } from '@/stores/articles';
import { useToastStore } from '@/stores/toast';
import ArticleForm from '@/components/ArticleForm.vue';
import type { Article, ArticleCreateInput } from '@kb/shared';
import { ApiError } from '@/api/client';

const route = useRoute();
const router = useRouter();
const store = useArticlesStore();
const toast = useToastStore();

const article = ref<Article | null>(null);
const loading = ref(false);
const submitting = ref(false);
const error = ref<string | null>(null);

const articleId = computed(() => route.params.id as string | undefined);
const isNew = computed(() => !articleId.value);

onMounted(async () => {
  if (!articleId.value) return;
  loading.value = true;
  try {
    article.value = await store.fetchOne(articleId.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
});

async function onSubmit(payload: ArticleCreateInput) {
  submitting.value = true;
  error.value = null;
  try {
    if (isNew.value) {
      const created = await store.create(payload);
      toast.success('Article created');
      router.push(`/articles/${created.id}`);
    } else if (articleId.value) {
      const updated = await store.update(articleId.value, payload);
      article.value = updated;
      toast.success('Article saved');
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Save failed';
    toast.error(error.value);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center justify-between">
      <h1 class="text-2xl font-semibold">
        {{ isNew ? 'New article' : 'Edit article' }}
      </h1>
      <router-link v-if="!isNew && articleId" :to="`/articles/${articleId}`" class="text-sm text-primary underline">
        ← Back to view
      </router-link>
    </div>

    <div v-if="loading" class="card animate-pulse h-40" />
    <p v-else-if="error" class="text-sm text-danger mb-2">{{ error }}</p>

    <ArticleForm
      v-else
      :initial="article"
      :submitting="submitting"
      :submit-label="isNew ? 'Create article' : 'Save changes'"
      @submit="onSubmit"
    />
  </div>
</template>

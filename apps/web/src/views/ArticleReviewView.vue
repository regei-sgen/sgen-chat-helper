<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { Article } from '@kb/shared';
import { useArticlesStore } from '@/stores/articles';
import { useToastStore } from '@/stores/toast';
import ReviewPanel from '@/components/ReviewPanel.vue';
import Button from '@/components/Button.vue';
import { ApiError } from '@/api/client';

const route = useRoute();
const router = useRouter();
const store = useArticlesStore();
const toast = useToastStore();

const article = ref<Article | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const articleId = computed(() => route.params.id as string);

onMounted(async () => {
  try {
    article.value = await store.fetchOne(articleId.value);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
});

async function approveAndPublish() {
  if (!article.value) return;
  try {
    article.value = await store.publish(article.value.id);
    toast.success('Published');
    router.push(`/articles/${article.value.id}`);
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Publish failed');
  }
}

function editFirst() {
  if (!article.value) return;
  router.push(`/articles/${article.value.id}/edit`);
}

async function discard() {
  if (!article.value) return;
  try {
    await store.remove(article.value.id);
    toast.success('Draft discarded');
    router.push('/articles/upload');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Delete failed');
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <h1 class="text-2xl font-semibold">Review structured article</h1>
      <span class="text-text/60">Claude has parsed your markdown — review and approve.</span>
    </div>

    <div v-if="loading" class="card animate-pulse h-40" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-else-if="article" class="space-y-4">
      <ReviewPanel :article="article" />
      <div class="flex justify-end gap-2 sticky bottom-2">
        <Button variant="ghost" size="sm" @click="discard">Discard draft</Button>
        <Button variant="secondary" size="sm" @click="editFirst">Edit before publish</Button>
        <Button size="sm" @click="approveAndPublish">Approve & publish</Button>
      </div>
    </div>
  </div>
</template>

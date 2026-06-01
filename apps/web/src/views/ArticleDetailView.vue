<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useArticlesStore } from '@/stores/articles';
import { useToastStore } from '@/stores/toast';
import type { Article } from '@kb/shared';
import ReviewPanel from '@/components/ReviewPanel.vue';
import Button from '@/components/Button.vue';
import Modal from '@/components/Modal.vue';
import { articleApi } from '@/api/resources';
import { ApiError } from '@/api/client';

const route = useRoute();
const router = useRouter();
const store = useArticlesStore();
const toast = useToastStore();

const article = ref<Article | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const confirmDelete = ref(false);
const duplicateOfTitle = ref<string | null>(null);
const resolving = ref(false);

const articleId = computed(() => route.params.id as string);

onMounted(load);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    article.value = await store.fetchOne(articleId.value);
    duplicateOfTitle.value = null;
    if (article.value?.duplicateOf) {
      try {
        const orig = await articleApi.get(article.value.duplicateOf);
        duplicateOfTitle.value = orig.title;
      } catch {
        duplicateOfTitle.value = null;
      }
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function onPublish() {
  if (!article.value) return;
  try {
    article.value = await store.publish(article.value.id);
    toast.success('Published');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Publish failed');
  }
}

async function onDelete() {
  if (!article.value) return;
  try {
    await store.remove(article.value.id);
    toast.success('Article deleted');
    router.push('/articles');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Delete failed');
  } finally {
    confirmDelete.value = false;
  }
}

async function resolveDup(action: 'override' | 'dismiss') {
  if (!article.value) return;
  resolving.value = true;
  try {
    if (action === 'override') {
      const updated = await articleApi.resolveDuplicate(article.value.id, 'override');
      toast.success('Original article updated with this content');
      router.push(`/articles/${updated.id}/review`);
    } else {
      article.value = await articleApi.resolveDuplicate(article.value.id, 'dismiss');
      duplicateOfTitle.value = null;
      toast.success('Marked as not a duplicate');
    }
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  } finally {
    resolving.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <h1 class="text-2xl font-semibold">{{ article?.title ?? 'Article' }}</h1>
      <div class="ml-auto flex gap-2">
        <Button v-if="article && article.status !== 'PUBLISHED'" size="sm" @click="onPublish">
          Publish
        </Button>
        <Button
          v-if="article"
          variant="ghost"
          size="sm"
          @click="router.push(`/articles/${article.id}/edit`)"
        >
          Edit
        </Button>
        <Button v-if="article" variant="ghost" size="sm" @click="confirmDelete = true">
          Delete
        </Button>
      </div>
    </div>

    <div v-if="loading" class="card animate-pulse h-40" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>
    <template v-else-if="article">
      <div
        v-if="article.duplicateOf"
        class="card border border-primary/40 bg-primary/5 mb-4 space-y-2"
      >
        <div class="font-medium">Possible duplicate</div>
        <p class="text-sm text-text/70">
          This draft looks like a duplicate of
          <strong>{{ duplicateOfTitle ?? 'an existing article' }}</strong>
          <span v-if="article.duplicateScore">
            ({{ Math.round(article.duplicateScore * 100) }}% similar)</span
          >. Override the original with this draft's content, or dismiss the flag to keep both.
        </p>
        <div class="flex gap-2">
          <Button size="sm" :loading="resolving" @click="resolveDup('override')">
            Override original
          </Button>
          <Button variant="ghost" size="sm" :loading="resolving" @click="resolveDup('dismiss')">
            Not a duplicate
          </Button>
        </div>
      </div>
      <ReviewPanel :article="article" />
    </template>

    <Modal :open="confirmDelete" title="Delete article" size="sm" @close="confirmDelete = false">
      <p>This will permanently remove the article and its steps. Continue?</p>
      <template #footer>
        <Button variant="ghost" size="sm" @click="confirmDelete = false">Cancel</Button>
        <Button size="sm" @click="onDelete">Delete</Button>
      </template>
    </Modal>
  </div>
</template>

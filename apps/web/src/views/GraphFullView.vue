<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { graphApi, chatTesterApi } from '@/api/resources';
import { renderMarkdown } from '@/lib/markdown';
import GraphView from '@/components/GraphView.vue';
import { PRODUCT_AREA_LABELS, type GraphResponse, type GraphNode, type ChatMessage } from '@kb/shared';
import { ApiError } from '@/api/client';
import { X, ExternalLink } from 'lucide-vue-next';

const router = useRouter();

const data = ref<GraphResponse>({ nodes: [], edges: [] });
const loading = ref(true);
const error = ref<string | null>(null);
const highlightArea = ref<string | null>(null);
const selected = ref<GraphNode | null>(null);

const areaOptions = Object.entries(PRODUCT_AREA_LABELS).map(([value, label]) => ({ value, label }));

onMounted(load);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await graphApi.fetch();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load graph';
  } finally {
    loading.value = false;
  }
}

function onSelectNode(node: GraphNode) {
  selected.value = node;
}

function openArticle(id: string) {
  window.open(router.resolve(`/articles/${id}`).href, '_blank', 'noopener');
}

function close() {
  // This page is meant to be opened in its own tab.
  window.close();
  // Fallback if the tab can't be closed by script.
  router.push('/graph');
}

// --- Ask the graph: each answer spotlights the article node(s) it came from ---
const spotlightSlugs = ref<string[]>([]);
const chatInput = ref('');
const chatLoading = ref(false);
const chatReply = ref('');
const chatSources = ref<{ title: string; slug: string }[]>([]);
const chatHistory = ref<ChatMessage[]>([]);

async function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg || chatLoading.value) return;
  chatInput.value = '';
  chatLoading.value = true;
  chatReply.value = '';
  chatSources.value = [];
  try {
    const r = await chatTesterApi.send(msg, chatHistory.value.slice(-6));
    chatReply.value = r.reply;
    // Collect the slugs of the article(s) the answer came from → spotlight them on the graph.
    const slugs = new Set<string>();
    (r.walkthrough?.steps ?? []).forEach((s) => s.slug && slugs.add(s.slug));
    if (slugs.size === 0) r.sources.forEach((s) => slugs.add(s.slug));
    spotlightSlugs.value = [...slugs];
    chatSources.value = r.sources.slice(0, 6);
    chatHistory.value.push({ role: 'user', content: msg }, { role: 'assistant', content: r.reply });
  } catch (err) {
    chatReply.value = 'Sorry — ' + (err instanceof ApiError ? err.message : 'something went wrong.');
  } finally {
    chatLoading.value = false;
  }
}

function spotlight(slug: string) {
  spotlightSlugs.value = [slug];
}
</script>

<template>
  <div class="fixed inset-0 bg-[#05070d] text-slate-200">
    <GraphView
      v-if="!loading && !error"
      :data="data"
      :highlight-area="highlightArea"
      :spotlight-slugs="spotlightSlugs"
      height-class="h-screen"
      :frameless="true"
      @select-node="onSelectNode"
    />
    <div v-else-if="loading" class="h-screen grid place-items-center text-slate-400">
      Loading graph…
    </div>
    <div v-else class="h-screen grid place-items-center text-danger">{{ error }}</div>

    <!-- Toolbar -->
    <div
      class="absolute top-3 left-3 flex items-center gap-2 bg-black/40 backdrop-blur px-3 py-2 rounded-btn border border-white/10"
    >
      <span class="font-semibold text-sm">Knowledge graph</span>
      <select
        :value="highlightArea ?? ''"
        class="bg-black/30 text-slate-200 text-xs border border-white/15 rounded px-2 py-1 outline-none"
        @change="(e) => (highlightArea = (e.target as HTMLSelectElement).value || null)"
      >
        <option value="" class="text-black">Highlight: all areas</option>
        <option v-for="o in areaOptions" :key="o.value" :value="o.value" class="text-black">
          {{ o.label }}
        </option>
      </select>
      <button class="text-xs hover:text-white" @click="load">Refresh</button>
      <button
        class="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
        @click="close"
      >
        <X :size="13" /> Close
      </button>
    </div>

    <!-- Selected node panel -->
    <div
      v-if="selected"
      class="absolute bottom-3 right-3 w-64 bg-black/50 backdrop-blur px-4 py-3 rounded-btn border border-white/10"
    >
      <div class="font-semibold">{{ selected.label }}</div>
      <div class="text-xs text-slate-400">/{{ selected.slug }}</div>
      <div class="text-xs mt-2 space-y-0.5">
        <div>Status: {{ selected.status }}</div>
        <div v-if="selected.productArea">Area: {{ PRODUCT_AREA_LABELS[selected.productArea] }}</div>
        <div v-if="selected.difficulty">Difficulty: {{ selected.difficulty }}</div>
      </div>
      <button
        class="mt-3 inline-flex items-center gap-1 text-xs text-info hover:underline"
        @click="openArticle(selected.id)"
      >
        Open article <ExternalLink :size="12" />
      </button>
    </div>

    <!-- Ask-the-graph chat: each answer lights up where the data came from -->
    <div
      class="absolute top-16 left-3 w-80 max-h-[72vh] flex flex-col bg-black/55 backdrop-blur rounded-btn border border-white/10"
    >
      <div class="px-3 py-2 border-b border-white/10 text-sm font-semibold">Ask the graph</div>
      <div class="px-3 py-2 overflow-y-auto text-xs space-y-2 flex-1 min-h-[2.5rem]">
        <div v-if="!chatReply && !chatLoading" class="text-slate-400">
          Ask a question — I'll answer and light up where it came from on the graph.
        </div>
        <div v-if="chatLoading" class="text-slate-400 animate-pulse">thinking…</div>
        <div
          v-if="chatReply"
          class="prose-body text-slate-100 leading-snug"
          v-html="renderMarkdown(chatReply)"
        />
        <div v-if="chatSources.length">
          <div class="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Came from</div>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="s in chatSources"
              :key="s.slug"
              class="text-[11px] bg-surface/10 hover:bg-surface/20 border border-white/15 rounded-full px-2 py-0.5 text-left"
              @click="spotlight(s.slug)"
            >
              {{ s.title }}
            </button>
          </div>
        </div>
      </div>
      <div class="p-2 border-t border-white/10 flex gap-2">
        <input
          v-model="chatInput"
          class="flex-1 bg-black/30 text-slate-200 text-xs border border-white/15 rounded px-2 py-1.5 outline-none placeholder:text-slate-500"
          placeholder="e.g. how do I add a logo?"
          @keydown.enter.prevent="sendChat"
        />
        <button
          class="text-xs bg-primary text-white rounded px-3 py-1.5 hover:bg-primary/90 disabled:opacity-50"
          :disabled="chatLoading"
          @click="sendChat"
        >
          Ask
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { graphApi } from '@/api/resources';
import { useToastStore } from '@/stores/toast';
import GraphView from '@/components/GraphView.vue';
import Select from '@/components/Select.vue';
import Button from '@/components/Button.vue';
import AutoLinkButton from '@/components/AutoLinkButton.vue';
import { Maximize, ArrowRight } from 'lucide-vue-next';
import { PRODUCT_AREA_LABELS, type GraphNode, type GraphResponse } from '@kb/shared';
import { ApiError } from '@/api/client';

const router = useRouter();
const toast = useToastStore();

const data = ref<GraphResponse>({ nodes: [], edges: [] });
const loading = ref(true);
const error = ref<string | null>(null);
const highlightArea = ref<string | null>(null);
const selected = ref<GraphNode | null>(null);

const areaOptions = Object.entries(PRODUCT_AREA_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const fullHref = router.resolve('/graph/full').href;
function openFull() {
  window.open(fullHref, '_blank', 'noopener');
}

onMounted(load);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    data.value = await graphApi.fetch();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load graph';
    toast.error(error.value);
  } finally {
    loading.value = false;
  }
}

function onSelectNode(node: GraphNode) {
  selected.value = node;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <h1 class="text-2xl font-semibold">Knowledge graph</h1>
      <div class="flex gap-2 items-end">
        <Select
          :model-value="highlightArea"
          placeholder="Highlight area…"
          :options="areaOptions"
          @update:model-value="(v) => (highlightArea = v)"
        />
        <AutoLinkButton @applied="load" />
        <Button variant="ghost" size="sm" @click="openFull">
          <Maximize :size="14" class="mr-1.5" />Full screen
        </Button>
        <Button variant="ghost" size="sm" @click="load">Refresh</Button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="card h-[640px] animate-pulse" />

    <div v-else class="grid lg:grid-cols-[1fr_320px] gap-4">
      <GraphView :data="data" :highlight-area="highlightArea" @select-node="onSelectNode" />

      <aside class="card h-[640px] overflow-auto">
        <div v-if="!selected" class="text-text/60 text-sm">
          Click a node to view article details.
        </div>
        <div v-else>
          <h3 class="font-semibold text-lg">{{ selected.label }}</h3>
          <div class="text-xs text-text/60 mt-1">/{{ selected.slug }}</div>
          <dl class="mt-3 text-sm space-y-2">
            <div>
              <dt class="text-text/60">Status</dt>
              <dd>{{ selected.status }}</dd>
            </div>
            <div v-if="selected.productArea">
              <dt class="text-text/60">Product area</dt>
              <dd>{{ PRODUCT_AREA_LABELS[selected.productArea] }}</dd>
            </div>
            <div v-if="selected.difficulty">
              <dt class="text-text/60">Difficulty</dt>
              <dd>{{ selected.difficulty }}</dd>
            </div>
          </dl>
          <div class="mt-4">
            <Button size="sm" @click="router.push(`/articles/${selected.id}`)">
              Open article<ArrowRight :size="14" class="ml-1.5" />
            </Button>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

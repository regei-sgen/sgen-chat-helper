<script setup lang="ts">
import { ref, computed } from 'vue';
import { vectorLinkApi } from '@/api/resources';
import { useToastStore } from '@/stores/toast';
import Modal from './Modal.vue';
import Button from './Button.vue';
import { Waypoints } from 'lucide-vue-next';
import { ApiError } from '@/api/client';
import type { AutoLinkProposal } from '@kb/shared';

const emit = defineEmits<{ applied: [] }>();
const toast = useToastStore();

const open = ref(false);
const mode = ref<'choose' | 'preview'>('choose');
const loading = ref(false);
const applying = ref(false);
const proposals = ref<AutoLinkProposal[]>([]);
const articleCount = ref(0);

// This arranger only proposes RELATED links (embedding similarity can't infer prerequisite
// direction), so the meaningful preview is "which articles gain related connections".
const changed = computed(() => proposals.value.filter((p) => p.relatedTitles.length));

function openModal() {
  mode.value = 'choose';
  proposals.value = [];
  open.value = true;
}

async function doPreview() {
  loading.value = true;
  try {
    const res = await vectorLinkApi.preview();
    if (res.articleCount < 2) {
      toast.error('Need at least 2 articles to connect.');
      open.value = false;
      return;
    }
    proposals.value = res.proposals;
    articleCount.value = res.articleCount;
    mode.value = 'preview';
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Analysis failed');
  } finally {
    loading.value = false;
  }
}

// Apply always recomputes server-side (deterministic), so preview and apply agree and no client
// payload is trusted. It only ADDS related links — nothing is ever removed.
async function applyNow() {
  applying.value = true;
  try {
    const r = await vectorLinkApi.apply();
    toast.success(`Connected ${r.updated} articles by similarity`);
    open.value = false;
    emit('applied');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Apply failed');
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <span>
    <Button variant="ghost" size="sm" @click="openModal">
      <Waypoints :size="15" class="mr-1.5" />Connect by similarity
    </Button>

    <Modal :open="open" title="Connect by Similarity (no AI)" size="lg" @close="open = false">
      <!-- Choose how to apply -->
      <div v-if="mode === 'choose'" class="space-y-4 text-sm">
        <p>
          Connects articles using their existing <strong>embeddings</strong> — each article is linked
          to its closest matches by meaning. <strong>No AI call</strong>, no rate limits, works at any
          size, and it only <strong>adds</strong> Related links: existing prerequisites and links are
          never removed.
        </p>
        <div class="flex gap-2">
          <Button :loading="loading" @click="doPreview">Preview connections</Button>
          <Button variant="secondary" :loading="applying" @click="applyNow">Apply directly</Button>
        </div>
        <p class="text-xs text-text/60">
          <strong>Preview</strong> lets you review the connections before saving.
          <strong>Apply directly</strong> saves immediately. This complements the AI Link Arranger —
          it does not infer prerequisite direction, only relatedness.
        </p>
      </div>

      <!-- Review proposals -->
      <div v-else class="space-y-3 text-sm max-h-[55vh] overflow-auto">
        <p class="text-text/70">
          Proposed connections across {{ articleCount }} articles — added on top of existing links,
          nothing is removed.
        </p>
        <div v-for="p in changed" :key="p.id" class="border border-light rounded-btn p-3 space-y-1">
          <div class="font-medium">{{ p.title }}</div>
          <div>
            <span class="text-text/60">Related:</span>
            <span class="text-text">{{ p.relatedTitles.join(', ') }}</span>
          </div>
        </div>
        <p v-if="changed.length === 0" class="text-text/50">
          No similar articles found to connect.
        </p>
      </div>

      <template #footer>
        <template v-if="mode === 'preview'">
          <Button variant="ghost" size="sm" @click="open = false">Cancel</Button>
          <Button size="sm" :loading="applying" @click="applyNow">Apply these links</Button>
        </template>
        <template v-else>
          <Button variant="ghost" size="sm" @click="open = false">Close</Button>
        </template>
      </template>
    </Modal>
  </span>
</template>

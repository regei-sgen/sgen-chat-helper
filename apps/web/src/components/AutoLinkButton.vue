<script setup lang="ts">
import { ref, computed } from 'vue';
import { autoLinkApi } from '@/api/resources';
import { useToastStore } from '@/stores/toast';
import Modal from './Modal.vue';
import Button from './Button.vue';
import { Sparkles } from 'lucide-vue-next';
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

const changed = computed(() =>
  proposals.value.filter(
    (p) =>
      p.prerequisiteTitles.length ||
      p.relatedTitles.length ||
      p.currentPrerequisiteTitles.length ||
      p.currentRelatedTitles.length,
  ),
);

function openModal() {
  mode.value = 'choose';
  proposals.value = [];
  open.value = true;
}

async function doPreview() {
  loading.value = true;
  try {
    const res = await autoLinkApi.preview();
    if (res.articleCount < 2) {
      toast.error('Need at least 2 articles to arrange links.');
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

async function applyPreviewed() {
  applying.value = true;
  try {
    const r = await autoLinkApi.apply(
      proposals.value.map((p) => ({
        id: p.id,
        prerequisiteIds: p.prerequisiteIds,
        relatedIds: p.relatedIds,
      })),
    );
    toast.success(`Arranged links across ${r.updated} articles`);
    open.value = false;
    emit('applied');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Apply failed');
  } finally {
    applying.value = false;
  }
}

async function applyDirectly() {
  applying.value = true;
  try {
    const r = await autoLinkApi.apply();
    toast.success(`Arranged links across ${r.updated} articles`);
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
      <Sparkles :size="15" class="mr-1.5" />Auto-arrange links
    </Button>

    <Modal :open="open" title="AI Link Arranger" size="lg" @close="open = false">
      <!-- Choose how to apply -->
      <div v-if="mode === 'choose'" class="space-y-4 text-sm">
        <p>
          The AI reads all your articles and arranges their <strong>Prerequisites</strong> and
          <strong>Related</strong> links automatically — like auto-tagging for relationships.
          Existing links are <strong>replaced</strong> with the new arrangement.
        </p>
        <div class="flex gap-2">
          <Button :loading="loading" @click="doPreview">Preview changes</Button>
          <Button variant="secondary" :loading="applying" @click="applyDirectly">
            Apply directly
          </Button>
        </div>
        <p class="text-xs text-text/60">
          <strong>Preview</strong> lets you review the proposed links before saving.
          <strong>Apply directly</strong> saves immediately. (This uses your configured AI
          provider.)
        </p>
      </div>

      <!-- Review proposals -->
      <div v-else class="space-y-3 text-sm max-h-[55vh] overflow-auto">
        <p class="text-text/70">
          Proposed arrangement for {{ articleCount }} articles — review, then apply.
        </p>
        <div v-for="p in changed" :key="p.id" class="border border-light rounded-btn p-3 space-y-1">
          <div class="font-medium">{{ p.title }}</div>
          <div>
            <span class="text-text/60">Prerequisites:</span>
            <span v-if="p.prerequisiteTitles.length" class="text-text">
              {{ p.prerequisiteTitles.join(', ') }}
            </span>
            <span v-else class="text-text/40">none</span>
          </div>
          <div>
            <span class="text-text/60">Related:</span>
            <span v-if="p.relatedTitles.length" class="text-text">
              {{ p.relatedTitles.join(', ') }}
            </span>
            <span v-else class="text-text/40">none</span>
          </div>
        </div>
        <p v-if="changed.length === 0" class="text-text/50">
          The AI proposed no links for the current articles.
        </p>
      </div>

      <template #footer>
        <template v-if="mode === 'preview'">
          <Button variant="ghost" size="sm" @click="open = false">Cancel</Button>
          <Button size="sm" :loading="applying" @click="applyPreviewed">Apply these links</Button>
        </template>
        <template v-else>
          <Button variant="ghost" size="sm" @click="open = false">Close</Button>
        </template>
      </template>
    </Modal>
  </span>
</template>

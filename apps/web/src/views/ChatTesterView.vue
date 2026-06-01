<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { chatTesterApi } from '@/api/resources';
import { renderMarkdown } from '@/lib/markdown';
import Button from '@/components/Button.vue';
import { ExternalLink, Send } from 'lucide-vue-next';
import { ApiError } from '@/api/client';
import type { Walkthrough, WalkthroughStep } from '@kb/shared';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  sources?: { title: string; slug: string }[];
  links?: { label: string; url: string }[];
  followups?: { label: string; message: string }[];
  walkthrough?: Walkthrough | null;
  revealed?: number;
}

const messages = ref<Msg[]>([]);
const starters = ref<{ label: string; message: string }[]>([]);
const input = ref('');
const loading = ref(false);
const scrollEl = ref<HTMLElement | null>(null);

async function scrollDown() {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

onMounted(async () => {
  try {
    const s = await chatTesterApi.suggestions();
    messages.value.push({ role: 'assistant', content: s.welcome });
    starters.value = s.suggestions;
  } catch {
    /* ignore — tester still works without starters */
  }
});

async function send(text: string) {
  const message = text.trim();
  if (!message || loading.value) return;
  input.value = '';
  starters.value = [];
  messages.value.push({ role: 'user', content: message });
  await scrollDown();
  loading.value = true;
  try {
    const history = messages.value
      .filter((m) => m.content)
      .slice(-11, -1)
      .map((m) => ({ role: m.role, content: m.content }));
    const r = await chatTesterApi.send(message, history);
    messages.value.push({
      role: 'assistant',
      content: r.reply,
      sources: r.sources,
      links: r.links,
      followups: r.followups,
      walkthrough: r.walkthrough ?? null,
      revealed: r.walkthrough ? (r.walkthrough.focusStep ?? 1) : 0,
    });
  } catch (err) {
    messages.value.push({
      role: 'assistant',
      content: 'Sorry — ' + (err instanceof ApiError ? err.message : 'something went wrong.'),
    });
  } finally {
    loading.value = false;
    await scrollDown();
  }
}

// --- Interactive walkthrough helpers (client reveals one step at a time) ---
function shownSteps(m: Msg) {
  return m.walkthrough ? m.walkthrough.steps.slice(0, m.revealed ?? 0) : [];
}
function stepCount(m: Msg): number {
  return m.walkthrough?.steps.length ?? 0;
}
function tourDone(m: Msg): boolean {
  return !m.walkthrough || (m.revealed ?? 0) >= m.walkthrough.steps.length;
}
async function advance(m: Msg) {
  if (!m.walkthrough) return;
  if ((m.revealed ?? 0) < m.walkthrough.steps.length) m.revealed = (m.revealed ?? 0) + 1;
  await scrollDown();
}
// Show a topic header above the first step of each group, but only when the walkthrough
// actually combines more than one topic (a multi-topic / combination question).
function showGroupHeader(m: Msg, step: WalkthroughStep): boolean {
  if (!m.walkthrough || !step.group) return false;
  const groups = new Set(m.walkthrough.steps.map((s) => s.group).filter(Boolean));
  if (groups.size < 2) return false;
  return m.walkthrough.steps.find((s) => s.group === step.group)?.n === step.n;
}

function reset() {
  messages.value = [];
  starters.value = [];
  loading.value = false;
  // reload the welcome + starters
  chatTesterApi
    .suggestions()
    .then((s) => {
      messages.value.push({ role: 'assistant', content: s.welcome });
      starters.value = s.suggestions;
    })
    .catch(() => {});
}
</script>

<template>
  <div class="max-w-3xl mx-auto flex flex-col h-[calc(100vh-9.5rem)]">
    <div class="mb-3 flex items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Chat tester</h1>
        <p class="text-sm text-text/60">
          Talks to the same engine as the public <code>/api/v1/chat</code>. Test messages are not
          logged to analytics.
        </p>
      </div>
      <Button variant="ghost" size="sm" @click="reset">Reset</Button>
    </div>

    <div ref="scrollEl" class="card flex-1 overflow-y-auto space-y-4">
      <template v-for="(m, i) in messages" :key="i">
        <div v-if="m.role === 'user'" class="flex justify-end">
          <div class="bg-primary text-white rounded-card rounded-br-sm px-4 py-2 max-w-[80%] text-sm">
            {{ m.content }}
          </div>
        </div>

        <div v-else class="flex justify-start">
          <div class="bg-light/60 rounded-card rounded-bl-sm px-4 py-3 max-w-[88%] space-y-2">
            <div class="prose-body text-sm" v-html="renderMarkdown(m.content)" />

            <!-- Interactive walkthrough: reveal ONE step at a time, each with a Next button. -->
            <div v-if="m.walkthrough" class="space-y-2 pt-1">
              <template v-for="step in shownSteps(m)" :key="step.n">
                <p
                  v-if="showGroupHeader(m, step)"
                  class="text-[11px] font-semibold text-primary uppercase tracking-wide pt-1"
                >
                  {{ step.group }}
                </p>
                <div
                  class="rounded-card border bg-white px-3 py-2"
                  :class="step.highlight ? 'border-primary ring-1 ring-primary/30' : 'border-light'"
                >
                  <div class="flex items-start gap-2">
                    <span
                      class="flex-none w-5 h-5 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center mt-0.5"
                    >{{ step.n }}</span>
                    <div class="min-w-0">
                      <p class="text-sm font-semibold leading-snug">
                        {{ step.title }}
                        <span
                          v-if="step.highlight"
                          class="ml-1 align-middle text-[10px] font-semibold text-white bg-primary rounded-full px-1.5 py-0.5"
                        >most relevant</span>
                      </p>
                      <div class="prose-body text-sm text-text/80" v-html="renderMarkdown(step.body)" />
                      <img
                        v-if="step.imageUrl"
                        :src="step.imageUrl"
                        class="mt-2 rounded-btn border border-light max-h-48"
                        alt=""
                      />
                      <a
                        v-if="step.route"
                        :href="step.route"
                        target="_blank"
                        rel="noopener"
                        class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/40 rounded-full px-2 py-0.5 hover:bg-primary/5 transition-colors"
                        :title="'Open ' + step.route"
                      >
                        ↗ Open <span class="font-mono">{{ step.route }}</span>
                      </a>
                    </div>
                  </div>
                </div>
              </template>

              <div class="flex items-center gap-3 pt-0.5">
                <button
                  v-if="!tourDone(m)"
                  class="text-xs font-medium bg-primary text-white rounded-full px-4 py-1.5 hover:bg-primary/90 transition-colors"
                  @click="advance(m)"
                >
                  Next step →
                </button>
                <span v-else class="text-xs text-green-600 font-medium">
                  ✓ Done — all {{ stepCount(m) }} steps.
                </span>
                <span v-if="!tourDone(m)" class="text-[11px] text-text/50">
                  Step {{ m.revealed }} of {{ stepCount(m) }}
                </span>
              </div>
            </div>

            <div v-if="m.links?.length && tourDone(m)" class="flex flex-wrap gap-3 pt-1">
              <a
                v-for="(l, li) in m.links"
                :key="li"
                :href="l.url"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink :size="12" /> {{ l.label }}
              </a>
            </div>

            <div v-if="m.sources?.length && tourDone(m)" class="flex flex-wrap gap-1 pt-1">
              <span
                v-for="(s, si) in m.sources"
                :key="si"
                class="text-[10px] bg-white border border-light rounded-full px-2 py-0.5 text-text/60"
              >
                {{ s.title }}
              </span>
            </div>

            <div v-if="m.followups?.length && tourDone(m)" class="flex flex-wrap gap-2 pt-1">
              <button
                v-for="(f, fi) in m.followups"
                :key="fi"
                class="text-xs border border-primary/40 text-primary rounded-full px-3 py-1 hover:bg-primary/5 transition-colors"
                @click="send(f.message)"
              >
                {{ f.label }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <div v-if="starters.length" class="flex flex-wrap gap-2">
        <button
          v-for="(s, si) in starters"
          :key="si"
          class="text-sm border border-light rounded-btn px-3 py-1.5 hover:bg-light transition-colors"
          @click="send(s.message)"
        >
          {{ s.label }}
        </button>
      </div>

      <div v-if="loading" class="flex justify-start">
        <div class="bg-light/60 rounded-card px-4 py-2 text-sm text-text/50 animate-pulse">
          thinking…
        </div>
      </div>
    </div>

    <div class="mt-3 flex gap-2">
      <input
        v-model="input"
        class="input-base flex-1"
        placeholder="Ask about SGEN — e.g. how do I create a page?"
        @keydown.enter.prevent="send(input)"
      />
      <Button :loading="loading" @click="send(input)">
        <Send :size="15" class="mr-1.5" />Send
      </Button>
    </div>
  </div>
</template>

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
  // A combined ("multi-topic") question renders ONE stepper per topic. `groupActive[topic]` is the
  // active 1-based step within that topic's stepper; `seenEnd` latches when a single-topic
  // walkthrough is finished (multi-topic shows its trailing links immediately).
  groupActive?: Record<string, number>;
  seenEnd?: boolean;
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
      // One stepper per topic; a single-topic walkthrough jumps to the most-relevant step.
      groupActive: r.walkthrough ? initGroupActive(r.walkthrough) : undefined,
      seenEnd: r.walkthrough ? singleTopicStartsDone(r.walkthrough) : false,
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

// --- Per-topic steppers --------------------------------------------------------------------------
// A combined question ("create a page AND a blog AND upload an image") merges steps from several
// articles, each tagged with a `group` (topic). We render ONE stepper per topic, renumbered 1..k
// within that topic — never one continuous 1..N rail across unrelated topics (which is misleading).
interface StepGroup {
  key: string;
  label: string | null; // topic header — only shown when there's more than one topic
  steps: WalkthroughStep[];
}

function groupsOf(m: Msg): StepGroup[] {
  if (!m.walkthrough) return [];
  const order: string[] = [];
  const byKey = new Map<string, WalkthroughStep[]>();
  for (const s of m.walkthrough.steps) {
    const key = s.group ?? '';
    let arr = byKey.get(key);
    if (!arr) {
      arr = [];
      byKey.set(key, arr);
      order.push(key);
    }
    arr.push(s);
  }
  const multi = order.length >= 2;
  return order.map((key) => ({ key, label: multi ? key || null : null, steps: byKey.get(key) ?? [] }));
}

// Active 1-based step WITHIN a topic's stepper.
function groupActive(m: Msg, key: string): number {
  return m.groupActive?.[key] ?? 1;
}

// A topic backed by an admin page (any step carries a /sg-admin route → an "Open page" link) gets
// the interactive click-through stepper. An info-only topic with no page link isn't a navigable
// admin tour, so it's shown as a plain numbered list instead (clearer, not misleading).
function groupHasRoute(g: StepGroup): boolean {
  return g.steps.some((s) => !!s.route);
}

async function goToGroupStep(m: Msg, g: StepGroup, n: number) {
  if (!m.groupActive) m.groupActive = {};
  m.groupActive[g.key] = Math.min(Math.max(n, 1), g.steps.length);
  // Latch "finished" once every stepper topic has reached its last step (list topics are always
  // "done"). Gates the single-topic trailing content.
  if (groupsOf(m).every((gr) => !groupHasRoute(gr) || groupActive(m, gr.key) >= gr.steps.length))
    m.seenEnd = true;
  await scrollDown();
}

// Rail dot styling: completed = check, current = solid + ringed, upcoming = light outline.
function dotClass(active: number, n: number): string {
  if (n === active) return 'bg-primary text-white ring-2 ring-primary/40';
  if (n < active) return 'bg-primary/80 text-white';
  return 'bg-surface border border-light text-text/50 hover:border-primary/50';
}

// Multi-topic shows its trailing links/sources/follow-ups immediately (the steppers are independent);
// single-topic reveals them once the user has reached the end (latched via seenEnd).
function tourDone(m: Msg): boolean {
  if (!m.walkthrough) return true;
  const groups = groupsOf(m);
  if (groups.length >= 2) return true;
  const g = groups[0];
  // A single info-only topic renders as a plain list (everything shown) → done immediately.
  if (!g || !groupHasRoute(g)) return true;
  return !!m.seenEnd;
}

// Initial active step per topic. Single-topic jumps to focusStep (its within-group position); each
// topic of a multi-topic answer starts at step 1.
function initGroupActive(w: Walkthrough): Record<string, number> {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const s of w.steps) {
    const key = s.group ?? '';
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  const active: Record<string, number> = {};
  for (const key of order) active[key] = 1;
  if (order.length === 1 && w.focusStep) {
    const steps = w.steps.filter((s) => (s.group ?? '') === order[0]);
    const pos = steps.findIndex((s) => s.n === w.focusStep);
    if (pos >= 0) active[order[0]] = pos + 1;
  }
  return active;
}

function singleTopicStartsDone(w: Walkthrough): boolean {
  const groups = new Set(w.steps.map((s) => s.group ?? ''));
  if (groups.size >= 2) return false;
  return (w.focusStep ?? 1) >= w.steps.length;
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

            <!-- Multi-topic: one INDEPENDENT stepper per topic, each renumbered 1..k within itself. -->
            <div v-if="m.walkthrough" class="space-y-4 pt-1">
              <div v-for="g in groupsOf(m)" :key="g.key" class="space-y-2">
                <!-- topic header (only when the answer combines more than one topic) -->
                <p
                  v-if="g.label"
                  class="text-[11px] font-semibold text-primary uppercase tracking-wide"
                >
                  {{ g.label }}
                </p>

                <!-- Topics tied to an admin page get the click-through stepper; info-only topics
                     (no "Open page" link) render as a plain numbered list (see v-else below). -->
                <template v-if="groupHasRoute(g)">
                <!-- per-topic progress rail (numbered 1..k within this topic). Wraps onto multiple
                     rows when a topic has many steps — never a horizontal scrollbar. -->
                <div class="flex flex-wrap items-center gap-y-1 pb-1">
                  <template v-for="(s, idx) in g.steps" :key="s.n">
                    <span
                      v-if="idx > 0"
                      class="h-0.5 w-4 flex-none"
                      :class="idx + 1 <= groupActive(m, g.key) ? 'bg-primary' : 'bg-light'"
                    />
                    <button
                      type="button"
                      class="flex-none w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-colors"
                      :class="dotClass(groupActive(m, g.key), idx + 1)"
                      :title="s.title"
                      @click="goToGroupStep(m, g, idx + 1)"
                    >
                      <span v-if="idx + 1 < groupActive(m, g.key)">✓</span>
                      <span v-else>{{ idx + 1 }}</span>
                    </button>
                  </template>
                  <span class="ml-3 flex-none text-[11px] text-text/50 whitespace-nowrap">
                    Step {{ groupActive(m, g.key) }} of {{ g.steps.length }}
                  </span>
                </div>

                <!-- active step content for this topic -->
                <template v-for="(s, idx) in g.steps" :key="'c' + s.n">
                  <div
                    v-if="idx + 1 === groupActive(m, g.key)"
                    class="rounded-card border bg-surface px-3 py-2"
                    :class="s.highlight ? 'border-primary ring-1 ring-primary/30' : 'border-light'"
                  >
                    <div class="flex items-start gap-2">
                      <span
                        class="flex-none w-5 h-5 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center mt-0.5"
                      >{{ idx + 1 }}</span>
                      <div class="min-w-0">
                        <p class="text-sm font-semibold leading-snug">
                          {{ s.title }}
                          <span
                            v-if="s.highlight"
                            class="ml-1 align-middle text-[10px] font-semibold text-white bg-primary rounded-full px-1.5 py-0.5"
                          >most relevant</span>
                        </p>
                        <div class="prose-body text-sm text-text/80" v-html="renderMarkdown(s.body)" />
                        <img
                          v-if="s.imageUrl"
                          :src="s.imageUrl"
                          class="mt-2 rounded-btn border border-light max-h-48"
                          alt=""
                        />
                        <a
                          v-if="s.route"
                          :href="s.route"
                          target="_blank"
                          rel="noopener"
                          class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/40 rounded-full px-2 py-0.5 hover:bg-primary/5 transition-colors"
                          :title="'Open ' + s.route"
                        >
                          ↗ Open page
                        </a>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- per-topic Back / Next -->
                <div class="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    class="text-xs font-medium border border-light rounded-full px-3 py-1.5 transition-colors hover:bg-light disabled:opacity-40 disabled:cursor-not-allowed"
                    :disabled="groupActive(m, g.key) <= 1"
                    @click="goToGroupStep(m, g, groupActive(m, g.key) - 1)"
                  >
                    ← Back
                  </button>
                  <button
                    v-if="groupActive(m, g.key) < g.steps.length"
                    type="button"
                    class="text-xs font-medium bg-primary text-white rounded-full px-4 py-1.5 hover:bg-primary/90 transition-colors"
                    @click="goToGroupStep(m, g, groupActive(m, g.key) + 1)"
                  >
                    Next →
                  </button>
                  <span v-else class="text-xs text-green-600 font-medium">
                    ✓ All {{ g.steps.length }} steps.
                  </span>
                </div>
                </template>

                <!-- Info-only topic (no admin page link): show every step at once as a plain
                     numbered list — no progress rail, no Back/Next. -->
                <template v-else>
                  <div
                    v-for="(s, idx) in g.steps"
                    :key="'l' + s.n"
                    class="rounded-card border bg-surface px-3 py-2"
                    :class="s.highlight ? 'border-primary ring-1 ring-primary/30' : 'border-light'"
                  >
                    <div class="flex items-start gap-2">
                      <span
                        class="flex-none w-5 h-5 rounded-full bg-primary text-white text-[11px] font-semibold flex items-center justify-center mt-0.5"
                      >{{ idx + 1 }}</span>
                      <div class="min-w-0">
                        <p class="text-sm font-semibold leading-snug">
                          {{ s.title }}
                          <span
                            v-if="s.highlight"
                            class="ml-1 align-middle text-[10px] font-semibold text-white bg-primary rounded-full px-1.5 py-0.5"
                          >most relevant</span>
                        </p>
                        <div class="prose-body text-sm text-text/80" v-html="renderMarkdown(s.body)" />
                        <img
                          v-if="s.imageUrl"
                          :src="s.imageUrl"
                          class="mt-2 rounded-btn border border-light max-h-48"
                          alt=""
                        />
                        <a
                          v-if="s.route"
                          :href="s.route"
                          target="_blank"
                          rel="noopener"
                          class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/40 rounded-full px-2 py-0.5 hover:bg-primary/5 transition-colors"
                          :title="'Open ' + s.route"
                        >
                          ↗ Open page
                        </a>
                      </div>
                    </div>
                  </div>
                </template>
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
                class="text-[10px] bg-surface border border-light rounded-full px-2 py-0.5 text-text/60"
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

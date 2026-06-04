<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { chatTesterApi } from '@/api/resources';
import { renderMarkdown } from '@/lib/markdown';
import Button from '@/components/Button.vue';
import { ExternalLink, Send, Sparkles, User, Loader2 } from 'lucide-vue-next';
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

// "See more" expansion for the non-clickable source pills, keyed by message index.
const SOURCES_LIMIT = 3;
const expandedSources = ref<Record<number, boolean>>({});

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

// Steps imported from KB cards carry the same single sentence in both title and body, so when
// they match we render just the (markdown-formatted) body line and skip the duplicate title.
function sameTitleBody(s: WalkthroughStep): boolean {
  return (s.title ?? '').trim() === (s.body ?? '').trim();
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
  expandedSources.value = {};
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
    <!-- header -->
    <div class="flex items-start justify-between gap-3 pb-3">
      <div>
        <h1 class="text-2xl font-semibold flex items-center gap-2.5">
          <span class="status-dot inline-block w-2 h-2 rounded-full bg-success" />
          Chat tester
        </h1>
        <p class="text-sm text-text/55 mt-0.5">
          Talks to the same engine as the public <code>/api/v1/chat</code>. Test messages aren’t
          logged to analytics.
        </p>
      </div>
      <Button variant="ghost" size="sm" @click="reset">Reset</Button>
    </div>

    <!-- conversation -->
    <div
      ref="scrollEl"
      class="convo flex-1 overflow-y-auto rounded-card border border-light/70 shadow-card px-4 sm:px-5 py-5 space-y-5"
    >
      <template v-for="(m, i) in messages" :key="i">
        <!-- user · gradient bubble + neutral avatar -->
        <div v-if="m.role === 'user'" class="chat-row flex justify-end items-end gap-2.5">
          <div class="bubble-me max-w-[78%] text-white text-sm leading-relaxed px-3.5 py-2.5">
            {{ m.content }}
          </div>
          <span
            class="av-me flex-none w-[30px] h-[30px] rounded-full grid place-items-center text-text/55"
          >
            <User :size="15" />
          </span>
        </div>

        <!-- assistant · branded avatar + elevated bubble -->
        <div v-else class="chat-row flex items-start gap-2.5">
          <span
            class="av-bot flex-none w-[30px] h-[30px] rounded-full grid place-items-center text-white"
          >
            <Sparkles :size="15" />
          </span>
          <div
            class="bubble-bot min-w-0 max-w-[86%] bg-surface border border-light/80 px-3.5 py-3 space-y-2.5"
          >
            <div class="bot-name">Assistant</div>
            <div class="prose-body text-sm" v-html="renderMarkdown(m.content)" />

            <!-- Multi-topic: one INDEPENDENT stepper per topic, each renumbered 1..k within itself. -->
            <div v-if="m.walkthrough" class="space-y-4 pt-0.5">
              <div v-for="g in groupsOf(m)" :key="g.key" class="space-y-2.5">
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
                  <div class="flex flex-wrap items-center gap-y-1">
                    <template v-for="(s, idx) in g.steps" :key="s.n">
                      <span
                        v-if="idx > 0"
                        class="h-0.5 w-4 flex-none rounded-full"
                        :class="idx + 1 <= groupActive(m, g.key) ? 'bg-primary' : 'bg-light'"
                      />
                      <button
                        type="button"
                        class="rail-dot flex-none w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center transition-all"
                        :class="dotClass(groupActive(m, g.key), idx + 1)"
                        :title="s.title"
                        @click="goToGroupStep(m, g, idx + 1)"
                      >
                        <span v-if="idx + 1 < groupActive(m, g.key)">✓</span>
                        <span v-else>{{ idx + 1 }}</span>
                      </button>
                    </template>
                    <span class="ml-3 flex-none text-[11px] text-text/45 whitespace-nowrap">
                      Step {{ groupActive(m, g.key) }} of {{ g.steps.length }}
                    </span>
                  </div>

                  <!-- active step content for this topic -->
                  <template v-for="(s, idx) in g.steps" :key="'c' + s.n">
                    <div
                      v-if="idx + 1 === groupActive(m, g.key)"
                      class="step-card rounded-lg border px-3 py-2.5"
                      :class="s.highlight ? 'step-hi border-primary/55' : 'border-light'"
                    >
                      <div class="flex items-start gap-2.5">
                        <span
                          class="step-num flex-none w-[22px] h-[22px] rounded-full text-white text-[11px] font-semibold flex items-center justify-center mt-0.5"
                          >{{ idx + 1 }}</span
                        >
                        <div class="min-w-0 flex-1">
                          <p
                            v-if="!sameTitleBody(s) || s.highlight"
                            class="text-sm font-semibold leading-snug"
                          >
                            <template v-if="!sameTitleBody(s)">{{ s.title }}</template>
                            <span
                              v-if="s.highlight"
                              class="ml-1 align-middle text-[10px] font-semibold text-white bg-primary rounded-full px-1.5 py-0.5"
                              >most relevant</span
                            >
                          </p>
                          <div
                            class="prose-body text-sm"
                            :class="sameTitleBody(s) ? 'font-medium' : 'text-text/80'"
                            v-html="renderMarkdown(s.body)"
                          />
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
                            class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/40 rounded-full px-2.5 py-1 hover:bg-primary/5 transition-colors"
                            :title="'Open ' + s.route"
                          >
                            <ExternalLink :size="11" /> Open page
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
                      ‹ Back
                    </button>
                    <button
                      v-if="groupActive(m, g.key) < g.steps.length"
                      type="button"
                      class="btn-next text-xs font-semibold text-white rounded-full px-4 py-1.5 transition-transform hover:brightness-105 active:scale-95"
                      @click="goToGroupStep(m, g, groupActive(m, g.key) + 1)"
                    >
                      Next ›
                    </button>
                    <span v-else class="inline-flex items-center gap-1 text-xs text-success font-medium">
                      ✓ All {{ g.steps.length }} steps
                    </span>
                  </div>
                </template>

                <!-- Info-only topic (no admin page link): show every step at once as a plain
                     numbered list — no progress rail, no Back/Next. -->
                <template v-else>
                  <div
                    v-for="(s, idx) in g.steps"
                    :key="'l' + s.n"
                    class="step-card rounded-lg border px-3 py-2.5"
                    :class="s.highlight ? 'step-hi border-primary/55' : 'border-light'"
                  >
                    <div class="flex items-start gap-2.5">
                      <span
                        class="step-num flex-none w-[22px] h-[22px] rounded-full text-white text-[11px] font-semibold flex items-center justify-center mt-0.5"
                        >{{ idx + 1 }}</span
                      >
                      <div class="min-w-0 flex-1">
                        <p
                          v-if="!sameTitleBody(s) || s.highlight"
                          class="text-sm font-semibold leading-snug"
                        >
                          <template v-if="!sameTitleBody(s)">{{ s.title }}</template>
                          <span
                            v-if="s.highlight"
                            class="ml-1 align-middle text-[10px] font-semibold text-white bg-primary rounded-full px-1.5 py-0.5"
                            >most relevant</span
                          >
                        </p>
                        <div
                          class="prose-body text-sm"
                          :class="sameTitleBody(s) ? 'font-medium' : 'text-text/80'"
                          v-html="renderMarkdown(s.body)"
                        />
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
                          class="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/40 rounded-full px-2.5 py-1 hover:bg-primary/5 transition-colors"
                          :title="'Open ' + s.route"
                        >
                          <ExternalLink :size="11" /> Open page
                        </a>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
              <!-- extra article content (e.g. "### Get more from SGEN") — rendered AFTER the steps -->
              <div
                v-if="m.walkthrough?.footer"
                class="prose-body text-sm pt-2 mt-1 border-t border-light/60"
                v-html="renderMarkdown(m.walkthrough?.footer ?? '')"
              />
            </div>

            <!-- trailing links (clickable sources → solid red chips) -->
            <div v-if="m.links?.length && tourDone(m)" class="flex flex-wrap gap-2 pt-0.5">
              <a
                v-for="(l, li) in m.links"
                :key="li"
                :href="l.url"
                target="_blank"
                rel="noopener"
                class="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-primary hover:bg-primary-hover rounded-full px-3 py-1 transition-colors"
              >
                <ExternalLink :size="12" /> {{ l.label }}
              </a>
            </div>

            <!-- sources (non-clickable; collapsed to a few with a "see more" toggle) -->
            <div
              v-if="m.sources?.length && tourDone(m)"
              class="flex flex-wrap items-center gap-1.5 pt-0.5"
            >
              <span class="text-[10px] uppercase tracking-wide text-text/35">Sources</span>
              <span
                v-for="(s, si) in (expandedSources[i] ? m.sources : (m.sources ?? []).slice(0, SOURCES_LIMIT))"
                :key="si"
                class="text-[10px] bg-light/55 border border-light rounded-full px-2 py-0.5 text-text/55"
              >
                {{ s.title }}
              </span>
              <button
                v-if="(m.sources?.length ?? 0) > SOURCES_LIMIT"
                type="button"
                class="text-[10px] font-medium text-primary hover:underline"
                @click="expandedSources[i] = !expandedSources[i]"
              >
                {{ expandedSources[i] ? 'show less' : `+${(m.sources?.length ?? 0) - SOURCES_LIMIT} more` }}
              </button>
            </div>

            <!-- follow-ups -->
            <div v-if="m.followups?.length && tourDone(m)" class="flex flex-wrap gap-2 pt-1">
              <button
                v-for="(f, fi) in m.followups"
                :key="fi"
                class="text-xs font-medium border border-primary/40 text-primary bg-primary/5 rounded-full px-3 py-1 hover:bg-primary/10 transition-colors"
                @click="send(f.message)"
              >
                {{ f.label }}
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- starter chips (aligned under the assistant bubble) -->
      <div v-if="starters.length" class="chat-row pl-[40px] space-y-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-text/40">Try asking</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="(s, si) in starters"
            :key="si"
            class="text-sm font-medium border border-light rounded-full px-3.5 py-1.5 text-text/75 bg-surface shadow-sm hover:border-primary/50 hover:text-primary transition-colors"
            @click="send(s.message)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <!-- typing indicator -->
      <div v-if="loading" class="chat-row flex items-end gap-2.5">
        <span
          class="av-bot flex-none w-[30px] h-[30px] rounded-full grid place-items-center text-white"
        >
          <Sparkles :size="15" />
        </span>
        <div class="bubble-bot bg-surface border border-light/80 px-4 py-3">
          <div class="typing flex items-center gap-1.5" aria-label="Assistant is typing">
            <span /><span /><span />
          </div>
        </div>
      </div>
    </div>

    <!-- composer -->
    <div class="mt-3 flex items-center gap-2.5">
      <input
        v-model="input"
        class="input-base flex-1 rounded-full px-5"
        placeholder="Ask about SGEN — e.g. how do I create a page?"
        @keydown.enter.prevent="send(input)"
      />
      <button
        class="send inline-flex items-center gap-2 text-white font-semibold rounded-full px-5 py-2.5 transition-transform hover:brightness-105 active:scale-95 disabled:opacity-60 disabled:pointer-events-none"
        :disabled="loading"
        @click="send(input)"
      >
        <Loader2 v-if="loading" :size="16" class="animate-spin" />
        <Send v-else :size="15" />
        Send
      </button>
    </div>
  </div>
</template>

<style scoped>
.status-dot {
  box-shadow: 0 0 0 3px rgb(87 211 103 / 0.18);
}

/* faint brand wash at the top of the conversation panel, over the theme surface */
.convo {
  background:
    radial-gradient(120% 55% at 50% 0%, rgb(213 21 34 / 0.05), transparent 60%),
    rgb(var(--c-surface));
}

/* avatars */
.av-bot {
  background: linear-gradient(140deg, #e61938, #d51522);
  box-shadow: 0 4px 12px -2px rgb(213 21 34 / 0.5);
}
.av-me {
  background: rgb(var(--c-light));
}

/* bubbles — tails via asymmetric corners; soft depth shadows */
.bubble-bot {
  border-radius: 16px 16px 16px 5px;
  box-shadow:
    0 4px 16px -6px rgb(16 24 40 / 0.14),
    0 1px 2px rgb(16 24 40 / 0.05);
}
.bubble-me {
  background: linear-gradient(135deg, #e61938, #d51522);
  border-radius: 16px 16px 5px 16px;
  box-shadow: 0 8px 20px -6px rgb(213 21 34 / 0.5);
}
.bot-name {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(213 21 34 / 0.9);
}

/* steps — layered fill (body colour nested inside the surface bubble) */
.step-card {
  background: rgb(var(--c-body));
}
.step-hi {
  box-shadow: 0 0 0 3px rgb(213 21 34 / 0.1);
}
.step-num {
  background: linear-gradient(140deg, #e61938, #d51522);
}

/* gradient brand actions */
.btn-next,
.send {
  background: linear-gradient(135deg, #e61938, #d51522);
}
.btn-next {
  box-shadow: 0 6px 14px -4px rgb(213 21 34 / 0.5);
}
.send {
  box-shadow: 0 8px 18px -5px rgb(213 21 34 / 0.55);
}

/* gentle entrance for each new turn (runs once on insert) */
.chat-row {
  animation: chat-in 0.28s ease-out both;
}
@keyframes chat-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* animated typing dots — themed via the global --c-text token (tracks light/dark) */
.typing span {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: rgb(var(--c-text) / 0.35);
  animation: typing-bounce 1.2s ease-in-out infinite;
}
.typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-row,
  .typing span {
    animation: none;
  }
}
</style>

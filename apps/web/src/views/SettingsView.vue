<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { userApi, settingsApi } from '@/api/resources';
import Input from '@/components/Input.vue';
import Select from '@/components/Select.vue';
import Button from '@/components/Button.vue';
import { ApiError } from '@/api/client';
import type { SettingsStatus, SettingsUpdateInput } from '@kb/shared';

const auth = useAuthStore();
const toast = useToastStore();
const isSuperAdmin = computed(() => auth.user?.role === 'SUPER_ADMIN');

const tabs = computed(() => {
  const t = [
    { id: 'profile', label: 'Profile' },
    { id: 'password', label: 'Password' },
  ];
  if (isSuperAdmin.value) t.push({ id: 'ai', label: 'AI Providers' });
  return t;
});
const activeTab = ref('profile');

const name = ref(auth.user?.name ?? '');
const savingName = ref(false);

const currentPassword = ref('');
const newPassword = ref('');
const newPasswordConfirm = ref('');
const savingPassword = ref(false);

// ---- AI providers ----
const aiStatus = ref<SettingsStatus | null>(null);
const anthropicInput = ref('');
const openaiInput = ref('');
const geminiInput = ref('');
const structuringProvider = ref('anthropic');
const structuringModel = ref('');
const autolinkProvider = ref('claude-code');
const embeddingProvider = ref('local');
const savingAi = ref(false);
const testing = ref(false);
const reembedding = ref(false);

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  'claude-code': 'sonnet',
};

const structuringProviderOptions = [
  { value: 'anthropic', label: 'Claude (Anthropic)' },
  { value: 'openai', label: 'GPT (OpenAI)' },
  { value: 'gemini', label: 'Gemini (Google)' },
  { value: 'claude-code', label: 'Claude Code (local CLI — no API key)' },
];

function onStructuringProviderChange(v: string | null) {
  structuringProvider.value = v ?? 'anthropic';
  structuringModel.value = DEFAULT_MODELS[structuringProvider.value] ?? '';
}

async function loadAiStatus() {
  try {
    const s = await settingsApi.get();
    aiStatus.value = s;
    embeddingProvider.value = s.embeddingProvider;
    structuringProvider.value = s.structuringProvider;
    structuringModel.value = s.structuringModel;
    autolinkProvider.value = s.autolinkProvider;
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed to load AI settings');
  }
}

onMounted(() => {
  if (isSuperAdmin.value) loadAiStatus();
});

async function saveProfile() {
  savingName.value = true;
  try {
    const updated = await userApi.updateMe(name.value);
    if (auth.user) auth.user.name = updated.name;
    toast.success('Profile updated');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  } finally {
    savingName.value = false;
  }
}

async function changePassword() {
  if (newPassword.value !== newPasswordConfirm.value) {
    toast.error('Passwords do not match');
    return;
  }
  if (newPassword.value.length < 8) {
    toast.error('New password must be at least 8 characters');
    return;
  }
  savingPassword.value = true;
  try {
    await userApi.changePassword(currentPassword.value, newPassword.value);
    currentPassword.value = '';
    newPassword.value = '';
    newPasswordConfirm.value = '';
    toast.success('Password changed');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  } finally {
    savingPassword.value = false;
  }
}

async function saveAi() {
  savingAi.value = true;
  try {
    const body: SettingsUpdateInput = {
      structuringProvider: structuringProvider.value as SettingsUpdateInput['structuringProvider'],
      structuringModel: structuringModel.value.trim(),
      autolinkProvider: autolinkProvider.value as SettingsUpdateInput['autolinkProvider'],
      embeddingProvider: embeddingProvider.value as SettingsUpdateInput['embeddingProvider'],
    };
    if (anthropicInput.value.trim()) body.anthropicApiKey = anthropicInput.value.trim();
    if (openaiInput.value.trim()) body.openaiApiKey = openaiInput.value.trim();
    if (geminiInput.value.trim()) body.geminiApiKey = geminiInput.value.trim();
    aiStatus.value = await settingsApi.update(body);
    anthropicInput.value = '';
    openaiInput.value = '';
    geminiInput.value = '';
    embeddingProvider.value = aiStatus.value.embeddingProvider;
    structuringProvider.value = aiStatus.value.structuringProvider;
    structuringModel.value = aiStatus.value.structuringModel;
    autolinkProvider.value = aiStatus.value.autolinkProvider;
    toast.success('AI provider settings saved');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed to save');
  } finally {
    savingAi.value = false;
  }
}

async function clearKey(which: 'anthropic' | 'openai' | 'gemini') {
  try {
    const body: SettingsUpdateInput =
      which === 'anthropic'
        ? { anthropicApiKey: '' }
        : which === 'openai'
          ? { openaiApiKey: '' }
          : { geminiApiKey: '' };
    aiStatus.value = await settingsApi.update(body);
    toast.success('Key removed');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  }
}

async function testKeys() {
  testing.value = true;
  try {
    const r = await settingsApi.test();
    const parts: string[] = [];
    if (r.anthropic) parts.push(`Claude: ${r.anthropic.ok ? 'OK' : r.anthropic.message}`);
    if (r.openai) parts.push(`OpenAI: ${r.openai.ok ? 'OK' : r.openai.message}`);
    if (r.gemini) parts.push(`Gemini: ${r.gemini.ok ? 'OK' : r.gemini.message}`);
    if (r.claudeCode) parts.push(`Claude Code: ${r.claudeCode.ok ? 'OK' : r.claudeCode.message}`);
    if (parts.length === 0) {
      toast.error('No keys configured to test');
      return;
    }
    const allOk =
      (!r.anthropic || r.anthropic.ok) &&
      (!r.openai || r.openai.ok) &&
      (!r.gemini || r.gemini.ok) &&
      (!r.claudeCode || r.claudeCode.ok);
    if (allOk) toast.success(parts.join(' · '));
    else toast.error(parts.join(' · '));
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Test failed');
  } finally {
    testing.value = false;
  }
}

async function reembed() {
  reembedding.value = true;
  try {
    const r = await settingsApi.reembed();
    toast.success(
      `Re-embedded ${r.reembedded} article(s) with ${r.model}` +
        (r.failed ? ` · ${r.failed} failed` : ''),
    );
    await loadAiStatus();
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Re-embed failed');
  } finally {
    reembedding.value = false;
  }
}
</script>

<template>
  <div class="max-w-xl space-y-4">
    <h1 class="text-2xl font-semibold">Settings</h1>

    <div class="flex gap-1 border-b border-light">
      <button
        v-for="t in tabs"
        :key="t.id"
        class="px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors"
        :class="
          activeTab === t.id
            ? 'border-primary text-primary'
            : 'border-transparent text-text/60 hover:text-text'
        "
        @click="activeTab = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Profile -->
    <section v-show="activeTab === 'profile'" class="card space-y-3">
      <h2 class="font-semibold">Profile</h2>
      <div class="text-sm text-text/60">
        Email: <span class="text-text">{{ auth.user?.email }}</span> · Role:
        <span class="text-text">{{ auth.user?.role }}</span>
      </div>
      <Input v-model="name" label="Display name" placeholder="Your name" />
      <div class="flex justify-end">
        <Button :loading="savingName" size="sm" @click="saveProfile">Save</Button>
      </div>
    </section>

    <!-- Password -->
    <section v-show="activeTab === 'password'" class="card space-y-3">
      <h2 class="font-semibold">Change password</h2>
      <Input
        v-model="currentPassword"
        label="Current password"
        type="password"
        autocomplete="current-password"
      />
      <Input
        v-model="newPassword"
        label="New password"
        type="password"
        autocomplete="new-password"
        hint="At least 8 characters"
      />
      <Input
        v-model="newPasswordConfirm"
        label="Confirm new password"
        type="password"
        autocomplete="new-password"
      />
      <div class="flex justify-end">
        <Button :loading="savingPassword" size="sm" @click="changePassword">
          Update password
        </Button>
      </div>
    </section>

    <!-- AI Providers -->
    <section v-if="isSuperAdmin" v-show="activeTab === 'ai'" class="card space-y-5">
      <div>
        <h2 class="font-semibold">AI Providers</h2>
        <p class="text-sm text-text/60">
          Add the API keys you have, then choose which provider does each job. Keys are stored
          encrypted.
        </p>
      </div>

      <!-- Keys -->
      <div class="space-y-3">
        <div class="text-sm font-medium">API keys</div>
        <div class="space-y-1">
          <Input
            v-model="anthropicInput"
            label="Anthropic (Claude)"
            type="password"
            placeholder="sk-ant-..."
            autocomplete="off"
            :hint="
              aiStatus?.anthropic.configured
                ? `Configured (${aiStatus.anthropic.hint}) — leave blank to keep`
                : 'console.anthropic.com'
            "
          />
          <div v-if="aiStatus?.anthropic.configured" class="text-right">
            <button class="text-xs text-danger hover:underline" @click="clearKey('anthropic')">
              Remove
            </button>
          </div>
        </div>
        <div class="space-y-1">
          <Input
            v-model="openaiInput"
            label="OpenAI (GPT + embeddings)"
            type="password"
            placeholder="sk-..."
            autocomplete="off"
            :hint="
              aiStatus?.openai.configured
                ? `Configured (${aiStatus.openai.hint}) — leave blank to keep`
                : 'platform.openai.com'
            "
          />
          <div v-if="aiStatus?.openai.configured" class="text-right">
            <button class="text-xs text-danger hover:underline" @click="clearKey('openai')">
              Remove
            </button>
          </div>
        </div>
        <div class="space-y-1">
          <Input
            v-model="geminiInput"
            label="Gemini (Google)"
            type="password"
            placeholder="AIza..."
            autocomplete="off"
            :hint="
              aiStatus?.gemini.configured
                ? `Configured (${aiStatus.gemini.hint}) — leave blank to keep`
                : 'aistudio.google.com/apikey'
            "
          />
          <div v-if="aiStatus?.gemini.configured" class="text-right">
            <button class="text-xs text-danger hover:underline" @click="clearKey('gemini')">
              Remove
            </button>
          </div>
        </div>
      </div>

      <!-- Active chat AI -->
      <div class="space-y-2 border-t border-light pt-4">
        <div class="text-sm font-medium">Chat assistant AI</div>
        <p class="text-xs text-text/60">
          Which AI answers questions in the chat (retrieval rerank + composing the reply). Pick the
          active provider here.
        </p>
        <Select
          :model-value="structuringProvider"
          :options="structuringProviderOptions"
          label="Provider"
          @update:model-value="onStructuringProviderChange"
        />
        <Input
          v-model="structuringModel"
          label="Model"
          placeholder="Default model"
          hint="Default for the selected provider — change only if you need a specific model."
        />
        <p v-if="structuringProvider === 'claude-code'" class="text-xs text-text/60">
          Uses your locally-installed <strong>Claude Code</strong> — no API key and no free-tier
          rate limits. Model accepts <code>sonnet</code>, <code>opus</code>, or <code>haiku</code>.
          Runs only on this machine (where Claude Code is installed &amp; signed in); it won't work
          on a remote deployment.
        </p>
        <p class="text-xs text-text/60">
          <strong>Uploads</strong> always use your local <strong>Claude Code</strong> to structure
          articles — no API key needed, and this selector does not change it.
        </p>
      </div>

      <!-- Link Arranger AI -->
      <div class="space-y-2 border-t border-light pt-4">
        <div class="text-sm font-medium">Link Arranger AI</div>
        <p class="text-xs text-text/60">
          Which AI the knowledge-graph <strong>Link Arranger</strong> uses to organize article
          <strong>Prerequisites</strong> &amp; <strong>Related</strong> links. Defaults to local
          <strong>Claude Code</strong> — no API key and no free-tier rate limits — but you can point
          it at another provider here.
        </p>
        <Select
          :model-value="autolinkProvider"
          :options="structuringProviderOptions"
          label="Provider"
          @update:model-value="(v) => (autolinkProvider = v ?? 'claude-code')"
        />
        <p v-if="autolinkProvider === 'claude-code'" class="text-xs text-text/60">
          Runs only on this machine (where Claude Code is installed &amp; signed in); it won't work
          on a remote deployment.
        </p>
      </div>

      <!-- Embeddings -->
      <div class="space-y-2 border-t border-light pt-4">
        <div class="text-sm font-medium">Embeddings (search)</div>
        <p class="text-xs text-text/60">
          Embeddings always run <strong>locally</strong> (MiniLM · 384-dim) — no API key and no
          rate limits, so uploads never fail on a provider quota. If articles below show as needing
          it, click <strong>Re-embed all</strong>.
        </p>
      </div>

      <div class="flex justify-end gap-2 border-t border-light pt-4">
        <Button variant="secondary" size="sm" :loading="testing" @click="testKeys">
          Test keys
        </Button>
        <Button :loading="savingAi" size="sm" @click="saveAi">Save</Button>
      </div>

      <!-- Status -->
      <div v-if="aiStatus" class="rounded-btn bg-light p-3 text-sm space-y-2">
        <div class="text-text/70">
          Chat AI:
          <span class="text-text font-medium">{{ aiStatus.structuringProvider }}</span>
          ({{ aiStatus.structuringModel }})
        </div>
        <div class="text-text/70">
          Link Arranger:
          <span class="text-text font-medium">{{ aiStatus.autolinkProvider }}</span>
          ({{ aiStatus.autolinkModel }})
        </div>
        <div class="text-text/70">
          Uploads: <span class="text-text font-medium">claude-code</span> (local, always)
        </div>
        <div class="text-text/70">
          Embeddings:
          <span class="text-text font-medium">{{ aiStatus.embeddingProvider }}</span>
          ({{ aiStatus.activeEmbeddingModel }})
        </div>
        <div class="text-text/70">
          {{ aiStatus.embeddings.matchingActive }} / {{ aiStatus.embeddings.total }} articles
          embedded with the active model.
        </div>
        <div
          v-if="aiStatus.embeddings.needsReembed > 0"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-danger">
            {{ aiStatus.embeddings.needsReembed }} article(s) need re-embedding.
          </span>
          <Button size="sm" :loading="reembedding" @click="reembed">Re-embed all</Button>
        </div>
        <div v-else class="flex items-center justify-between gap-3">
          <span class="text-text/60">All articles are embedded with the active model.</span>
          <Button variant="secondary" size="sm" :loading="reembedding" @click="reembed">
            Re-embed all
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>

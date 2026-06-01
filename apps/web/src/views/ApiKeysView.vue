<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { ApiKey } from '@kb/shared';
import { apiKeyApi } from '@/api/resources';
import { useToastStore } from '@/stores/toast';
import Input from '@/components/Input.vue';
import Button from '@/components/Button.vue';
import Modal from '@/components/Modal.vue';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/api/client';

const toast = useToastStore();

const keys = ref<ApiKey[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const newName = ref('');
const creating = ref(false);
const revealedPlaintext = ref<string | null>(null);
const revealedName = ref<string | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    keys.value = await apiKeyApi.list();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed';
  } finally {
    loading.value = false;
  }
}

async function createKey() {
  if (!newName.value.trim()) return;
  creating.value = true;
  try {
    const created = await apiKeyApi.create(newName.value.trim());
    revealedPlaintext.value = created.plaintext;
    revealedName.value = created.name;
    keys.value = [
      {
        id: created.id,
        name: created.name,
        prefix: created.prefix,
        lastUsedAt: created.lastUsedAt,
        createdAt: created.createdAt,
        revokedAt: created.revokedAt,
      },
      ...keys.value,
    ];
    newName.value = '';
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not create key');
  } finally {
    creating.value = false;
  }
}

async function revoke(id: string) {
  try {
    await apiKeyApi.revoke(id);
    keys.value = keys.value.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k));
    toast.info('Key revoked');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  }
}

function copyKey() {
  if (!revealedPlaintext.value) return;
  navigator.clipboard?.writeText(revealedPlaintext.value);
  toast.success('Copied to clipboard');
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">API keys</h1>
    <p class="text-text/60 mb-4 text-sm">
      Keys authorize external clients (like the browser-extension bot) to hit
      <code class="bg-light px-1 rounded">/api/v1/*</code>. The plaintext value is shown once at
      creation.
    </p>

    <div v-if="loading" class="card animate-pulse h-32" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-else class="space-y-4">
      <section class="card">
        <h2 class="font-semibold mb-2">Create a new key</h2>
        <div class="flex gap-2 items-end">
          <div class="flex-1">
            <Input v-model="newName" label="Name" placeholder="Browser extension prod" />
          </div>
          <Button :loading="creating" @click="createKey">Generate</Button>
        </div>
      </section>

      <section class="card">
        <h2 class="font-semibold mb-2">Existing keys</h2>
        <div v-if="keys.length === 0" class="text-sm text-text/60">No keys yet.</div>
        <table v-else class="w-full text-sm">
          <thead class="text-left text-text/60">
            <tr>
              <th class="py-1">Name</th>
              <th class="py-1">Prefix</th>
              <th class="py-1">Created</th>
              <th class="py-1">Last used</th>
              <th class="py-1">Status</th>
              <th class="py-1 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="k in keys" :key="k.id" class="border-t border-light">
              <td class="py-1.5">{{ k.name }}</td>
              <td class="font-mono text-xs">{{ k.prefix }}…</td>
              <td>{{ formatDateTime(k.createdAt) }}</td>
              <td>{{ k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—' }}</td>
              <td>
                <span v-if="k.revokedAt" class="text-danger text-xs">Revoked</span>
                <span v-else class="text-success text-xs">Active</span>
              </td>
              <td class="py-1.5 text-right">
                <button v-if="!k.revokedAt" class="text-danger text-xs underline" @click="revoke(k.id)">
                  Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <Modal
      :open="!!revealedPlaintext"
      title="Save this key now"
      size="md"
      @close="revealedPlaintext = null"
    >
      <p class="text-sm">
        This is the only time the plaintext key for
        <strong>{{ revealedName }}</strong> will be shown. Copy it somewhere safe.
      </p>
      <pre class="bg-light p-3 rounded-btn font-mono text-xs break-all my-3 select-all">{{ revealedPlaintext }}</pre>
      <template #footer>
        <Button variant="ghost" size="sm" @click="revealedPlaintext = null">Close</Button>
        <Button size="sm" @click="copyKey">Copy to clipboard</Button>
      </template>
    </Modal>
  </div>
</template>

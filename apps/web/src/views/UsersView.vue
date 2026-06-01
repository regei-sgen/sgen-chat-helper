<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { AuthUser, Invite } from '@kb/shared';
import { userApi, inviteApi } from '@/api/resources';
import { useToastStore } from '@/stores/toast';
import Input from '@/components/Input.vue';
import Button from '@/components/Button.vue';
import Select from '@/components/Select.vue';
import { formatDate, formatDateTime } from '@/lib/format';
import { ApiError } from '@/api/client';

const toast = useToastStore();

const users = ref<AuthUser[]>([]);
const invites = ref<Invite[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const newInviteEmail = ref('');
const newInviteRole = ref<'EDITOR' | 'SUPER_ADMIN'>('EDITOR');
const creatingInvite = ref(false);

const roleOptions = [
  { value: 'EDITOR', label: 'Editor' },
  { value: 'SUPER_ADMIN', label: 'Super admin' },
];

onMounted(load);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [u, i] = await Promise.all([userApi.list(), inviteApi.list()]);
    users.value = u;
    invites.value = i;
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Failed to load';
  } finally {
    loading.value = false;
  }
}

async function createInvite() {
  if (!newInviteEmail.value.trim()) return;
  creatingInvite.value = true;
  try {
    const created = await inviteApi.create({
      email: newInviteEmail.value.trim(),
      role: newInviteRole.value,
    });
    invites.value = [created, ...invites.value];
    newInviteEmail.value = '';
    const url = `${window.location.origin}/register?token=${created.token}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    toast.success('Invite created · link copied to clipboard');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Could not create invite');
  } finally {
    creatingInvite.value = false;
  }
}

async function removeInvite(id: string) {
  try {
    await inviteApi.remove(id);
    invites.value = invites.value.filter((i) => i.id !== id);
    toast.info('Invite revoked');
  } catch (err) {
    toast.error(err instanceof ApiError ? err.message : 'Failed');
  }
}

function copyLink(token: string) {
  const url = `${window.location.origin}/register?token=${token}`;
  navigator.clipboard?.writeText(url);
  toast.success('Invite link copied');
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold mb-4">Users & invites</h1>

    <div v-if="loading" class="card animate-pulse h-32" />
    <p v-else-if="error" class="text-sm text-danger">{{ error }}</p>

    <div v-else class="space-y-4">
      <section class="card">
        <h2 class="font-semibold mb-3">Invite a teammate</h2>
        <div class="flex flex-wrap gap-3 items-end">
          <div class="flex-1 min-w-[220px]">
            <Input
              v-model="newInviteEmail"
              label="Email"
              type="email"
              placeholder="teammate@company.com"
            />
          </div>
          <Select
            :model-value="newInviteRole"
            label="Role"
            :options="roleOptions"
            @update:model-value="(v) => (newInviteRole = (v ?? 'EDITOR') as 'EDITOR' | 'SUPER_ADMIN')"
          />
          <Button :loading="creatingInvite" @click="createInvite">Create invite</Button>
        </div>
      </section>

      <section class="card">
        <h2 class="font-semibold mb-2">Pending invites</h2>
        <div v-if="invites.length === 0" class="text-sm text-text/60">No pending invites.</div>
        <table v-else class="w-full text-sm">
          <thead class="text-left text-text/60">
            <tr>
              <th class="py-1">Email</th>
              <th class="py-1">Role</th>
              <th class="py-1">Expires</th>
              <th class="py-1 w-40 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="inv in invites" :key="inv.id" class="border-t border-light">
              <td class="py-1.5">{{ inv.email }}</td>
              <td>{{ inv.role }}</td>
              <td>{{ formatDate(inv.expiresAt) }}</td>
              <td class="py-1.5 text-right space-x-2">
                <button class="text-xs text-primary underline" @click="copyLink(inv.token)">
                  Copy link
                </button>
                <button class="text-xs text-danger underline" @click="removeInvite(inv.id)">
                  Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2 class="font-semibold mb-2">Team members</h2>
        <table class="w-full text-sm">
          <thead class="text-left text-text/60">
            <tr>
              <th class="py-1">Name</th>
              <th class="py-1">Email</th>
              <th class="py-1">Role</th>
              <th class="py-1">Joined</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-t border-light">
              <td class="py-1.5">{{ u.name ?? '—' }}</td>
              <td>{{ u.email }}</td>
              <td>{{ u.role }}</td>
              <td>{{ formatDateTime(u.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

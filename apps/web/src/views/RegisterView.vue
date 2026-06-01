<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import Input from '@/components/Input.vue';
import Button from '@/components/Button.vue';
import { ApiError } from '@/api/client';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToastStore();

const email = ref('');
const password = ref('');
const name = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const inviteToken = computed(() => (route.query.token as string | undefined) ?? undefined);

async function onSubmit() {
  error.value = null;
  loading.value = true;
  try {
    await auth.register({
      email: email.value,
      password: password.value,
      name: name.value || undefined,
      inviteToken: inviteToken.value,
    });
    toast.success('Account created');
    router.push('/articles');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Registration failed';
    toast.error(error.value);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen grid place-items-center bg-body p-4">
    <form
      class="w-full max-w-sm bg-white p-6 rounded-btn shadow border border-light space-y-4"
      @submit.prevent="onSubmit"
    >
      <div class="text-center">
        <h1 class="text-xl font-semibold">Create your account</h1>
        <p class="text-sm text-text/60">
          {{
            inviteToken ? 'Completing your team invite' : 'No users yet — first signup becomes admin'
          }}
        </p>
      </div>
      <Input v-model="name" label="Name" placeholder="(optional)" />
      <Input v-model="email" label="Email" type="email" required autocomplete="email" />
      <Input
        v-model="password"
        label="Password"
        type="password"
        required
        autocomplete="new-password"
        hint="At least 8 characters"
      />
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <Button class="w-full" type="submit" :loading="loading">Create account</Button>
      <p class="text-xs text-center text-text/60">
        Have an account?
        <router-link to="/login" class="text-primary underline">Sign in</router-link>
      </p>
    </form>
  </div>
</template>

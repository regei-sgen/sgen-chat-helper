<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import Input from '@/components/Input.vue';
import Button from '@/components/Button.vue';
import { ApiError } from '@/api/client';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

async function onSubmit() {
  error.value = null;
  loading.value = true;
  try {
    await auth.login({ email: email.value, password: password.value });
    const redirect = (route.query.redirect as string) || '/articles';
    router.push(redirect);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Login failed';
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
        <div class="h-12 w-12 rounded-btn bg-primary text-white grid place-items-center font-bold text-xl mx-auto">
          S
        </div>
        <h1 class="text-xl font-semibold mt-3">SGEN Knowledge Base</h1>
        <p class="text-sm text-text/60">Sign in to manage docs</p>
      </div>
      <Input
        v-model="email"
        label="Email"
        type="email"
        required
        autocomplete="email"
        placeholder="admin@sgen.local"
      />
      <Input
        v-model="password"
        label="Password"
        type="password"
        required
        autocomplete="current-password"
      />
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
      <Button class="w-full" type="submit" :loading="loading">Sign in</Button>
      <p class="text-xs text-center text-text/60">
        First time?
        <router-link to="/register" class="text-primary underline">Create an account</router-link>
      </p>
    </form>
  </div>
</template>

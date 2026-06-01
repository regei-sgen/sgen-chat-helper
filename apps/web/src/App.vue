<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import ToastContainer from '@/components/ToastContainer.vue';

const auth = useAuthStore();

onMounted(() => {
  auth.hydrate();
});
</script>

<template>
  <router-view />
  <ToastContainer />
</template>

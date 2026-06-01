<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'primary',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
});

const klass = computed(() => {
  const variantCls =
    props.variant === 'primary'
      ? 'btn-primary'
      : props.variant === 'secondary'
        ? 'btn-secondary'
        : 'btn-ghost';
  const sizeCls = props.size === 'sm' ? 'btn-sm' : '';
  const disabledCls = props.disabled || props.loading ? 'opacity-60 cursor-not-allowed' : '';
  return [variantCls, sizeCls, disabledCls].filter(Boolean).join(' ');
});
</script>

<template>
  <button :type="type" :disabled="disabled || loading" :class="klass">
    <span v-if="loading" class="mr-2 inline-block h-4 w-4 animate-spin border-2 border-white border-t-transparent rounded-full" />
    <slot />
  </button>
</template>

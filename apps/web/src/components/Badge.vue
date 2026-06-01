<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  kind?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';
  size?: 'sm' | 'xs';
}

const props = withDefaults(defineProps<Props>(), {
  kind: 'neutral',
  size: 'sm',
});

const klass = computed(() => {
  const kindCls = {
    neutral: 'bg-light text-secondary',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/20 text-secondary',
    danger: 'bg-danger/15 text-danger',
    info: 'bg-info/20 text-secondary',
    primary: 'bg-primary/10 text-primary',
  }[props.kind];
  const sizeCls = props.size === 'xs' ? 'text-[10px]' : 'text-xs';
  return `${kindCls} ${sizeCls}`;
});
</script>

<template>
  <span class="badge" :class="klass"><slot /></span>
</template>

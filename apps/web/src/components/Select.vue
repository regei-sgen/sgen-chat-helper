<script setup lang="ts">
interface Option {
  value: string | null;
  label: string;
}

interface Props {
  modelValue: string | null | undefined;
  options: Option[];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), { disabled: false });

const emit = defineEmits<{
  'update:modelValue': [value: string | null];
}>();

function onChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  emit('update:modelValue', target.value === '' ? null : target.value);
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="block text-sm font-medium text-text mb-1">{{ label }}</span>
    <select class="input-base" :value="modelValue ?? ''" :disabled="disabled" @change="onChange">
      <option v-if="placeholder" value="">{{ placeholder }}</option>
      <option v-for="opt in options" :key="String(opt.value)" :value="opt.value ?? ''">
        {{ opt.label }}
      </option>
    </select>
  </label>
</template>

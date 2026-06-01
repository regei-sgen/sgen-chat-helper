<script setup lang="ts">
interface Props {
  modelValue: string | number | null | undefined;
  label?: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  autocomplete?: string;
}

withDefaults(defineProps<Props>(), {
  type: 'text',
  required: false,
  disabled: false,
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
}>();

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}
</script>

<template>
  <label class="block">
    <span v-if="label" class="block text-sm font-medium text-text mb-1">
      {{ label }}<span v-if="required" class="text-primary">*</span>
    </span>
    <input
      class="input-base"
      :class="error ? 'border-danger focus:border-danger focus:ring-danger' : ''"
      :type="type"
      :value="modelValue ?? ''"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :autocomplete="autocomplete"
      @input="onInput"
    />
    <span v-if="error" class="block text-xs text-danger mt-1">{{ error }}</span>
    <span v-else-if="hint" class="block text-xs text-text/60 mt-1">{{ hint }}</span>
  </label>
</template>

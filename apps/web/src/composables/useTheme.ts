import { ref } from 'vue';

// Light/dark theme, persisted in localStorage and applied via a `.dark` class on <html>
// (Tailwind darkMode: 'class'). An inline script in index.html sets the class pre-paint to avoid a
// flash; this composable keeps the reactive state and the toggle in sync with it.
export type ThemeMode = 'light' | 'dark';
const STORAGE_KEY = 'kb:theme';

const mode = ref<ThemeMode>('light');
let initialized = false;

function apply(m: ThemeMode): void {
  document.documentElement.classList.toggle('dark', m === 'dark');
}

function resolveInitial(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage may be unavailable */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  if (!initialized) {
    initialized = true;
    mode.value = resolveInitial();
    apply(mode.value); // idempotent with the index.html pre-paint script
  }

  function setMode(m: ThemeMode): void {
    mode.value = m;
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
    apply(m);
  }

  function toggle(): void {
    setMode(mode.value === 'dark' ? 'light' : 'dark');
  }

  return { mode, toggle, setMode };
}

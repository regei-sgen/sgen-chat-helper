<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, type Component } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import {
  FileText,
  Upload,
  Network,
  MessageSquare,
  BarChart3,
  Users,
  KeyRound,
  Settings,
  LogOut,
  Sun,
  Moon,
} from 'lucide-vue-next';
import { useTheme } from '@/composables/useTheme';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { mode, toggle: toggleTheme } = useTheme();

const userMenuOpen = ref(false);
const userMenuEl = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
  if (!userMenuOpen.value) return;
  if (userMenuEl.value && !userMenuEl.value.contains(e.target as Node)) {
    userMenuOpen.value = false;
  }
}
onMounted(() => document.addEventListener('click', onDocClick));
onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

const isSuperAdmin = computed(() => auth.user?.role === 'SUPER_ADMIN');

interface NavItem {
  path: string;
  label: string;
  icon: Component;
  superAdminOnly?: boolean;
}

const nav: NavItem[] = [
  { path: '/articles', label: 'Articles', icon: FileText },
  { path: '/articles/upload', label: 'Upload', icon: Upload },
  { path: '/graph', label: 'Graph', icon: Network },
  { path: '/chat-tester', label: 'Chat tester', icon: MessageSquare },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/users', label: 'Users', icon: Users, superAdminOnly: true },
  { path: '/api-keys', label: 'API keys', icon: KeyRound, superAdminOnly: true },
  { path: '/settings', label: 'Settings', icon: Settings },
];

const visibleNav = computed(() => nav.filter((n) => !n.superAdminOnly || isSuperAdmin.value));

function isActive(path: string): boolean {
  if (path === '/articles' && route.path === '/articles') return true;
  if (path === '/articles/upload' && route.path === '/articles/upload') return true;
  if (path !== '/articles' && route.path.startsWith(path)) return true;
  return route.path === path;
}

async function handleLogout() {
  await auth.logout();
  router.push('/login');
}
</script>

<template>
  <div class="min-h-screen flex bg-body">
    <aside class="w-60 bg-gradient-to-b from-secondary to-secondary-hover text-white flex flex-col border-r border-white/5">
      <div class="px-5 py-4 border-b border-white/10">
        <div class="flex items-center gap-2.5">
          <div class="h-9 w-9 rounded-lg bg-primary grid place-items-center font-bold shadow-sm">S</div>
          <div class="leading-tight">
            <div class="font-semibold">SGEN KB</div>
            <div class="text-xs opacity-70">Knowledge base</div>
          </div>
        </div>
      </div>
      <nav class="flex-1 py-4 space-y-0.5">
        <router-link
          v-for="item in visibleNav"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 mx-3 px-3 py-2.5 rounded-btn text-sm font-medium transition-colors"
          :class="
            isActive(item.path)
              ? 'bg-primary text-white shadow-sm'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          "
        >
          <component :is="item.icon" :size="18" :stroke-width="1.75" class="shrink-0" />
          <span>{{ item.label }}</span>
        </router-link>
      </nav>
    </aside>

    <div class="flex-1 flex flex-col">
      <header class="h-16 bg-surface/80 backdrop-blur-md border-b border-light/80 flex items-center justify-between px-6 sticky top-0 z-20">
        <div class="text-sm text-text/60">
          {{ route.meta.title || route.path }}
        </div>
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="h-9 w-9 grid place-items-center rounded-btn text-text/70 hover:text-text hover:bg-light/70 transition-colors"
            :title="mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
            :aria-label="mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
            @click="toggleTheme"
          >
            <Moon v-if="mode === 'light'" :size="18" :stroke-width="1.75" />
            <Sun v-else :size="18" :stroke-width="1.75" />
          </button>
          <div ref="userMenuEl" class="relative">
          <button
            class="flex items-center gap-2 text-sm font-medium hover:opacity-80"
            @click.stop="userMenuOpen = !userMenuOpen"
          >
            <div class="h-8 w-8 rounded-full bg-primary text-white grid place-items-center text-xs font-semibold">
              {{ (auth.user?.name || auth.user?.email || '?').slice(0, 1).toUpperCase() }}
            </div>
            <div class="leading-tight text-left">
              <div>{{ auth.user?.name || auth.user?.email }}</div>
              <div class="text-[10px] text-text/60">{{ auth.user?.role }}</div>
            </div>
          </button>
          <div
            v-if="userMenuOpen"
            class="absolute right-0 top-full mt-2 w-48 bg-surface border border-light/70 rounded-card shadow-pop z-30 overflow-hidden"
          >
            <router-link
              to="/settings"
              class="flex items-center gap-2 px-4 py-2 text-sm hover:bg-light"
              @click="userMenuOpen = false"
            >
              <Settings :size="15" /> Settings
            </router-link>
            <button
              class="flex items-center gap-2 w-full text-left px-4 py-2 text-sm hover:bg-light text-danger"
              @click="handleLogout"
            >
              <LogOut :size="15" /> Logout
            </button>
          </div>
          </div>
        </div>
      </header>

      <main class="flex-1 p-6 lg:p-8 overflow-y-auto bg-body">
        <router-view />
      </main>
    </div>
  </div>
</template>

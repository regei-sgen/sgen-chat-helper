import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/resources';
import { configureClient } from '@/api/client';
import type { AuthUser, LoginInput, RegisterInput } from '@kb/shared';

const STORAGE_KEY = 'kb_auth_v1';

interface StoredAuth {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const accessToken = ref<string | null>(null);
  const refreshToken = ref<string | null>(null);
  const hydrated = ref(false);

  const isAuthenticated = computed(() => Boolean(user.value && accessToken.value));

  function persist() {
    if (!user.value || !accessToken.value || !refreshToken.value) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const data: StoredAuth = {
      user: user.value,
      accessToken: accessToken.value,
      refreshToken: refreshToken.value,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function setSession(payload: { user: AuthUser; accessToken: string; refreshToken: string }) {
    user.value = payload.user;
    accessToken.value = payload.accessToken;
    refreshToken.value = payload.refreshToken;
    persist();
  }

  function clear() {
    user.value = null;
    accessToken.value = null;
    refreshToken.value = null;
    persist();
  }

  async function login(input: LoginInput) {
    const res = await authApi.login(input);
    setSession(res);
  }

  async function register(input: RegisterInput) {
    const res = await authApi.register(input);
    setSession(res);
  }

  async function logout() {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    clear();
  }

  async function attemptRefresh(): Promise<boolean> {
    if (!refreshToken.value) return false;
    try {
      const res = await authApi.refresh(refreshToken.value);
      setSession(res);
      return true;
    } catch {
      clear();
      return false;
    }
  }

  function hydrate() {
    if (hydrated.value) return;
    hydrated.value = true;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      configureBindings();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as StoredAuth;
      user.value = parsed.user;
      accessToken.value = parsed.accessToken;
      refreshToken.value = parsed.refreshToken;
    } catch {
      clear();
    }
    configureBindings();
  }

  function configureBindings() {
    configureClient({
      getAccessToken: () => accessToken.value,
      refreshTokens: () => attemptRefresh(),
      onUnauthorized: () => {
        clear();
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      },
    });
  }

  return {
    user,
    accessToken,
    refreshToken,
    hydrated,
    isAuthenticated,
    login,
    register,
    logout,
    hydrate,
    setSession,
    clear,
  };
});

import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('@/views/LoginView.vue'), meta: { public: true } },
    {
      path: '/register',
      component: () => import('@/views/RegisterView.vue'),
      meta: { public: true },
    },
    {
      path: '/graph/full',
      component: () => import('@/views/GraphFullView.vue'),
    },
    {
      path: '/',
      component: () => import('@/components/AppLayout.vue'),
      children: [
        { path: '', redirect: '/articles' },
        { path: 'articles', component: () => import('@/views/ArticleListView.vue') },
        { path: 'articles/new', component: () => import('@/views/ArticleEditView.vue') },
        { path: 'articles/upload', component: () => import('@/views/ArticleUploadView.vue') },
        { path: 'articles/:id', component: () => import('@/views/ArticleDetailView.vue') },
        { path: 'articles/:id/edit', component: () => import('@/views/ArticleEditView.vue') },
        { path: 'articles/:id/review', component: () => import('@/views/ArticleReviewView.vue') },
        { path: 'graph', component: () => import('@/views/GraphView.vue') },
        { path: 'chat-tester', component: () => import('@/views/ChatTesterView.vue') },
        { path: 'analytics', component: () => import('@/views/AnalyticsView.vue') },
        {
          path: 'users',
          component: () => import('@/views/UsersView.vue'),
          meta: { superAdmin: true },
        },
        {
          path: 'api-keys',
          component: () => import('@/views/ApiKeysView.vue'),
          meta: { superAdmin: true },
        },
        { path: 'settings', component: () => import('@/views/SettingsView.vue') },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/articles' },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.hydrated) auth.hydrate();

  if (to.meta.public) return true;
  if (!auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.superAdmin && auth.user?.role !== 'SUPER_ADMIN') {
    return { path: '/articles' };
  }
  return true;
});

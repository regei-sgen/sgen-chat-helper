import { request } from './client';
import type {
  AnalyzeResponse,
  ApplyRequest,
  AutoLinkApplyResponse,
  AutoLinkPreviewResponse,
  ChatMessage,
  ChatResponse,
  SuggestionsResponse,
  Article,
  ArticleCreateInput,
  ArticleListQuery,
  ArticleListResponse,
  ArticleUpdateInput,
  BulkAction,
  BulkArticleResult,
  ApiKey,
  ApiKeyCreatedResponse,
  AuthResponse,
  AuthUser,
  CoverageResponse,
  GraphResponse,
  Invite,
  InviteCreateInput,
  LoginInput,
  RegisterInput,
  ReembedResult,
  SettingsStatus,
  SettingsTestResult,
  SettingsUpdateInput,
  TopQuery,
  UnansweredQuery,
  UploadJobStatus,
} from '@kb/shared';

export const authApi = {
  login: (body: LoginInput) =>
    request<AuthResponse>('/auth/login', { method: 'POST', body }),
  register: (body: RegisterInput) =>
    request<AuthResponse>('/auth/register', { method: 'POST', body }),
  refresh: (refreshToken: string) =>
    request<AuthResponse>('/auth/refresh', { method: 'POST', body: { refreshToken } }),
  me: () => request<AuthUser>('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
};

export const articleApi = {
  list: (query: Partial<ArticleListQuery> = {}) => {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(query)) {
      if (val !== undefined && val !== null && val !== '') params.set(key, String(val));
    }
    const qs = params.toString();
    return request<ArticleListResponse>(`/articles${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<Article>(`/articles/${id}`),
  create: (body: ArticleCreateInput) =>
    request<Article>('/articles', { method: 'POST', body }),
  update: (id: string, body: ArticleUpdateInput) =>
    request<Article>(`/articles/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/articles/${id}`, { method: 'DELETE' }),
  publish: (id: string) =>
    request<Article>(`/articles/${id}/publish`, { method: 'POST' }),
  restructure: (id: string) =>
    request<{ structured: unknown }>(`/articles/${id}/restructure`, { method: 'POST' }),
  uploadSingle: (file: File, autoPublish: boolean) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('autoPublish', String(autoPublish));
    return request<{ article: Article; structured: unknown }>('/articles/upload', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },
  uploadBulk: (files: File[], autoPublish: boolean) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('autoPublish', String(autoPublish));
    return request<{ jobId: string; total: number }>('/articles/upload-bulk', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },
  jobStatus: (id: string) => request<UploadJobStatus>(`/articles/jobs/${id}`),
  analyze: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<AnalyzeResponse>('/articles/analyze', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },
  apply: (body: ApplyRequest) => request<Article>('/articles/apply', { method: 'POST', body }),
  resolveDuplicate: (id: string, action: 'override' | 'dismiss') =>
    request<Article>(`/articles/${id}/resolve-duplicate`, { method: 'POST', body: { action } }),
  bulk: (ids: string[], action: BulkAction) =>
    request<BulkArticleResult>('/articles/bulk', { method: 'POST', body: { ids, action } }),
};

export const autoLinkApi = {
  preview: () =>
    request<AutoLinkPreviewResponse>('/articles/auto-link/preview', { method: 'POST' }),
  apply: (proposals?: { id: string; prerequisiteIds: string[]; relatedIds: string[] }[]) =>
    request<AutoLinkApplyResponse>('/articles/auto-link/apply', {
      method: 'POST',
      body: proposals ? { proposals } : undefined,
    }),
};

export const chatTesterApi = {
  send: (message: string, history: ChatMessage[]) =>
    request<ChatResponse>('/chat', { method: 'POST', body: { message, history } }),
  suggestions: () => request<SuggestionsResponse>('/chat/suggestions'),
};

export const graphApi = {
  fetch: () => request<GraphResponse>('/graph'),
};

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/api-keys'),
  create: (name: string) =>
    request<ApiKeyCreatedResponse>('/api-keys', { method: 'POST', body: { name } }),
  revoke: (id: string) => request<{ ok: true }>(`/api-keys/${id}`, { method: 'DELETE' }),
};

export const inviteApi = {
  list: () => request<Invite[]>('/invites'),
  create: (body: InviteCreateInput) =>
    request<Invite>('/invites', { method: 'POST', body }),
  remove: (id: string) => request<{ ok: true }>(`/invites/${id}`, { method: 'DELETE' }),
};

export const analyticsApi = {
  unanswered: () => request<UnansweredQuery[]>('/analytics/unanswered'),
  topQueries: () => request<TopQuery[]>('/analytics/top-queries'),
  coverage: () => request<CoverageResponse>('/analytics/coverage'),
};

export const settingsApi = {
  get: () => request<SettingsStatus>('/settings'),
  update: (body: SettingsUpdateInput) =>
    request<SettingsStatus>('/settings', { method: 'PUT', body }),
  test: () => request<SettingsTestResult>('/settings/test', { method: 'POST' }),
  reembed: () => request<ReembedResult>('/settings/reembed', { method: 'POST' }),
};

export const userApi = {
  list: () => request<AuthUser[]>('/users'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/users/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    }),
  updateMe: (name: string) => request<AuthUser>('/users/me', { method: 'PATCH', body: { name } }),
};

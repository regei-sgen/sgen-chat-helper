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
  BulkAllFilter,
  BulkAllResult,
  ApiKey,
  ApiKeyCreatedResponse,
  AnalyticsSummary,
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
  uploadSingle: (file: File, autoPublish: boolean, asIs = false) => {
    const fd = new FormData();
    // Append scalar fields BEFORE the file: the server reads them via `data.fields`, which only
    // holds parts seen before the file in the multipart stream.
    fd.append('autoPublish', String(autoPublish));
    fd.append('asIs', String(asIs));
    fd.append('file', file);
    return request<{ article: Article; structured: unknown }>('/articles/upload', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },
  // One chunk of a bulk upload. The first chunk omits `jobId` and sends `expectedTotal` (the grand
  // total) so the server sizes the job to the whole import; later chunks pass the returned `jobId`.
  uploadBulkChunk: (
    files: File[],
    opts: { autoPublish: boolean; asIs: boolean; jobId?: string; expectedTotal?: number },
  ) => {
    const fd = new FormData();
    if (opts.jobId) fd.append('jobId', opts.jobId);
    if (opts.expectedTotal != null) fd.append('expectedTotal', String(opts.expectedTotal));
    fd.append('autoPublish', String(opts.autoPublish));
    fd.append('asIs', String(opts.asIs));
    for (const f of files) fd.append('files', f);
    return request<{ jobId: string; total: number }>('/articles/upload-bulk', {
      method: 'POST',
      body: fd,
      isFormData: true,
    });
  },
  // Reconcile a chunked job's total to the count actually enqueued (and complete it if everything
  // already processed). Call once, after all chunks are sent.
  finalizeBulk: (jobId: string, total: number) =>
    request<UploadJobStatus>(`/articles/upload-bulk/${jobId}/finalize`, {
      method: 'POST',
      body: { total },
    }),
  jobStatus: (id: string) => request<UploadJobStatus>(`/articles/jobs/${id}`),
  analyze: (file: File, asIs = false) => {
    const fd = new FormData();
    // Field before file — see uploadSingle note.
    fd.append('asIs', String(asIs));
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
  // Apply an action to EVERY article matching `filter` (not just the loaded page).
  bulkAll: (action: BulkAction, filter: BulkAllFilter) =>
    request<BulkAllResult>('/articles/bulk-all', { method: 'POST', body: { action, filter } }),
};

// Small batches keep every request far under the multipart `parts` limit and make a big import
// resilient (a hiccup costs one chunk, not the whole upload). Easy to tune.
const BULK_CHUNK_SIZE = 20;

export interface BulkUploadCallbacks {
  onJobCreated?: (jobId: string) => void;
  onProgress?: (enqueued: number, total: number) => void;
}

// Upload many markdown files reliably by splitting them into small chunks that all feed ONE tracked
// job. The first chunk creates the job sized to the full import; the rest append; a final reconcile
// completes it. Returns the jobId and how many files actually got enqueued.
export async function uploadMarkdownBulk(
  files: File[],
  autoPublish: boolean,
  asIs: boolean,
  cb: BulkUploadCallbacks = {},
): Promise<{ jobId: string; enqueued: number; failedToUpload: number }> {
  const total = files.length;
  if (total === 0) throw new Error('No files to upload');

  const chunks: File[][] = [];
  for (let i = 0; i < files.length; i += BULK_CHUNK_SIZE) {
    chunks.push(files.slice(i, i + BULK_CHUNK_SIZE));
  }

  // First chunk creates the job (sized to the whole import) so progress + completion are correct
  // from the very first poll.
  const first = await articleApi.uploadBulkChunk(chunks[0], { autoPublish, asIs, expectedTotal: total });
  const { jobId } = first;
  let enqueued = chunks[0].length;
  cb.onJobCreated?.(jobId);
  cb.onProgress?.(enqueued, total);

  // Remaining chunks append to the same job. Retry a failed chunk once, then skip it (the finalize
  // step reconciles the total so the job can still complete).
  for (let c = 1; c < chunks.length; c++) {
    let sent = false;
    for (let attempt = 0; attempt < 2 && !sent; attempt++) {
      try {
        await articleApi.uploadBulkChunk(chunks[c], { autoPublish, asIs, jobId });
        sent = true;
        enqueued += chunks[c].length;
      } catch {
        // retried once; if it still fails we skip this chunk and reconcile below
      }
    }
    cb.onProgress?.(enqueued, total);
  }

  await articleApi.finalizeBulk(jobId, enqueued).catch(() => {});
  return { jobId, enqueued, failedToUpload: total - enqueued };
}

export const autoLinkApi = {
  preview: () =>
    request<AutoLinkPreviewResponse>('/articles/auto-link/preview', { method: 'POST' }),
  apply: (proposals?: { id: string; prerequisiteIds: string[]; relatedIds: string[] }[]) =>
    request<AutoLinkApplyResponse>('/articles/auto-link/apply', {
      method: 'POST',
      body: proposals ? { proposals } : undefined,
    }),
};

// No-AI Link Arranger: connects articles by stored-embedding similarity. Apply recomputes
// server-side (deterministic), so the client never posts proposals — and it only ADDS related links.
export const vectorLinkApi = {
  preview: () =>
    request<AutoLinkPreviewResponse>('/articles/auto-link/vector/preview', { method: 'POST' }),
  apply: () =>
    request<AutoLinkApplyResponse>('/articles/auto-link/vector/apply', { method: 'POST' }),
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

// `days` scopes bot-usage metrics to a window (7/30/90); omit/null = all time.
const daysQuery = (days?: number | null) => (days ? `?days=${days}` : '');
export const analyticsApi = {
  summary: (days?: number | null) =>
    request<AnalyticsSummary>(`/analytics/summary${daysQuery(days)}`),
  unanswered: (days?: number | null) =>
    request<UnansweredQuery[]>(`/analytics/unanswered${daysQuery(days)}`),
  topQueries: (days?: number | null) =>
    request<TopQuery[]>(`/analytics/top-queries${daysQuery(days)}`),
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

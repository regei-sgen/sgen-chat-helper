// Default: reach the API on the SAME host the dashboard was loaded from, port 3001.
// So http://localhost:5173 -> http://localhost:3001 and
//    http://sg-help-admin.test:5173 -> http://sg-help-admin.test:3001 — both "just work".
// Set VITE_API_URL in apps/web/.env to pin a fixed API URL instead.
const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  `${window.location.protocol}//${window.location.hostname}:3001`;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  isFormData?: boolean;
}

type TokenGetter = () => string | null;
type RefreshFn = () => Promise<boolean>;
type LogoutFn = () => void;

let getAccessToken: TokenGetter = () => null;
let refreshTokens: RefreshFn = async () => false;
let onUnauthorized: LogoutFn = () => {};

export function configureClient(opts: {
  getAccessToken: TokenGetter;
  refreshTokens: RefreshFn;
  onUnauthorized: LogoutFn;
}) {
  getAccessToken = opts.getAccessToken;
  refreshTokens = opts.refreshTokens;
  onUnauthorized = opts.onUnauthorized;
}

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  // Only declare a JSON body when there actually is one — otherwise Fastify rejects
  // the empty body with FST_ERR_CTP_EMPTY_JSON_BODY (400).
  if (!opts.isFormData && opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.isFormData
      ? (opts.body as BodyInit)
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined,
    signal: opts.signal,
  });

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const text = await response.text();
  const data = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const err = (data && typeof data === 'object' && 'error' in data
      ? (data as { error: { code: string; message: string; details?: unknown } }).error
      : { code: 'HTTP_ERROR', message: response.statusText, details: undefined });
    throw new ApiError(response.status, err.code, err.message, err.details);
  }

  return data as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let refreshPromise: Promise<boolean> | null = null;

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && getAccessToken()) {
      if (!refreshPromise) refreshPromise = refreshTokens();
      const refreshed = await refreshPromise;
      refreshPromise = null;
      if (refreshed) {
        return await rawRequest<T>(path, opts);
      }
      onUnauthorized();
    }
    throw err;
  }
}

export const apiBase = API_BASE;

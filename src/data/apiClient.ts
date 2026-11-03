export interface AuthUser {
  id: string;
  email: string;
}

export type CsrfContext = 'pre-auth' | 'authenticated';

interface CsrfResponse {
  csrfToken: string;
  context: CsrfContext;
}

interface ApiErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    requestId?: unknown;
  };
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code: string;
      details?: unknown;
      requestId?: string | null;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable ?? (options.status >= 500 || options.status === 0);
  }
}

let csrf: CsrfResponse | null = null;

const API_ROOT = '/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clearCsrf(context?: CsrfContext): void {
  if (!context || csrf?.context === context) csrf = null;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    return await fetch(`${API_ROOT}${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });
  } catch {
    throw new ApiRequestError(
      'Could not reach Launchboard. Check the connection and try again.',
      { status: 0, code: 'NETWORK_ERROR', retryable: true },
    );
  }
}

async function responseError(response: Response): Promise<ApiRequestError> {
  let payload: ApiErrorEnvelope = {};
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) payload = value as ApiErrorEnvelope;
  } catch {
    // A proxy or server may return a non-JSON error page. Never expose its body.
  }

  const error = isRecord(payload.error) ? payload.error : {};
  const message =
    typeof error.message === 'string'
      ? error.message
      : 'The request could not be completed.';
  const code = typeof error.code === 'string' ? error.code : 'REQUEST_FAILED';
  return new ApiRequestError(message, {
    status: response.status,
    code,
    details: error.details,
    requestId: typeof error.requestId === 'string' ? error.requestId : null,
    retryable: response.status >= 500,
  });
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      'The server returned an unreadable response.',
      { status: response.status, code: 'INVALID_RESPONSE' },
    );
  }
}

async function fetchCsrf(): Promise<CsrfResponse> {
  const response = await request('/auth/csrf', { method: 'GET' });
  const result = await parseJson<CsrfResponse>(response);
  if (
    typeof result.csrfToken !== 'string' ||
    (result.context !== 'pre-auth' && result.context !== 'authenticated')
  ) {
    throw new ApiRequestError(
      'The server returned an invalid security token response.',
      { status: response.status, code: 'INVALID_RESPONSE' },
    );
  }
  csrf = result;
  return result;
}

async function ensureCsrf(context: CsrfContext): Promise<string> {
  if (csrf?.context === context) return csrf.csrfToken;

  try {
    const result = await fetchCsrf();
    if (result.context === context) return result.csrfToken;
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
  }

  if (context === 'pre-auth') {
    const response = await request('/auth/pre-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const result = await parseJson<CsrfResponse>(response);
    if (result.context !== 'pre-auth' || typeof result.csrfToken !== 'string') {
      throw new ApiRequestError(
        'The server did not start a valid pre-authentication session.',
        { status: response.status, code: 'INVALID_RESPONSE' },
      );
    }
    csrf = result;
    return result.csrfToken;
  }

  throw new ApiRequestError(
    'Your session has expired. Sign in again to continue.',
    { status: 401, code: 'UNAUTHORIZED' },
  );
}

export interface JsonRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: HeadersInit;
  /** Send JSON content type for bodyless mutations that still require it. */
  json?: boolean;
  csrfContext?: CsrfContext;
}

/** Same-origin JSON transport. Session cookies are HttpOnly and never read by JS. */
export async function apiJson<T>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  let body: string | undefined;

  if (options.body !== undefined) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  } else if (options.json && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  if (options.csrfContext) {
    headers.set('X-CSRF-Token', await ensureCsrf(options.csrfContext));
  }

  const response = await request(path, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  });

  if (response.status === 401) {
    clearCsrf('authenticated');
  }

  const result = await parseJson<T>(response);
  if (isRecord(result) && typeof result.csrfToken === 'string') {
    const context =
      result.context === 'pre-auth' || result.context === 'authenticated'
        ? result.context
        : 'authenticated';
    csrf = { csrfToken: result.csrfToken, context };
  }
  return result;
}

export interface AuthResponse {
  user: AuthUser;
  csrfToken: string;
}

export async function getCurrentUser(): Promise<AuthResponse> {
  const result = await apiJson<AuthResponse>('/auth/me');
  csrf = { csrfToken: result.csrfToken, context: 'authenticated' };
  return result;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const result = await apiJson<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    csrfContext: 'pre-auth',
  });
  csrf = { csrfToken: result.csrfToken, context: 'authenticated' };
  return result;
}

export interface AccountActionResponse {
  message: string;
}

export async function register(
  email: string,
  password: string,
): Promise<AccountActionResponse> {
  const result = await apiJson<AccountActionResponse>('/auth/register', {
    method: 'POST',
    body: { email, password },
    csrfContext: 'pre-auth',
  });
  // Registration consumes and clears the pre-auth cookie on the server.
  // Force the next account action to bootstrap a fresh pre-auth session.
  clearCsrf('pre-auth');
  return result;
}

export async function verifyEmail(token: string): Promise<AccountActionResponse> {
  return apiJson<AccountActionResponse>('/auth/verify-email', {
    method: 'POST',
    body: { token },
    csrfContext: 'pre-auth',
  });
}

export async function resendVerification(email: string): Promise<AccountActionResponse> {
  return apiJson<AccountActionResponse>('/auth/resend-verification', {
    method: 'POST',
    body: { email },
    csrfContext: 'pre-auth',
  });
}

export async function requestPasswordReset(email: string): Promise<AccountActionResponse> {
  return apiJson<AccountActionResponse>('/auth/password-reset/request', {
    method: 'POST',
    body: { email },
    csrfContext: 'pre-auth',
  });
}

export async function confirmPasswordReset(
  token: string,
  password: string,
): Promise<AccountActionResponse> {
  return apiJson<AccountActionResponse>('/auth/password-reset/confirm', {
    method: 'POST',
    body: { token, password },
    csrfContext: 'pre-auth',
  });
}

export async function logout(): Promise<void> {
  try {
    await apiJson<void>('/auth/logout', {
      method: 'POST',
      body: {},
      csrfContext: 'authenticated',
    });
  } finally {
    clearCsrf();
  }
}

/** Clears only in-memory security state, e.g. after an explicit account transition. */
export function resetApiSecurityState(): void {
  clearCsrf();
}

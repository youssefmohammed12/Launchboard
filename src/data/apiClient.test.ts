import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  getCurrentUser,
  getAccountProfile,
  updateAccountProfile,
  changeAccountPassword,
  deleteAccount,
  login,
  logout,
  register,
  verifyEmail,
  resendVerification,
  requestPasswordReset,
  confirmPasswordReset,
  previewOpportunityCapture,
  resetApiSecurityState,
} from './apiClient';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('same-origin API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetApiSecurityState();
  });

  it('creates a pre-auth session before login and sends its CSRF token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/csrf') {
        return jsonResponse({
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' },
        }, 401);
      }
      if (url === '/api/auth/pre-session') {
        return jsonResponse({ csrfToken: 'pre-csrf', context: 'pre-auth' });
      }
      if (url === '/api/auth/login') {
        return jsonResponse({
          user: { id: 'user-1', email: 'user@example.com' },
          csrfToken: 'auth-csrf',
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await login('user@example.com', 'a-strong-password');

    expect(result.user).toEqual({ id: 'user-1', email: 'user@example.com' });
    expect(calls.map((call) => call.url)).toEqual([
      '/api/auth/csrf',
      '/api/auth/pre-session',
      '/api/auth/login',
    ]);
    expect(calls[1].init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      body: '{}',
    });
    const loginHeaders = new Headers(calls[2].init.headers);
    expect(loginHeaders.get('X-CSRF-Token')).toBe('pre-csrf');
    expect(loginHeaders.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({
      email: 'user@example.com',
      password: 'a-strong-password',
    });
    expect(calls.every((call) => call.init.credentials === 'same-origin')).toBe(true);
  });

  it('recovers the authenticated CSRF token from /me and uses it for logout', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/me') {
        return jsonResponse({
          user: { id: 'user-2', email: 'person@example.com' },
          csrfToken: 'session-csrf',
        });
      }
      if (url === '/api/auth/logout') return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = await getCurrentUser();
    await logout();

    expect(session.csrfToken).toBe('session-csrf');
    expect(calls.map((call) => call.url)).toEqual([
      '/api/auth/me',
      '/api/auth/logout',
    ]);
    const headers = new Headers(calls[1].init.headers);
    expect(headers.get('X-CSRF-Token')).toBe('session-csrf');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({});
  });

  it('surfaces the safe API error envelope without exposing response internals', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: {
        code: 'STALE_VERSION',
        message: 'This opportunity changed since you loaded it.',
        details: { currentVersion: 4 },
        requestId: 'req-123',
      },
    }, 409)));

    await expect(getCurrentUser()).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 409,
      code: 'STALE_VERSION',
      details: { currentVersion: 4 },
      requestId: 'req-123',
      retryable: false,
    });
  });

  it('converts network failures into retryable safe errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('private network diagnostic');
    }));

    let thrown: unknown;
    try {
      await getCurrentUser();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiRequestError);
    expect(thrown).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      retryable: true,
    });
    expect((thrown as Error).message).not.toContain('private network diagnostic');
  });

  it('sends Quick Capture preview through the authenticated same-origin CSRF transport', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const preview = {
      outcome: 'ready',
      source: 'job-posting',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      description: 'Work with the frontend team.',
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/me') {
        return jsonResponse({
          user: { id: 'user-capture', email: 'person@example.com' },
          csrfToken: 'capture-session-csrf',
        });
      }
      if (url === '/api/capture/preview') return jsonResponse(preview);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await getCurrentUser();
    const result = await previewOpportunityCapture('https://jobs.example.org/frontend');

    expect(result).toEqual(preview);
    expect(calls.map((call) => call.url)).toEqual([
      '/api/auth/me',
      '/api/capture/preview',
    ]);
    const request = calls[1];
    expect(request?.init.method).toBe('POST');
    expect(request?.init.credentials).toBe('same-origin');
    expect(JSON.parse(String(request?.init.body))).toEqual({
      url: 'https://jobs.example.org/frontend',
    });
    const headers = new Headers(request?.init.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('X-CSRF-Token')).toBe('capture-session-csrf');
  });

  it('surfaces the safe NOT_READY response from a disabled Quick Capture endpoint', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/auth/me') {
        return jsonResponse({
          user: { id: 'user-capture', email: 'person@example.com' },
          csrfToken: 'capture-session-csrf',
        });
      }
      if (url === '/api/capture/preview') {
        return jsonResponse({
          error: {
            code: 'NOT_READY',
            message: 'Authenticated preview is not enabled.',
          },
        }, 503);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await getCurrentUser();
    await expect(
      previewOpportunityCapture('https://jobs.example.org/frontend'),
    ).rejects.toMatchObject({
      name: 'ApiRequestError',
      status: 503,
      code: 'NOT_READY',
    });
  });
});

  it('keeps registration pending and routes verification/recovery through pre-auth CSRF', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let sessionNumber = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/csrf') {
        return jsonResponse({
          error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' },
        }, 401);
      }
      if (url === '/api/auth/pre-session') {
        sessionNumber += 1;
        return jsonResponse({ csrfToken: `pre-csrf-${sessionNumber}`, context: 'pre-auth' });
      }
      if (url === '/api/auth/register') {
        return jsonResponse({ message: 'Check your email for verification instructions.' }, 202);
      }
      if (url === '/api/auth/verify-email') {
        return jsonResponse({ message: 'Email verified. You can now sign in.' });
      }
      if (url === '/api/auth/resend-verification' ||
          url === '/api/auth/password-reset/request') {
        return jsonResponse({ message: 'If an account is eligible, instructions will be sent.' }, 202);
      }
      if (url === '/api/auth/password-reset/confirm') {
        return jsonResponse({ message: 'Your password has been changed.' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const registration = await register('person@example.test', 'a-long-registration-password');
    expect(registration.message).toContain('verification instructions');

    await verifyEmail('verify-token-value');
    await resendVerification('person@example.test');
    await requestPasswordReset('person@example.test');
    await confirmPasswordReset('reset-token-value', 'a-new-long-reset-password');

    const registerCall = calls.find((call) => call.url === '/api/auth/register');
    expect(registerCall).toBeDefined();
    expect(new Headers(registerCall?.init.headers).get('X-CSRF-Token')).toBe('pre-csrf-1');
    expect(calls.filter((call) => call.url === '/api/auth/pre-session')).toHaveLength(2);

    const actionCalls = calls.filter((call) =>
      call.url.startsWith('/api/auth/') &&
      !['/api/auth/csrf', '/api/auth/pre-session'].includes(call.url),
    );
    expect(actionCalls.map((call) => call.url)).toEqual([
      '/api/auth/register',
      '/api/auth/verify-email',
      '/api/auth/resend-verification',
      '/api/auth/password-reset/request',
      '/api/auth/password-reset/confirm',
    ]);
    const actionBodies = actionCalls.map((call) => JSON.parse(String(call.init.body)));
    expect(actionBodies).toEqual([
      { email: 'person@example.test', password: 'a-long-registration-password' },
      { token: 'verify-token-value' },
      { email: 'person@example.test' },
      { email: 'person@example.test' },
      { token: 'reset-token-value', password: 'a-new-long-reset-password' },
    ]);
    expect(actionCalls.every((call) =>
      new Headers(call.init.headers).get('X-CSRF-Token')?.startsWith('pre-csrf-'),
    )).toBe(true);
    expect(actionCalls.every((call) => call.init.credentials === 'same-origin')).toBe(true);
  });


describe('account settings API helpers', () => {
  it('loads a profile and sends CSRF-protected profile, password and deletion requests', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === '/api/auth/csrf') {
        return jsonResponse({ csrfToken: 'account-csrf', context: 'authenticated' });
      }
      if (url === '/api/account/profile' && (init.method === undefined || init.method === 'GET')) {
        return jsonResponse({
          profile: {
            id: 'user-1',
            email: 'person@example.com',
            displayName: 'Youssef',
            emailVerified: true,
            createdAt: '2026-10-01T10:00:00.000Z',
          },
        });
      }
      if (url === '/api/account/profile' && init.method === 'PATCH') {
        return jsonResponse({ profile: { displayName: 'Youssef Mohammed' } });
      }
      if (url === '/api/account/password') {
        return jsonResponse({ message: 'Password changed.' });
      }
      if (url === '/api/account' && init.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const loaded = await getAccountProfile();
    const updated = await updateAccountProfile('Youssef Mohammed');
    const password = await changeAccountPassword('current-password', 'a-new-password-that-is-long-enough');
    await deleteAccount('current-password');

    expect(loaded.profile.email).toBe('person@example.com');
    expect(updated.profile.displayName).toBe('Youssef Mohammed');
    expect(password.message).toBe('Password changed.');
    expect(calls.map((call) => call.url)).toEqual([
      '/api/account/profile',
      '/api/auth/csrf',
      '/api/account/profile',
      '/api/account/password',
      '/api/account',
    ]);

    const profileHeaders = new Headers(calls[2].init.headers);
    expect(calls[2].init.method).toBe('PATCH');
    expect(profileHeaders.get('X-CSRF-Token')).toBe('account-csrf');
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ displayName: 'Youssef Mohammed' });

    const passwordHeaders = new Headers(calls[3].init.headers);
    expect(passwordHeaders.get('X-CSRF-Token')).toBe('account-csrf');
    expect(JSON.parse(String(calls[3].init.body))).toEqual({
      currentPassword: 'current-password',
      newPassword: 'a-new-password-that-is-long-enough',
    });

    const deletionHeaders = new Headers(calls[4].init.headers);
    expect(calls[4].init.method).toBe('DELETE');
    expect(deletionHeaders.get('X-CSRF-Token')).toBe('account-csrf');
    expect(JSON.parse(String(calls[4].init.body))).toEqual({
      currentPassword: 'current-password',
      confirmation: 'DELETE',
    });
    expect(calls.every((call) => call.init.credentials === 'same-origin')).toBe(true);
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetApiSecurityState } from '../data/apiClient';
import { useAuth } from './useAuth';

const user = { id: 'user-1', email: 'person@example.com' };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetApiSecurityState();
});

describe('useAuth', () => {
  it('bootstraps the current authenticated session', async () => {
    stubFetch((url) => {
      if (url === '/api/auth/me') {
        return jsonResponse({ user, csrfToken: 'csrf-session' });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.state.status).toBe('authenticated'));
    expect(result.current.state).toMatchObject({ status: 'authenticated', user });
    expect(result.current.busy).toBe(false);
  });

  it('treats a missing session as signed out, not as an API outage', async () => {
    stubFetch((url) => {
      if (url === '/api/auth/me') {
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, 401);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.state.status).toBe('anonymous'));
    expect(result.current.state).toEqual({ status: 'anonymous' });
  });

  it('reports API/network unavailability separately from an unauthenticated session', async () => {
    stubFetch(() => {
      throw new TypeError('private network diagnostic');
    });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.state.status).toBe('unavailable'));
    expect(result.current.state).toEqual({
      status: 'unavailable',
      error: 'Could not reach Launchboard. Check the connection and try again.',
    });
  });

  it('authenticates after login but keeps a newly registered account anonymous', async () => {
    const calls: string[] = [];
    stubFetch((url) => {
      calls.push(url);
      if (url === '/api/auth/me' || url === '/api/auth/csrf') {
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated.' } }, 401);
      }
      if (url === '/api/auth/pre-session') {
        return jsonResponse({ csrfToken: 'csrf-pre', context: 'pre-auth' });
      }
      if (url === '/api/auth/login') {
        return jsonResponse({ user, csrfToken: 'csrf-auth' });
      }
      if (url === '/api/auth/register') {
        return jsonResponse({ message: 'Check your email for verification instructions.' }, 202);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.state.status).toBe('anonymous'));

    let signInResult: Awaited<ReturnType<typeof result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await result.current.signIn(user.email, 'a-long-password');
    });
    expect(signInResult).toEqual({ ok: true });
    expect(result.current.state).toMatchObject({ status: 'authenticated', user });

    let signUpResult: Awaited<ReturnType<typeof result.current.signUp>> | undefined;
    await act(async () => {
      signUpResult = await result.current.signUp(user.email, 'another-long-password');
    });
    expect(signUpResult).toEqual({
      ok: true,
      message: 'Check your email for verification instructions.',
    });
    expect(result.current.state).toEqual({ status: 'anonymous' });
    expect(calls).toContain('/api/auth/login');
    expect(calls).toContain('/api/auth/register');
  });

  it('does not claim logout succeeded when the server request fails', async () => {
    stubFetch((url) => {
      if (url === '/api/auth/me') {
        return jsonResponse({ user, csrfToken: 'csrf-session' });
      }
      if (url === '/api/auth/logout') {
        throw new TypeError('connection refused');
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useAuth());

    await waitFor(() => expect(result.current.state.status).toBe('authenticated'));

    let signOutResult: Awaited<ReturnType<typeof result.current.signOut>> | undefined;
    await act(async () => {
      signOutResult = await result.current.signOut();
    });
    expect(signOutResult).toEqual({
      ok: false,
      error: 'Could not reach Launchboard. Check the connection and try again.',
    });
    expect(result.current.state).toMatchObject({
      status: 'authenticated',
      user,
    });
  });
});

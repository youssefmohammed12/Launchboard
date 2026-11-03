import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiRequestError,
  getCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthUser,
} from '../data/apiClient';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; error?: string }
  | { status: 'unavailable'; error: string }
  | { status: 'authenticated'; user: AuthUser; error?: string };

export type AuthActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export interface UseAuthResult {
  state: AuthState;
  busy: boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<AuthActionResult>;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return 'Authentication could not be completed. Try again.';
}

/** Owns only the current identity; session tokens remain in HttpOnly cookies. */
export function useAuth(): UseAuthResult {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState({ status: 'loading' });
    try {
      const result = await getCurrentUser();
      if (sequence === requestSequence.current) {
        setState({ status: 'authenticated', user: result.user });
      }
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        setState({ status: 'anonymous' });
      } else {
        setState({ status: 'unavailable', error: safeErrorMessage(error) });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const authenticate = useCallback(
    async (
      action: (email: string, password: string) => Promise<{ user: AuthUser }>,
      email: string,
      password: string,
    ): Promise<AuthActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: 'An authentication request is already running.' };
      }
      busyRef.current = true;
      setBusy(true);
      const sequence = ++requestSequence.current;
      try {
        const result = await action(email, password);
        if (sequence === requestSequence.current) {
          setState({ status: 'authenticated', user: result.user });
        }
        return { ok: true };
      } catch (error) {
        const message = safeErrorMessage(error);
        if (sequence === requestSequence.current) {
          setState({ status: 'anonymous', error: message });
        }
        return { ok: false, error: message };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const signIn = useCallback(
    (email: string, password: string) => authenticate(apiLogin, email, password),
    [authenticate],
  );

  const signUp = useCallback(
    async (email: string, password: string): Promise<AuthActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: 'An authentication request is already running.' };
      }
      busyRef.current = true;
      setBusy(true);
      const sequence = ++requestSequence.current;
      try {
        const result = await apiRegister(email, password);
        if (sequence === requestSequence.current) setState({ status: 'anonymous' });
        return { ok: true, message: result.message };
      } catch (error) {
        const message = safeErrorMessage(error);
        if (sequence === requestSequence.current) {
          setState({ status: 'anonymous', error: message });
        }
        return { ok: false, error: message };
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const signOut = useCallback(async (): Promise<AuthActionResult> => {
    if (busyRef.current) {
      return { ok: false, error: 'An authentication request is already running.' };
    }
    busyRef.current = true;
    setBusy(true);
    const sequence = ++requestSequence.current;
    try {
      await apiLogout();
      if (sequence === requestSequence.current) setState({ status: 'anonymous' });
      return { ok: true };
    } catch (error) {
      const message = safeErrorMessage(error);
      if (sequence === requestSequence.current) {
        setState((current) =>
          current.status === 'authenticated'
            ? { ...current, error: message }
            : { status: 'unavailable', error: message },
        );
      }
      return { ok: false, error: message };
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  return { state, busy, refresh, signIn, signUp, signOut };
}

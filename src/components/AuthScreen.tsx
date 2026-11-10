import { useEffect, useState, type FormEvent } from 'react';
import { Rocket } from 'lucide-react';
import type { AuthActionResult, AuthState } from '../hooks/useAuth';
import {
  confirmPasswordReset,
  requestPasswordReset,
  resendVerification,
  verifyEmail,
} from '../data/apiClient';

type AuthMode =
  | 'login'
  | 'register'
  | 'verification-sent'
  | 'verify'
  | 'forgot'
  | 'reset';

interface AuthScreenProps {
  state: AuthState;
  busy: boolean;
  onLogin: (email: string, password: string) => Promise<AuthActionResult>;
  onRegister: (email: string, password: string) => Promise<AuthActionResult>;
  onRetry: () => Promise<void>;
}

const inputClass =
  'min-h-11 rounded-control border border-border bg-surface px-s3 text-base font-normal outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
const buttonClass =
  'min-h-11 rounded-control bg-accent px-s4 py-s2 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-60';
const linkClass =
  'font-semibold text-accent-dark underline underline-offset-2 hover:text-accent disabled:opacity-50';

export function AuthScreen({
  state,
  busy,
  onLogin,
  onRegister,
  onRetry,
}: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [linkToken, setLinkToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const isBusy = busy || actionBusy;

  useEffect(() => {
    const url = new URL(window.location.href);
    const fragmentParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    const verificationToken =
      fragmentParams.get('verifyEmail') ?? url.searchParams.get('verifyEmail');
    const resetToken =
      fragmentParams.get('resetPassword') ?? url.searchParams.get('resetPassword');

    if (verificationToken && resetToken) {
      setMode('login');
      setFormError('This account-action link is invalid. Open the latest email link and try again.');
    } else if (verificationToken) {
      setLinkToken(verificationToken);
      setMode('verify');
    } else if (resetToken) {
      setLinkToken(resetToken);
      setMode('reset');
    }

    if (verificationToken || resetToken) {
      // Remove one-time tokens before the page can load third-party resources
      // or the user copies the address. The token remains only in component memory.
      url.searchParams.delete('verifyEmail');
      url.searchParams.delete('resetPassword');
      fragmentParams.delete('verifyEmail');
      fragmentParams.delete('resetPassword');
      url.hash = fragmentParams.toString() ? fragmentParams.toString() : '';
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(window.history.state, '', nextUrl);
    }
  }, []);

  function changeMode(next: AuthMode) {
    setMode(next);
    setFormError(null);
    setStatusMessage(null);
    if (next !== 'reset') {
      setPassword('');
      setConfirmPassword('');
    }
  }

  async function handleVerifyEmail() {
    if (isBusy || !linkToken) return;
    setActionBusy(true);
    setFormError(null);
    setStatusMessage(null);
    try {
      const result = await verifyEmail(linkToken);
      setLinkToken('');
      setMode('login');
      setStatusMessage(result.message);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The verification link could not be used.');
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    setFormError(null);
    setStatusMessage(null);

    if (mode === 'login' || mode === 'register') {
      const result = mode === 'login'
        ? await onLogin(email, password)
        : await onRegister(email, password);

      if (!result.ok) {
        setFormError(result.error);
      } else if (mode === 'register') {
        setPassword('');
        setMode('verification-sent');
        setStatusMessage(
          result.message ??
            'If an account is eligible, verification instructions will be sent to its email address.',
        );
      }
      return;
    }

    setActionBusy(true);
    try {
      if (mode === 'verification-sent') {
        const result = await resendVerification(email);
        setStatusMessage(result.message);
      } else if (mode === 'forgot') {
        const result = await requestPasswordReset(email);
        setStatusMessage(result.message);
      } else if (mode === 'reset') {
        if (password !== confirmPassword) {
          setFormError('Passwords do not match.');
          return;
        }
        const result = await confirmPasswordReset(linkToken, password);
        setLinkToken('');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
        setStatusMessage(result.message);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The request could not be completed.');
    } finally {
      setActionBusy(false);
    }
  }

  const error = formError ?? (state.status === 'anonymous' ? state.error ?? null : null);

  const title =
    mode === 'login' ? 'Welcome back'
      : mode === 'register' ? 'Create your account'
        : mode === 'verification-sent' ? 'Check your email'
          : mode === 'verify' ? 'Verify your email'
            : mode === 'forgot' ? 'Reset your password'
              : 'Choose a new password';

  const description =
    mode === 'login'
      ? 'Sign in to access the opportunities stored in your account.'
      : mode === 'register'
        ? 'Create an account to keep your opportunities securely associated with you.'
        : mode === 'verification-sent'
          ? 'New accounts need a verified email address before you can sign in.'
          : mode === 'verify'
            ? 'Confirm that you own the email address used for this Launchboard account.'
            : mode === 'forgot'
              ? 'Enter your account email. If it is eligible, we will send a password-reset link.'
              : 'Choose a new password for your Launchboard account.';

  return (
    <main className="lb-auth-shell">
      <section className="lb-auth-promo" aria-hidden="true">
        <div className="lb-auth-brand">
          <span className="lb-auth-brand-mark">
            <Rocket size={20} strokeWidth={2.2} />
          </span>
          Launchboard
        </div>
        <div className="lb-auth-promo-copy">
          <span>YOUR NEXT MOVE STARTS HERE</span>
          <h2>Make every opportunity count.</h2>
          <p>
            Keep your applications, conversations and next steps in one focused workspace.
            Less time searching. More time moving forward.
          </p>
        </div>
        <span className="lb-auth-promo-foot">PLAN · TRACK · MOVE FORWARD</span>
      </section>

      <section className="lb-auth-card">
        <div className="mb-s5">
          <p className="lb-auth-eyebrow">PERSONAL OPPORTUNITY TRACKER</p>
          <h1 className="mb-s2 text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted">{description}</p>
        </div>

        {state.status === 'unavailable' ? (
          <div role="alert" className="rounded-control border border-border bg-bg p-s4">
            <p className="mb-s3 text-sm text-danger">{state.error}</p>
            <button
              type="button"
              className={buttonClass}
              disabled={isBusy}
              onClick={() => void onRetry()}
            >
              Retry connection
            </button>
          </div>
        ) : mode === 'verify' ? (
          <div className="grid gap-s4">
            <p className="text-sm text-muted">
              This link is single-use and expires after 24 hours. Opening this page does not verify the address; use the button below to confirm.
            </p>
            {error && (
              <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
                {error}
              </p>
            )}
            <button
              type="button"
              className={buttonClass}
              disabled={isBusy || !linkToken}
              onClick={() => void handleVerifyEmail()}
            >
              {isBusy ? 'Please wait…' : 'Verify email address'}
            </button>
          </div>
        ) : (
          <>
            {statusMessage && (
              <p role="status" className="mb-s4 rounded-control border border-border bg-bg p-s3 text-sm text-muted">
                {statusMessage}
              </p>
            )}

            <form className="grid gap-s4" onSubmit={(event) => void handleSubmit(event)}>
              {(mode === 'login' ||
                mode === 'register' ||
                mode === 'verification-sent' ||
                mode === 'forgot') && (
                <label className="grid gap-s1 text-sm font-medium" htmlFor="auth-email">
                  Email address
                  <input
                    id="auth-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={inputClass}
                  />
                </label>
              )}

              {(mode === 'login' || mode === 'register') && (
                <label className="grid gap-s1 text-sm font-medium" htmlFor="auth-password">
                  Password
                  <input
                    id="auth-password"
                    type="password"
                    name="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'register' ? 15 : undefined}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClass}
                  />
                </label>
              )}

              {mode === 'reset' && (
                <>
                  <label className="grid gap-s1 text-sm font-medium" htmlFor="auth-new-password">
                    New password
                    <input
                      id="auth-new-password"
                      type="password"
                      name="new-password"
                      autoComplete="new-password"
                      minLength={15}
                      maxLength={128}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-s1 text-sm font-medium" htmlFor="auth-confirm-password">
                    Confirm new password
                    <input
                      id="auth-confirm-password"
                      type="password"
                      name="confirm-password"
                      autoComplete="new-password"
                      minLength={15}
                      maxLength={128}
                      required
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className={inputClass}
                    />
                  </label>
                </>
              )}

              {mode === 'register' && (
                <p className="-mt-s2 text-xs text-muted">
                  Use at least 15 characters. Spaces and passphrases are supported.
                </p>
              )}

              {error && (
                <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
                  {error}
                </p>
              )}

              <button
                type="submit"
                className={buttonClass}
                disabled={isBusy || state.status === 'loading'}
              >
                {isBusy
                  ? 'Please wait…'
                  : mode === 'login' ? 'Sign in'
                    : mode === 'register' ? 'Create account'
                      : mode === 'verification-sent' ? 'Resend verification email'
                        : mode === 'forgot' ? 'Send reset link'
                          : 'Reset password'}
              </button>
            </form>
          </>
        )}

        <div className="mt-s5 flex flex-wrap items-center justify-center gap-x-s3 gap-y-s2 border-t border-border pt-s4 text-center text-sm text-muted">
          {mode === 'login' && (
            <>
              <button type="button" className={linkClass} disabled={isBusy} onClick={() => changeMode('forgot')}>
                Forgot password?
              </button>
              <button type="button" className={linkClass} disabled={isBusy} onClick={() => {
                changeMode('verification-sent');
                setStatusMessage('Enter your email address to request another verification link.');
              }}>
                Resend verification email
              </button>
              <span>·</span>
              <span>New to Launchboard?</span>
              <button type="button" className={linkClass} disabled={isBusy} onClick={() => changeMode('register')}>
                Create one
              </button>
            </>
          )}
          {mode === 'register' && (
            <>
              <span>Already have an account?</span>
              <button type="button" className={linkClass} disabled={isBusy} onClick={() => changeMode('login')}>
                Sign in
              </button>
            </>
          )}
          {mode !== 'login' && mode !== 'register' && (
            <button type="button" className={linkClass} disabled={isBusy} onClick={() => changeMode('login')}>
              Back to sign in
            </button>
          )}
        </div>

        <p className="mt-s5 text-center text-xs text-muted">
          Your sign-in session is held in a secure, HttpOnly browser cookie. Passwords and session tokens are not stored in localStorage.
        </p>
      </section>
    </main>
  );
}

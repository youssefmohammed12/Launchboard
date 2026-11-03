import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  confirmPasswordReset,
  requestPasswordReset,
  resendVerification,
  verifyEmail,
} from '../data/apiClient';
import { AuthScreen } from './AuthScreen';

vi.mock('../data/apiClient', () => ({
  confirmPasswordReset: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendVerification: vi.fn(),
  verifyEmail: vi.fn(),
}));

const anonymousState = { status: 'anonymous' as const };
const unavailableRetry = vi.fn(async () => undefined);

function renderScreen(onRegister = vi.fn(async () => ({
  ok: true as const,
  message: 'Check your email for verification instructions.',
}))) {
  const onLogin = vi.fn(async () => ({ ok: true as const }));
  return {
    ...render(
      <AuthScreen
        state={anonymousState}
        busy={false}
        onLogin={onLogin}
        onRegister={onRegister}
        onRetry={unavailableRetry}
      />,
    ),
    onLogin,
    onRegister,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('API-mode AuthScreen account actions', () => {
  it('captures a verification token, removes it from the address bar and waits for user confirmation', async () => {
    window.history.pushState({}, '', '/#verifyEmail=secret-verify-token&keep=1');
    vi.mocked(verifyEmail).mockResolvedValue({
      message: 'Email verified. You can now sign in.',
    });

    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeTruthy();
    expect(window.location.hash).toBe('#keep=1');
    expect(verifyEmail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Verify email address' }));

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('secret-verify-token'));
    expect(await screen.findByText('Email verified. You can now sign in.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('keeps registration anonymous and displays the verification instructions message', async () => {
    const { onRegister } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Create one' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'new@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-registration-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(
      'new@example.test',
      'a-long-registration-password',
    ));
    expect(await screen.findByText('Check your email for verification instructions.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeTruthy();
  });

  it('does not send a password reset when the two password entries differ', async () => {
    window.history.pushState({}, '', '/#resetPassword=secret-reset-token');
    renderScreen();

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-new-long-password-for-launchboard' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-different-long-password-for-launchboard' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('sends forgot-password requests without exposing account existence', async () => {
    vi.mocked(requestPasswordReset).mockResolvedValue({
      message: 'If an account is eligible, instructions will be sent to its email address.',
    });
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('person@example.test'));
    expect(await screen.findByText(
      'If an account is eligible, instructions will be sent to its email address.',
    )).toBeTruthy();
  });

  it('allows a verification email to be resent from the registration confirmation screen', async () => {
    vi.mocked(resendVerification).mockResolvedValue({
      message: 'If an account is eligible, instructions will be sent to its email address.',
    });
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Create one' }));
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'person@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-registration-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Check your email' });
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('person@example.test'));
  });
});

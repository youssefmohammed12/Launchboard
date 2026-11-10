import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountSettings } from './AccountSettings';

const mocks = vi.hoisted(() => ({
  getAccountProfile: vi.fn(),
  updateAccountProfile: vi.fn(),
  changeAccountPassword: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('../data/apiClient', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  getAccountProfile: mocks.getAccountProfile,
  updateAccountProfile: mocks.updateAccountProfile,
  changeAccountPassword: mocks.changeAccountPassword,
  deleteAccount: mocks.deleteAccount,
}));

const profile = {
  id: 'user-1',
  email: 'person@example.com',
  displayName: 'Youssef',
  emailVerified: true,
  createdAt: '2026-10-01T10:00:00.000Z',
};

beforeEach(() => {
  mocks.getAccountProfile.mockReset().mockResolvedValue({ profile });
  mocks.updateAccountProfile.mockReset().mockImplementation(async (displayName: string) => ({
    profile: { displayName },
  }));
  mocks.changeAccountPassword.mockReset().mockResolvedValue({
    message: 'Your password has been changed. Other active sessions were signed out.',
  });
  mocks.deleteAccount.mockReset().mockResolvedValue(undefined);
});

describe('AccountSettings', () => {
  it('loads the profile and saves the display name while keeping email read-only', async () => {
    const onDisplayNameChange = vi.fn();
    render(<AccountSettings onAccountDeleted={vi.fn()} onDisplayNameChange={onDisplayNameChange} />);

    const name = await screen.findByLabelText('Display name');
    expect(name).toHaveValue('Youssef');
    expect(screen.getByText('person@example.com')).toBeInTheDocument();
    expect(screen.queryByLabelText('Sign-in email')).not.toBeInTheDocument();

    fireEvent.change(name, { target: { value: 'Youssef Mohammed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(mocks.updateAccountProfile).toHaveBeenCalledWith('Youssef Mohammed');
    });
    expect(await screen.findByText('Your profile has been updated.')).toBeInTheDocument();
    expect(onDisplayNameChange).toHaveBeenCalledWith('Youssef Mohammed');
  });

  it('does not submit a password when confirmation differs', async () => {
    render(<AccountSettings onAccountDeleted={vi.fn()} onDisplayNameChange={vi.fn()} />);
    await screen.findByLabelText('Display name');

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-new-password-that-is-long-enough' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-different-long-password-value' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(mocks.changeAccountPassword).not.toHaveBeenCalled();
  });

  it('changes the password and clears the password fields after success', async () => {
    render(<AccountSettings onAccountDeleted={vi.fn()} onDisplayNameChange={vi.fn()} />);
    await screen.findByLabelText('Display name');

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'current-password' },
    });
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'a-new-password-that-is-long-enough' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'a-new-password-that-is-long-enough' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }));

    await waitFor(() => {
      expect(mocks.changeAccountPassword).toHaveBeenCalledWith(
        'current-password',
        'a-new-password-that-is-long-enough',
      );
    });
    expect(await screen.findByText(/Other active sessions were signed out/)).toBeInTheDocument();
    expect(screen.getByText(/Launchboard also attempts to send a security notification to your sign-in email/)).toBeInTheDocument();
    expect(screen.getByText(/check your Spam or Junk folder/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  it('requires the password and exact DELETE text before account deletion', async () => {
    const onAccountDeleted = vi.fn();
    const onDisplayNameChange = vi.fn();
    render(<AccountSettings onAccountDeleted={onAccountDeleted} onDisplayNameChange={onDisplayNameChange} />);
    await screen.findByLabelText('Display name');

    const submit = screen.getByRole('button', { name: 'Permanently delete account' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Re-enter your password'), {
      target: { value: 'current-password' },
    });
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith('current-password'));
    expect(onAccountDeleted).toHaveBeenCalledOnce();
  });

  it('does not enable deletion for case-insensitive or partial confirmation text', async () => {
    render(<AccountSettings onAccountDeleted={vi.fn()} onDisplayNameChange={vi.fn()} />);
    await screen.findByLabelText('Display name');

    fireEvent.change(screen.getByLabelText('Re-enter your password'), {
      target: { value: 'current-password' },
    });
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), {
      target: { value: 'delete' },
    });
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
    expect(mocks.deleteAccount).not.toHaveBeenCalled();
  });
});

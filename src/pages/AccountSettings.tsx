import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, KeyRound, LoaderCircle, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import {
  ApiRequestError,
  changeAccountPassword,
  deleteAccount,
  getAccountProfile,
  updateAccountProfile,
  type AccountProfile,
} from '../data/apiClient';

interface Props {
  onAccountDeleted: () => Promise<void>;
  onDisplayNameChange: (displayName: string) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function Notice({ children, tone = 'success' }: { children: string; tone?: 'success' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={tone === 'error'
        ? 'mt-s3 rounded-control border border-danger/30 bg-danger/5 px-s3 py-s2 text-sm text-danger'
        : 'mt-s3 rounded-control border border-accent/30 bg-accent-soft px-s3 py-s2 text-sm text-accent-dark'}
    >
      {children}
    </p>
  );
}

export function AccountSettings({ onAccountDeleted, onDisplayNameChange }: Props) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadProfile() {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const result = await getAccountProfile();
      setProfile(result.profile);
      setDisplayName(result.profile.displayName);
    } catch (error) {
      setProfileError(errorMessage(error, 'Your account details could not be loaded.'));
    } finally {
      setProfileLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void getAccountProfile().then((result) => {
      if (!active) return;
      setProfile(result.profile);
      setDisplayName(result.profile.displayName);
    }).catch((error: unknown) => {
      if (active) setProfileError(errorMessage(error, 'Your account details could not be loaded.'));
    }).finally(() => {
      if (active) setProfileLoading(false);
    });
    return () => { active = false; };
  }, []);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const result = await updateAccountProfile(displayName.trim());
      setDisplayName(result.profile.displayName);
      onDisplayNameChange(result.profile.displayName);
      setProfile((current) => current
        ? { ...current, displayName: result.profile.displayName }
        : current);
      setProfileMessage('Your profile has been updated.');
    } catch (error) {
      setProfileError(errorMessage(error, 'Your profile could not be saved. Try again.'));
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy) return;
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError('The new password and confirmation do not match.');
      return;
    }
    if ([...newPassword].length < 15) {
      setPasswordError('Your new password must contain at least 15 characters.');
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await changeAccountPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage(result.message);
    } catch (error) {
      setPasswordError(errorMessage(error, 'Your password could not be changed. Try again.'));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function removeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteBusy || deleteConfirmation !== 'DELETE' || !deletePassword) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteAccount(deletePassword);
      await onAccountDeleted();
    } catch (error) {
      setDeleteError(errorMessage(error, 'Your account could not be deleted. Try again.'));
      setDeleteBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-s5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">ACCOUNT</p>
        <h1 className="mt-s1 text-2xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-s2 max-w-2xl text-sm leading-6 text-muted">
          Manage your Launchboard profile and sign-in security.
        </p>
      </div>

      <section className="rounded-card border border-border bg-surface p-s4 shadow-sm sm:p-s5" aria-labelledby="profile-heading">
        <div className="flex items-start gap-s3">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
            <UserRound size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 id="profile-heading" className="font-semibold text-ink">Profile</h2>
            <p className="mt-1 text-sm text-muted">Update the name shown in your Launchboard account.</p>
          </div>
        </div>

        {profileLoading ? (
          <p className="mt-s4 flex items-center gap-s2 text-sm text-muted" role="status">
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Loading account details…
          </p>
        ) : profileError && !profile ? (
          <div className="mt-s4">
            <Notice tone="error">{profileError}</Notice>
            <button type="button" className="mt-s3 min-h-10 rounded-control border border-border px-s3 text-sm font-semibold text-ink hover:bg-bg" onClick={() => void loadProfile()}>
              Retry
            </button>
          </div>
        ) : (
          <form className="mt-s4 space-y-s4" onSubmit={saveProfile}>
            <div>
              <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="account-display-name">Display name</label>
              <input
                id="account-display-name"
                className="min-h-11 w-full max-w-lg rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                autoComplete="name"
                placeholder="Your name"
              />
              <p className="mt-s1 text-xs text-muted">Up to 80 characters. You can leave this blank.</p>
            </div>
            <div>
              <span className="mb-s1 block text-sm font-medium text-ink">Sign-in email</span>
              <div className="flex min-h-11 max-w-lg flex-wrap items-center justify-between gap-s2 rounded-control border border-border bg-bg px-s3 py-s2">
                <span className="break-all text-sm text-ink">{profile?.email}</span>
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <ShieldCheck size={14} aria-hidden="true" />
                  {profile?.emailVerified ? 'Verified' : 'Not verified'}
                </span>
              </div>
              <p className="mt-s1 text-xs text-muted">Email changes are not available yet. Your sign-in address remains unchanged.</p>
            </div>
            {profileError && <Notice tone="error">{profileError}</Notice>}
            {profileMessage && <Notice>{profileMessage}</Notice>}
            <button type="submit" disabled={profileBusy || displayName.trim() === (profile?.displayName ?? '')} className="inline-flex min-h-10 items-center gap-s2 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50">
              {profileBusy && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
              {profileBusy ? 'Saving…' : 'Save profile'}
            </button>
          </form>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-s4 shadow-sm sm:p-s5" aria-labelledby="password-heading">
        <div className="flex items-start gap-s3">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent">
            <KeyRound size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 id="password-heading" className="font-semibold text-ink">Change password</h2>
            <p className="mt-1 text-sm text-muted">Confirm your current password before choosing a new one.</p>
          </div>
        </div>
        <form className="mt-s4 max-w-lg space-y-s3" onSubmit={savePassword}>
          <div>
            <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="current-password">Current password</label>
            <input id="current-password" type="password" autoComplete="current-password" required maxLength={256} className="min-h-11 w-full rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          </div>
          <div>
            <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={256} className="min-h-11 w-full rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <p className="mt-s1 text-xs text-muted">At least 15 characters. A longer passphrase is recommended.</p>
          </div>
          <div>
            <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="confirm-new-password">Confirm new password</label>
            <input id="confirm-new-password" type="password" autoComplete="new-password" required minLength={15} maxLength={256} className="min-h-11 w-full rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </div>
          {passwordError && <Notice tone="error">{passwordError}</Notice>}
          {passwordMessage && <Notice>{passwordMessage}</Notice>}
          <button type="submit" disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword} className="inline-flex min-h-10 items-center gap-s2 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50">
            {passwordBusy && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
            {passwordBusy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </section>

      <section className="rounded-card border border-danger/30 bg-surface p-s4 shadow-sm sm:p-s5" aria-labelledby="delete-account-heading">
        <div className="flex items-start gap-s3">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-danger/10 text-danger">
            <Trash2 size={19} aria-hidden="true" />
          </span>
          <div>
            <h2 id="delete-account-heading" className="font-semibold text-ink">Delete account</h2>
            <p className="mt-1 text-sm leading-6 text-muted">Permanently remove your Launchboard account and all data stored under it.</p>
          </div>
        </div>

        <div className="mt-s4 rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
          <p className="flex items-center gap-s2 font-semibold">
            <AlertTriangle size={16} aria-hidden="true" /> This action cannot be undone.
          </p>
          <p className="mt-s1 leading-6">All opportunities, notes, activity history, interviews, contacts, materials, tasks, and active sessions will be deleted. Export a backup from Reports before continuing.</p>
        </div>

        <form className="mt-s4 max-w-lg space-y-s3" onSubmit={removeAccount}>
          <div>
            <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="delete-account-password">Re-enter your password</label>
            <input id="delete-account-password" type="password" autoComplete="current-password" required maxLength={256} className="min-h-11 w-full rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-danger focus:ring-2 focus:ring-danger/20" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
          </div>
          <div>
            <label className="mb-s1 block text-sm font-medium text-ink" htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
            <input id="delete-account-confirmation" required maxLength={6} autoComplete="off" className="min-h-11 w-full rounded-control border border-border bg-bg px-s3 text-sm text-ink outline-none focus:border-danger focus:ring-2 focus:ring-danger/20" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
          </div>
          {deleteError && <Notice tone="error">{deleteError}</Notice>}
          <button type="submit" disabled={deleteBusy || !deletePassword || deleteConfirmation !== 'DELETE'} className="inline-flex min-h-10 items-center gap-s2 rounded-control bg-danger px-s4 text-sm font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50">
            {deleteBusy && <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />}
            {deleteBusy ? 'Deleting account…' : 'Permanently delete account'}
          </button>
        </form>
      </section>
    </div>
  );
}

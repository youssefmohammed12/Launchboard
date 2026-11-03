import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import {
  HttpOpportunityRepository,
  type OpportunityCollection,
  type BackupImportResult,
} from '../data/httpOpportunityRepository';
import { ApiRequestError } from '../data/apiClient';
import {
  completeLocalMigration,
  finalizeLocalMigration,
  LocalMigrationError,
  previewLocalMigration,
  type LocalMigrationPreview,
} from '../data/localMigration';
import { opportunityRepository } from '../data/opportunityRepository';
import { downloadJsonBackup } from '../utils/exports';

interface LocalMigrationDialogProps {
  repository: HttpOpportunityRepository;
  userId: string;
  onClose: () => void;
  onImported: (collection: OpportunityCollection) => void;
}

type MigrationMode = 'merge' | 'replace';

function messageFor(error: unknown): string {
  if (error instanceof LocalMigrationError || error instanceof ApiRequestError) {
    return error.message;
  }
  return 'The migration could not be completed. Your local records have not been deleted.';
}

export function LocalMigrationDialog({
  repository,
  userId,
  onClose,
  onImported,
}: LocalMigrationDialogProps) {
  const localSnapshot = useMemo(() => opportunityRepository.load(), []);
  const [mode, setMode] = useState<MigrationMode>('merge');
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [preview, setPreview] = useState<LocalMigrationPreview | null>(null);
  const [appliedResult, setAppliedResult] = useState<BackupImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  const [markerFailed, setMarkerFailed] = useState(false);

  const recoveryNeedsAttention =
    localSnapshot.recovery.kind !== 'none' || localSnapshot.recovery.writesBlocked;

  function downloadSafetyBackup() {
    try {
      downloadJsonBackup(localSnapshot.items);
      setBackupDownloaded(true);
      setError(null);
    } catch {
      setError('The local safety backup could not be generated. No data was sent to the server.');
    }
  }

  async function previewImport() {
    if (busy || recoveryNeedsAttention) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setAppliedResult(null);
    try {
      const result = await previewLocalMigration(
        userId,
        localSnapshot.items,
        mode,
        repository,
      );
      setPreview(result);
    } catch (previewError) {
      setError(messageFor(previewError));
    } finally {
      setBusy(false);
    }
  }

  function handleFinalizationError(finalizationError: unknown) {
    setError(messageFor(finalizationError));
    if (!(finalizationError instanceof LocalMigrationError)) return;

    if (
      finalizationError.code === 'IMPORT_SUCCEEDED_RELOAD_FAILED' &&
      finalizationError.importResult
    ) {
      setAppliedResult(finalizationError.importResult);
      setReloadFailed(true);
    } else if (
      finalizationError.code === 'MIGRATION_MARKER_FAILED' &&
      finalizationError.importResult
    ) {
      setAppliedResult(finalizationError.importResult);
      if (finalizationError.collection) {
        onImported(finalizationError.collection);
      }
      setMarkerFailed(true);
    }
  }

  async function applyImport() {
    if (!preview || busy || appliedResult) return;
    if (mode === 'replace' && !replaceConfirmed) return;

    setBusy(true);
    setError(null);
    try {
      const completed = await completeLocalMigration(preview, repository);
      onImported(completed.collection);
      onClose();
    } catch (importError) {
      handleFinalizationError(importError);
    } finally {
      setBusy(false);
    }
  }

  async function retryAfterImport() {
    if (!preview || !appliedResult || busy) return;
    setBusy(true);
    setError(null);
    try {
      const completed = await finalizeLocalMigration(preview, appliedResult, repository);
      onImported(completed.collection);
      setReloadFailed(false);
      setMarkerFailed(false);
      onClose();
    } catch (finalizationError) {
      handleFinalizationError(finalizationError);
    } finally {
      setBusy(false);
    }
  }

  const canPreview =
    backupDownloaded &&
    backupAcknowledged &&
    !recoveryNeedsAttention &&
    !busy &&
    !appliedResult;

  return (
    <Modal title="Move local opportunities to your account" onClose={onClose} closeDisabled={busy}>
      <div className="grid gap-s4 p-s4 sm:p-s5">
        {recoveryNeedsAttention ? (
          <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s4 text-sm">
            <p className="font-semibold text-danger">Resolve local recovery first</p>
            <p className="mt-s1 text-muted">
              Local recovery state is present ({localSnapshot.recovery.kind}). Switch back to local mode and resolve or download the recovery copy before migrating. No records have been sent.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-control border border-border bg-bg p-s4">
              <p className="font-semibold">Local safety copy</p>
              <p className="mt-s1 text-sm text-muted">
                {localSnapshot.items.length} local opportunity{localSnapshot.items.length === 1 ? '' : 'ies'} will be prepared as a version-1 backup. This does not change or remove the local records.
              </p>
              <button
                type="button"
                className="mt-s3 min-h-10 rounded-control border border-border bg-surface px-s3 text-sm font-semibold hover:bg-bg disabled:opacity-60"
                disabled={busy || appliedResult !== null}
                onClick={downloadSafetyBackup}
              >
                Download local safety backup
              </button>
              {backupDownloaded && (
                <label className="mt-s3 flex items-start gap-s2 text-sm">
                  <input
                    type="checkbox"
                    checked={backupAcknowledged}
                    disabled={busy || appliedResult !== null}
                    onChange={(event) => setBackupAcknowledged(event.target.checked)}
                    className="mt-1"
                  />
                  <span>I have saved the downloaded backup somewhere safe.</span>
                </label>
              )}
            </div>

            <fieldset className="grid gap-s2" disabled={busy || appliedResult !== null}>
              <legend className="mb-s1 text-sm font-semibold">How should the server data be handled?</legend>
              <label className="flex cursor-pointer items-start gap-s2 rounded-control border border-border p-s3">
                <input
                  type="radio"
                  name="migration-mode"
                  value="merge"
                  checked={mode === 'merge'}
                  onChange={() => {
                    setMode('merge');
                    setPreview(null);
                    setReplaceConfirmed(false);
                  }}
                  className="mt-1"
                />
                <span className="grid gap-1">
                  <span className="text-sm font-semibold">Merge (recommended)</span>
                  <span className="text-xs text-muted">
                    Add local IDs that do not already exist on the server. Existing server records are never overwritten.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-s2 rounded-control border border-border p-s3">
                <input
                  type="radio"
                  name="migration-mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => {
                    setMode('replace');
                    setPreview(null);
                    setReplaceConfirmed(false);
                  }}
                  className="mt-1"
                />
                <span className="grid gap-1">
                  <span className="text-sm font-semibold">Replace server data</span>
                  <span className="text-xs text-muted">
                    Replace all current server opportunities with the local backup. This is destructive to server data and requires a separate confirmation.
                  </span>
                </span>
              </label>
            </fieldset>

            {mode === 'replace' && (
              <label className="flex items-start gap-s2 rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  disabled={busy || appliedResult !== null}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                  className="mt-1"
                />
                <span>
                  I understand that Replace removes all existing server opportunities, including archived records and deletion Undo batches.
                </span>
              </label>
            )}

            {!preview && (
              <button
                type="button"
                className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canPreview}
                onClick={() => void previewImport()}
              >
                {busy ? 'Preparing preview…' : 'Preview server import'}
              </button>
            )}

            {preview && (
              <div className="rounded-control border border-border bg-bg p-s4" aria-live="polite">
                <p className="font-semibold">Server dry-run preview</p>
                <dl className="mt-s3 grid grid-cols-2 gap-x-s4 gap-y-s2 text-sm">
                  <div><dt className="text-muted">Local records</dt><dd className="font-semibold">{preview.result.totalRecords}</dd></div>
                  <div><dt className="text-muted">Valid records</dt><dd className="font-semibold">{preview.result.validRecords}</dd></div>
                  <div><dt className="text-muted">Will be added</dt><dd className="font-semibold">{preview.result.added}</dd></div>
                  <div><dt className="text-muted">Already on server</dt><dd className="font-semibold">{preview.result.skippedExisting}</dd></div>
                  <div><dt className="text-muted">Repaired</dt><dd className="font-semibold">{preview.result.repairedRecords}</dd></div>
                  <div><dt className="text-muted">Invalid / duplicates</dt><dd className="font-semibold">{preview.result.invalidRecords + preview.result.duplicateRecords}</dd></div>
                  <div><dt className="text-muted">Final server count</dt><dd className="font-semibold">{preview.result.finalCount}</dd></div>
                  <div><dt className="text-muted">Server revision</dt><dd className="font-semibold">{preview.expectedRevision}</dd></div>
                </dl>
                {preview.result.skipped.length > 0 && (
                  <details className="mt-s3 text-sm">
                    <summary className="cursor-pointer font-medium">Review skipped records ({preview.result.skipped.length})</summary>
                    <ul className="mt-s2 grid max-h-36 gap-s1 overflow-auto pl-s4 text-xs text-muted">
                      {preview.result.skipped.slice(0, 30).map((item, index) => (
                        <li key={`${item.index}-${index}`}>
                          {item.id ?? `Record ${item.index + 1}`}: {item.reason}
                        </li>
                      ))}
                    </ul>
                    {preview.result.skipped.length > 30 && (
                      <p className="mt-s2 text-xs text-muted">Only the first 30 skipped records are shown.</p>
                    )}
                  </details>
                )}
                <div className="mt-s4 flex flex-wrap gap-s2">
                  <button
                    type="button"
                    className="min-h-10 rounded-control border border-border bg-surface px-s3 text-sm font-semibold hover:bg-bg disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void previewImport()}
                  >
                    Refresh preview
                  </button>
                  <button
                    type="button"
                    className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={busy || (mode === 'replace' && !replaceConfirmed)}
                    onClick={() => void applyImport()}
                  >
                    {busy ? 'Importing…' : mode === 'replace' ? 'Confirm replace and import' : 'Import local records'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {appliedResult && reloadFailed && (
          <button
            type="button"
            className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50"
            disabled={busy}
            onClick={() => void retryAfterImport()}
          >
            Retry server reload
          </button>
        )}
        {appliedResult && markerFailed && (
          <button
            type="button"
            className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50"
            disabled={busy}
            onClick={() => void retryAfterImport()}
          >
            Retry migration completion marker
          </button>
        )}

        {error && <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">{error}</p>}

        <div className="border-t border-border pt-s3 text-xs text-muted">
          Your localStorage records and recovery keys are never deleted by this migration. Migration is complete only after the imported server collection has been reloaded successfully and its account-scoped completion marker has been saved.
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { LaunchboardBackup } from '../utils/exports';
import {
  MAX_BACKUP_BYTES,
  parseImportFile,
  type ImportMode,
  type ParsedBackup,
} from '../utils/backup';
import {
  type HttpOpportunityRepository,
  type BackupImportResult,
  type OpportunityCollection,
} from '../data/httpOpportunityRepository';
import { ApiRequestError } from '../data/apiClient';
import { Modal } from './Modal';

interface Props {
  repository: HttpOpportunityRepository;
  opener?: HTMLElement | null;
  fallbackFocusId?: string;
  onClose: () => void;
  onImported: (collection: OpportunityCollection) => void;
  onUnauthorized?: () => void | Promise<void>;
}

type Step = 'select' | 'preview' | 'confirm-replace';

const MAX_BACKUP_MB = MAX_BACKUP_BYTES / (1024 * 1024);

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The backup could not be read.'));
    reader.onabort = () => reject(new Error('Reading the backup was interrupted.'));
    reader.readAsText(file);
  });
}

function messageFor(error: unknown): string {
  return error instanceof ApiRequestError
    ? error.message
    : 'The backup operation could not be completed. Your account data was not intentionally changed.';
}

export function ApiBackupImportDialog({
  repository,
  opener,
  fallbackFocusId,
  onClose,
  onImported,
  onUnauthorized,
}: Props) {
  const [fileName, setFileName] = useState('');
  const [backup, setBackup] = useState<LaunchboardBackup | null>(null);
  const [parseSummary, setParseSummary] = useState<ParsedBackup | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [step, setStep] = useState<Step>('select');
  const [preview, setPreview] = useState<BackupImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [appliedResult, setAppliedResult] = useState<BackupImportResult | null>(null);
  const [reloadFailed, setReloadFailed] = useState(false);
  const mountedRef = useRef(true);
  const readSequence = useRef(0);
  const previewSequence = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      readSequence.current += 1;
      previewSequence.current += 1;
    };
  }, []);

  async function previewImport(nextMode: ImportMode, nextBackup: LaunchboardBackup) {
    const sequence = ++previewSequence.current;
    setBusy(true);
    setError(null);
    setPreview(null);
    setReplaceConfirmed(false);
    try {
      const result = await repository.importBackup({
        mode: nextMode,
        backup: nextBackup,
        dryRun: true,
      });
      if (!mountedRef.current || sequence !== previewSequence.current) return;
      setPreview(result);
      setStep('preview');
    } catch (previewError) {
      if (!mountedRef.current || sequence !== previewSequence.current) return;
      if (previewError instanceof ApiRequestError && previewError.status === 401) await onUnauthorized?.();
      if (!mountedRef.current) return;
      setError(messageFor(previewError));
    } finally {
      if (mountedRef.current && sequence === previewSequence.current) setBusy(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    const sequence = ++readSequence.current;
    previewSequence.current += 1;
    setFileName(file?.name ?? '');
    setBackup(null);
    setParseSummary(null);
    setPreview(null);
    setStep('select');
    setError(null);
    setReplaceConfirmed(false);
    setAppliedResult(null);
    setReloadFailed(false);

    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setError(`This file is too large. Choose a Launchboard backup smaller than ${MAX_BACKUP_MB} MB.`);
      return;
    }

    setBusy(true);
    try {
      const text = await readFileText(file);
      if (!mountedRef.current || sequence !== readSequence.current) return;
      const parsed = parseImportFile(text, file.name);
      if (!parsed.ok) {
        setError(parsed.error.message);
        setBusy(false);
        return;
      }

      // Keep the original JSON payload, or the converted CSV envelope, for the
      // server dry-run so server-side repair/skip counts remain authoritative.
      setBackup(parsed.envelope);
      setParseSummary(parsed.backup);
      setMode('merge');
      setBusy(false);
      await previewImport('merge', parsed.envelope);
    } catch {
      if (!mountedRef.current || sequence !== readSequence.current) return;
      setError('The selected backup could not be read. Choose another file and try again.');
      setBusy(false);
    }
  }

  async function handleModeChange(nextMode: ImportMode) {
    setMode(nextMode);
    setStep('preview');
    setReplaceConfirmed(false);
    if (backup) await previewImport(nextMode, backup);
  }

  async function applyImport() {
    if (!backup || !preview || busy || appliedResult) return;
    if (mode === 'merge' && preview.added === 0) return;
    if (mode === 'replace' && (step !== 'confirm-replace' || !replaceConfirmed)) return;

    setBusy(true);
    setError(null);
    try {
      const result = await repository.importBackup({
        mode,
        backup,
        ...(mode === 'replace'
          ? { confirmReplace: true, expectedRevision: preview.revision }
          : {}),
      });
      if (!mountedRef.current) return;
      setAppliedResult(result);
      try {
        const collection = await repository.load('all');
        if (!mountedRef.current) return;
        onImported(collection);
        onClose();
      } catch {
        if (!mountedRef.current) return;
        setReloadFailed(true);
        setError('The import succeeded, but the account could not be refreshed. Retry the refresh below; do not import the file again.');
      }
    } catch (importError) {
      if (!mountedRef.current) return;
      if (importError instanceof ApiRequestError && importError.status === 401) await onUnauthorized?.();
      if (!mountedRef.current) return;
      if (importError instanceof ApiRequestError && importError.status === 409) {
        setPreview(null);
        setStep('preview');
        setError('The server data changed after this preview. Review a fresh preview before applying the backup again.');
      } else {
        setError(messageFor(importError));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  async function retryReload() {
    if (!appliedResult || busy) return;
    setBusy(true);
    setError(null);
    try {
      const collection = await repository.load('all');
      if (!mountedRef.current) return;
      onImported(collection);
      onClose();
    } catch (reloadError) {
      if (reloadError instanceof ApiRequestError && reloadError.status === 401) await onUnauthorized?.();
      if (mountedRef.current) setError(messageFor(reloadError));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  const canReplace = Boolean(preview && (preview.validRecords > 0 || preview.totalRecords === 0));

  return (
    <Modal
      title="Import opportunities to your account"
      onClose={onClose}
      opener={opener}
      fallbackFocusId={fallbackFocusId}
      initialFocusId="api-backup-file"
      closeDisabled={busy}
    >
      <div className="grid gap-s4 p-s4 sm:p-s5">
        {appliedResult ? (
          <section role="status" className="grid gap-s3">
            <h3 className="m-0">Backup imported</h3>
            <p className="m-0 text-sm text-muted">
              {appliedResult.added} added · {appliedResult.skippedExisting} already existed · {appliedResult.replaced} replaced.
            </p>
            {reloadFailed && (
              <>
                <p role="alert" className="text-sm text-danger">{error}</p>
                <button
                  type="button"
                  className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void retryReload()}
                >
                  {busy ? 'Refreshing…' : 'Retry account refresh'}
                </button>
              </>
            )}
          </section>
        ) : (
          <>
            <div className="grid gap-s1">
              <label htmlFor="api-backup-file" className="font-semibold text-sm">CSV spreadsheet or Launchboard JSON backup</label>
              <input
                id="api-backup-file"
                type="file"
                accept=".csv,text/csv,.json,application/json"
                disabled={busy}
                onChange={(event) => void handleFileChange(event)}
                className="w-full rounded-control border border-border bg-surface px-s3 py-[9px] text-sm"
              />
              <p className="m-0 text-xs text-muted">
                CSV imports bring in tabular fields only. Use a version-1 JSON backup for a full-fidelity restore. Maximum size: {MAX_BACKUP_MB} MB.
              </p>
              {fileName && <p className="m-0 break-all text-xs text-muted">Selected: {fileName}</p>}
            </div>

            {parseSummary && (
              <p className="m-0 text-xs text-muted">
                Client validation: {parseSummary.validRecords} valid, {parseSummary.repairedRecords} repairable, {parseSummary.invalidRecords} invalid, {parseSummary.duplicateRecords} duplicate records. The server preview below is authoritative.
              </p>
            )}

            {preview && (
              <section className="grid gap-s3 rounded-control border border-border bg-bg p-s4" aria-labelledby="api-backup-preview">
                <div>
                  <h3 id="api-backup-preview" className="m-0">Server import preview</h3>
                  <p className="mt-s1 text-xs text-muted">Based on server revision {preview.revision}.</p>
                </div>
                <label className="grid gap-s1 text-sm font-medium">
                  Import mode
                  <select
                    value={mode}
                    disabled={busy}
                    onChange={(event) => void handleModeChange(event.target.value as ImportMode)}
                    className="min-h-10 rounded-control border border-border bg-surface px-s3"
                  >
                    <option value="merge">Merge — keep existing records</option>
                    <option value="replace">Replace — replace account records</option>
                  </select>
                </label>
                <dl className="grid grid-cols-2 gap-s2 text-sm sm:grid-cols-3">
                  <div><dt className="text-muted">Valid</dt><dd className="m-0 font-semibold">{preview.validRecords}</dd></div>
                  <div><dt className="text-muted">Added</dt><dd className="m-0 font-semibold">{preview.added}</dd></div>
                  <div><dt className="text-muted">Already existed</dt><dd className="m-0 font-semibold">{preview.skippedExisting}</dd></div>
                  <div><dt className="text-muted">Invalid</dt><dd className="m-0 font-semibold">{preview.invalidRecords}</dd></div>
                  <div><dt className="text-muted">Duplicates</dt><dd className="m-0 font-semibold">{preview.duplicateRecords}</dd></div>
                  <div><dt className="text-muted">Final count</dt><dd className="m-0 font-semibold">{preview.finalCount}</dd></div>
                </dl>
                {preview.skipped.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-semibold">Review skipped records ({preview.skipped.length})</summary>
                    <ul className="mt-s2 grid max-h-36 gap-s1 overflow-auto pl-s4">
                      {preview.skipped.map((record) => (
                        <li key={record.index}>Record {record.index + 1}: {record.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {mode === 'replace' && (
                  <p className="m-0 rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
                    Replacement removes all current opportunities in this account before importing the valid backup records.
                  </p>
                )}
              </section>
            )}

            {step === 'confirm-replace' && preview && mode === 'replace' && (
              <label className="flex items-start gap-s2 text-sm">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  disabled={busy}
                  onChange={(event) => setReplaceConfirmed(event.target.checked)}
                />
                <span>I understand this replaces all current account opportunities using the previewed server revision.</span>
              </label>
            )}

            {error && <p role="alert" className="m-0 rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">{error}</p>}

            <div className="flex flex-wrap justify-end gap-s2">
              <button type="button" className="min-h-10 rounded-control border border-border px-s4 text-sm font-semibold" disabled={busy} onClick={onClose}>Cancel</button>
              {preview && mode === 'replace' && step !== 'confirm-replace' && (
                <button
                  type="button"
                  className="min-h-10 rounded-control border border-danger bg-danger px-s4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy || !canReplace}
                  onClick={() => setStep('confirm-replace')}
                >
                  Review replacement
                </button>
              )}
              {preview && mode === 'merge' && (
                <button
                  type="button"
                  className="min-h-10 rounded-control bg-accent px-s4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy || preview.added === 0}
                  onClick={() => void applyImport()}
                >
                  {busy ? 'Importing…' : `Import ${preview.added} new records`}
                </button>
              )}
              {preview && mode === 'replace' && step === 'confirm-replace' && (
                <button
                  type="button"
                  className="min-h-10 rounded-control bg-danger px-s4 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={busy || !replaceConfirmed || !canReplace}
                  onClick={() => void applyImport()}
                >
                  {busy ? 'Replacing…' : 'Replace account records'}
                </button>
              )}
              {!preview && backup && !busy && (
                <button type="button" className="min-h-10 rounded-control border border-border px-s4 text-sm font-semibold" onClick={() => void previewImport(mode, backup)}>
                  Retry preview
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

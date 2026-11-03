import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Opportunity } from '../types/opportunity';
import {
  MAX_BACKUP_BYTES,
  parseImportFile,
  planImport,
  type BackupParseResult,
  type ImportMode,
  type ParsedBackup,
  type RestoreOutcome,
} from '../utils/backup';
import { Modal } from './Modal';

interface Props {
  currentItems: Opportunity[];
  /** The control that opened this dialog, recorded explicitly for focus restore. */
  opener?: HTMLElement | null;
  /** Id of the element to focus when the opener is gone. */
  fallbackFocusId?: string;
  onClose: () => void;
  onRestore: (backup: ParsedBackup, mode: ImportMode) => RestoreOutcome;
}

type Step = 'select' | 'preview' | 'confirm-replace';

const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text hover:border-[#c9c4b9]';
const dangerButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-danger bg-danger px-s4 py-[9px] font-medium text-white hover:bg-[#9c2f25] disabled:cursor-not-allowed disabled:opacity-50';
const fieldClass = 'grid gap-s1';
const labelClass = 'font-semibold text-[0.88rem]';
const helpClass = 'm-0 text-[0.8rem] text-muted';
const errorClass =
  'm-0 mt-s2 rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.85rem] text-danger';
const warningClass =
  'm-0 mt-s3 rounded-control border border-warn bg-status-interview px-s3 py-s2 text-[0.85rem] text-warn';
const summaryClass =
  'mt-s4 rounded-control border border-border bg-table-head p-s3 text-[0.88rem] [overflow-wrap:anywhere]';

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

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function RestoreBackupDialog({
  currentItems,
  opener,
  fallbackFocusId,
  onClose,
  onRestore,
}: Props) {
  const [fileName, setFileName] = useState('');
  const [parseResult, setParseResult] = useState<BackupParseResult | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [step, setStep] = useState<Step>('select');
  const [readError, setReadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const readSequence = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (step === 'preview') previewHeadingRef.current?.focus();
    if (step === 'confirm-replace') confirmHeadingRef.current?.focus();
  }, [step]);

  const backup = parseResult?.ok ? parseResult.backup : null;

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Allow re-selecting the same file after a failed attempt.
    event.target.value = '';
    const sequence = ++readSequence.current;

    setIsReading(false);
    setParseResult(null);
    setStep('select');
    setReadError(null);
    setApplyError(null);
    setConfirmed(false);
    setMode('merge');

    if (!file) {
      setFileName('');
      return;
    }

    setFileName(file.name);
    if (file.size > MAX_BACKUP_BYTES) {
      setReadError(
        `This file is too large. Choose a Launchboard backup smaller than ${MAX_BACKUP_MB} MB.`,
      );
      return;
    }

    setIsReading(true);
    try {
      const text = await readFileText(file);
      if (!mountedRef.current || sequence !== readSequence.current) return;
      const result = parseImportFile(text, file.name);
      if (!result.ok) {
        setReadError(result.error.message);
        return;
      }
      setParseResult({ ok: true, backup: result.backup });
      setStep('preview');
    } catch {
      if (!mountedRef.current || sequence !== readSequence.current) return;
      setReadError('The selected file could not be read. Try again or choose another file.');
    } finally {
      if (mountedRef.current && sequence === readSequence.current) setIsReading(false);
    }
  };

  const handleModeChange = (nextMode: ImportMode) => {
    setMode(nextMode);
    setConfirmed(false);
    setApplyError(null);
  };

  const handleMerge = () => {
    if (!backup) return;
    setApplyError(null);
    const outcome = onRestore(backup, 'merge');
    if (!outcome.ok && mountedRef.current) setApplyError(outcome.message);
  };

  const handleReplace = () => {
    if (!backup || !confirmed) return;
    setApplyError(null);
    const outcome = onRestore(backup, 'replace');
    if (!outcome.ok && mountedRef.current) setApplyError(outcome.message);
  };

  const plan = backup ? planImport(currentItems, backup, mode) : null;
  const canReplace = backup ? backup.totalRecords === 0 || backup.validRecords > 0 : false;
  const primaryDisabled = !plan || (mode === 'merge' ? plan.added === 0 : !canReplace);
  const primaryLabel = !plan
    ? 'Continue'
    : mode === 'merge'
      ? plan.added > 0
        ? `Add ${countLabel(plan.added, 'record')}`
        : 'Nothing to add'
      : canReplace
        ? 'Review replacement'
        : 'Replacement unavailable';

  return (
    <Modal
      title="Import opportunities"
      onClose={onClose}
      initialFocusId="restore-file"
      opener={opener}
      fallbackFocusId={fallbackFocusId}
    >
      <div className="px-s5 pt-s4 pb-s5">
        <div className={fieldClass}>
          <label htmlFor="restore-file" className={labelClass}>
            CSV or JSON file
          </label>
          <input
            id="restore-file"
            type="file"
            accept=".csv,text/csv,.json,application/json"
            onChange={handleFileChange}
            disabled={isReading}
            aria-describedby={readError ? 'restore-file-help restore-file-error' : 'restore-file-help'}
            className="w-full cursor-pointer rounded-control border border-border bg-surface px-s3 py-[9px] text-inherit [font:inherit] file:mr-s3 file:cursor-pointer file:rounded-control file:border-0 file:bg-accent-soft file:px-s3 file:py-[6px] file:font-medium file:text-accent-dark"
          />
          <p id="restore-file-help" className={helpClass}>
            Choose a CSV spreadsheet or a Launchboard JSON backup (schema version 1). CSV imports contain tabular fields only; use JSON for a full-fidelity restore. Maximum file size: {MAX_BACKUP_MB} MB.
          </p>
          {fileName && (
            <p className="m-0 text-[0.82rem] text-muted [overflow-wrap:anywhere]">
              Selected file: <span className="font-medium text-text">{fileName}</span>
            </p>
          )}
          {isReading && (
            <p role="status" className="m-0 text-[0.82rem] text-muted">
              Reading backup…
            </p>
          )}
          {readError && (
            <p id="restore-file-error" role="alert" className={errorClass}>
              {readError}
            </p>
          )}
        </div>

        {backup && step !== 'select' && (
          <>
            <section aria-labelledby="restore-preview-title" className="mt-s5">
              <h3 id="restore-preview-title" ref={previewHeadingRef} tabIndex={-1} className="m-0">
                Backup preview
              </h3>
              {backup.exportedAt && (
                <p className="mt-s1 text-[0.8rem] text-muted [overflow-wrap:anywhere]">
                  Backup timestamp: {backup.exportedAt}
                </p>
              )}
              <dl className="mt-s3 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-s2">
                <div className="rounded-control border border-border bg-surface p-s2">
                  <dt className="text-[0.75rem] font-medium text-muted">Total records</dt>
                  <dd className="m-0 text-[1.15rem] font-semibold">{backup.totalRecords}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface p-s2">
                  <dt className="text-[0.75rem] font-medium text-muted">Valid records</dt>
                  <dd className="m-0 text-[1.15rem] font-semibold">{backup.validRecords}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface p-s2">
                  <dt className="text-[0.75rem] font-medium text-muted">Repaired</dt>
                  <dd className="m-0 text-[1.15rem] font-semibold">{backup.repairedRecords}</dd>
                </div>
                <div className="rounded-control border border-border bg-surface p-s2">
                  <dt className="text-[0.75rem] font-medium text-muted">Invalid/skipped</dt>
                  <dd className="m-0 text-[1.15rem] font-semibold">
                    {backup.invalidRecords + backup.duplicateRecords}
                  </dd>
                </div>
                <div className="rounded-control border border-border bg-surface p-s2">
                  <dt className="text-[0.75rem] font-medium text-muted">Duplicate IDs</dt>
                  <dd className="m-0 text-[1.15rem] font-semibold">{backup.duplicateRecords}</dd>
                </div>
              </dl>

              {backup.skipped.length > 0 && (
                <details className="mt-s3 rounded-control border border-border bg-surface p-s3">
                  <summary className="cursor-pointer font-medium">
                    Review skipped records ({backup.skipped.length})
                  </summary>
                  <ul className="mt-s2 mb-0 grid max-h-40 list-disc gap-s1 overflow-auto pl-s5 text-[0.8rem] text-muted">
                    {backup.skipped.map((skip) => (
                      <li key={`${skip.index}:${skip.id ?? 'no-id'}`}>
                        Record {skip.index + 1}
                        {skip.id ? ` (${skip.id})` : ''}: {skip.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {step === 'preview' && (
                <>
                  <fieldset className="mt-s4 border-0 p-0">
                    <legend className="mb-s2 p-0 font-semibold text-[0.88rem]">Import mode</legend>
                    <div className="grid gap-s2">
                      <label className="flex cursor-pointer items-start gap-s2 rounded-control border border-border bg-surface p-s3">
                        <input
                          type="radio"
                          name="restore-mode"
                          value="merge"
                          checked={mode === 'merge'}
                          onChange={() => handleModeChange('merge')}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">Merge with current records</span>
                          <span className="block text-[0.8rem] text-muted">
                            Keep all current records and add backup records whose IDs do not
                            already exist. Existing records are never overwritten.
                          </span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-s2 rounded-control border border-border bg-surface p-s3">
                        <input
                          type="radio"
                          name="restore-mode"
                          value="replace"
                          checked={mode === 'replace'}
                          onChange={() => handleModeChange('replace')}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block font-medium">Replace all current records</span>
                          <span className="block text-[0.8rem] text-muted">
                            Use only the valid records from this backup as the new collection.
                            Current records are removed.
                          </span>
                        </span>
                      </label>
                    </div>
                  </fieldset>

                  {plan && (
                    <div className={summaryClass} aria-live="polite">
                      {mode === 'merge' ? (
                        <p className="m-0">
                          Merge keeps all {countLabel(currentItems.length, 'current record')} and
                          adds {countLabel(plan.added, 'new record')}.
                          {plan.skippedExisting > 0
                            ? ` ${countLabel(plan.skippedExisting, 'valid backup record')} already ${
                                plan.skippedExisting === 1 ? 'exists' : 'exist'
                              } and will be skipped.`
                            : ''}{' '}
                          Final collection: {countLabel(plan.finalCount, 'record')}.
                        </p>
                      ) : (
                        <p className="m-0">
                          Replace removes {countLabel(plan.replaced, 'current record')} and keeps{' '}
                          {countLabel(plan.finalCount, 'valid backup record')}. Final collection:{' '}
                          {countLabel(plan.finalCount, 'record')}.
                        </p>
                      )}
                    </div>
                  )}

                  {mode === 'merge' && plan?.added === 0 && (
                    <p className={warningClass}>
                      Nothing will be added. The backup has no valid records, or every valid ID
                      already exists in your current data.
                    </p>
                  )}
                  {mode === 'replace' && backup.totalRecords > 0 && backup.validRecords === 0 && (
                    <p className={warningClass}>
                      This backup contains records, but none are valid. Replacement is disabled so
                      your current data is not erased.
                    </p>
                  )}
                  {mode === 'replace' && backup.totalRecords === 0 && (
                    <p className={warningClass}>
                      This backup is valid but empty. Replacement will remove all current records.
                    </p>
                  )}

                  {applyError && (
                    <p role="alert" className={errorClass}>
                      {applyError}
                    </p>
                  )}

                  <div className="mt-s4 flex flex-wrap justify-end gap-s2">
                    <button type="button" className={secondaryButtonClass} onClick={onClose}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={primaryButtonClass}
                      disabled={primaryDisabled}
                      onClick={() => {
                        if (mode === 'replace') {
                          setApplyError(null);
                          setConfirmed(false);
                          setStep('confirm-replace');
                        } else {
                          handleMerge();
                        }
                      }}
                    >
                      {primaryLabel}
                    </button>
                  </div>
                </>
              )}
            </section>

            {step === 'confirm-replace' && (
              <section aria-labelledby="restore-confirm-title" className="mt-s5 border-t border-border pt-s4">
                <h3 id="restore-confirm-title" ref={confirmHeadingRef} tabIndex={-1} className="m-0">
                  Confirm replacement
                </h3>
                {backup.records.length === 0 ? (
                  <p className={warningClass}>
                    This backup is empty. Replacing will permanently remove all{' '}
                    {countLabel(currentItems.length, 'current record')}.
                  </p>
                ) : (
                  <p className={warningClass}>
                    This will permanently replace all {countLabel(currentItems.length, 'current record')}{' '}
                    with {countLabel(backup.records.length, 'valid backup record')}.{' '}
                    {backup.invalidRecords + backup.duplicateRecords > 0
                      ? `${countLabel(
                          backup.invalidRecords + backup.duplicateRecords,
                          'invalid or duplicate backup record',
                        )} will not be imported.`
                      : ''}
                  </p>
                )}

                <label className="mt-s3 flex cursor-pointer items-start gap-s2 text-[0.88rem]">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {backup.records.length === 0
                      ? 'I understand that all current records will be removed.'
                      : 'I understand that my current records will be replaced.'}
                  </span>
                </label>

                {applyError && (
                  <p role="alert" className={errorClass}>
                    {applyError}
                  </p>
                )}

                <div className="mt-s4 flex flex-wrap justify-end gap-s2">
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => {
                      setApplyError(null);
                      setStep('preview');
                    }}
                  >
                    Back
                  </button>
                  <button type="button" className={secondaryButtonClass} onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={dangerButtonClass}
                    disabled={!confirmed}
                    onClick={handleReplace}
                  >
                    {backup.records.length === 0 ? 'Replace with empty backup' : 'Replace all records'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

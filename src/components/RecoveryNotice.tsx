import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { RecoveryFailure } from '../utils/storage';
import type { RecoveryViewState } from '../types/recovery';

interface Props {
  state: RecoveryViewState;
  downloadError: string | null;
  onDownloadRecovery: () => void;
  onDownloadPrimary: () => void;
  onRetryPreservation: () => void;
  onReplaceRecovery: () => void;
  onRemoveRecovery: () => void;
  onDismiss: () => void;
}

const actionButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-warn bg-surface px-s3 py-[6px] text-[0.82rem] font-semibold text-warn hover:bg-status-interview disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-border bg-surface px-s3 py-[6px] text-[0.82rem] font-medium text-text hover:border-[#c9c4b9]';
const dangerButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-danger bg-danger px-s3 py-[6px] text-[0.82rem] font-medium text-white disabled:cursor-not-allowed disabled:opacity-60';
const dismissButtonClass =
  'inline-grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-status-interview hover:text-warn';

function duplicateLabel(count: number): string {
  return count === 1
    ? '1 duplicate opportunity record was'
    : `${count} duplicate opportunity records were`;
}

function failureMessage(failure: RecoveryFailure | null): string | null {
  switch (failure) {
    case 'conflict':
      return 'A different recovery copy from an earlier repair is already saved. Download both copies before replacing the older one.';
    case 'write-failed':
      return 'The recovery copy could not be saved. Saving remains disabled to protect the original data.';
    case 'read-back-failed':
      return 'The recovery copy could not be verified after saving. Saving remains disabled to protect the original data.';
    case 'read-failed':
      return 'The saved data could not be read from this browser. Saving remains disabled.';
    case 'no-primary':
      return 'The current saved data could not be found. Reload the page to try again.';
    case 'no-recovery':
      return 'No recovery copy was found. Nothing was removed.';
    case 'remove-failed':
      return 'The recovery copy could not be removed. It may still be available in this browser.';
    case 'remove-blocked':
      return 'This recovery copy is still needed to protect the saved data. Resolve the recovery warning before removing it.';
    default:
      return null;
  }
}

export function RecoveryNotice({
  state,
  downloadError,
  onDownloadRecovery,
  onDownloadPrimary,
  onRetryPreservation,
  onReplaceRecovery,
  onRemoveRecovery,
  onDismiss,
}: Props) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmingReplacement, setConfirmingReplacement] = useState(false);

  useEffect(() => {
    setConfirmingRemoval(false);
    setAcknowledged(false);
    setConfirmingReplacement(false);
  }, [state.kind, state.failure, state.recoveryCopy, state.primaryRaw]);

  const blocked = state.writesBlocked;
  const tone = blocked
    ? 'border-danger bg-status-rejected text-danger'
    : 'border-warn bg-status-interview text-warn';
  const hasConflict =
    state.primaryRaw !== null &&
    state.recoveryCopy !== null &&
    state.primaryRaw !== state.recoveryCopy;
  const showRetry = blocked && !hasConflict;
  const showRemove =
    !blocked && state.recoveryCopy !== null && (state.kind === 'retained' || state.repairedSaved);
  const failure = state.failure === 'conflict' ? null : failureMessage(state.failure);

  return (
    <div
      id="recovery-notice"
      tabIndex={-1}
      role={state.kind === 'retained' ? 'status' : 'alert'}
      aria-atomic="true"
      className={`mb-s4 rounded-control border px-s4 py-s3 text-[0.88rem] ${tone}`}
    >
      <div className="flex items-start justify-between gap-s3">
        <div className="min-w-0">
          <p className="m-0 font-semibold">
            {state.kind === 'retained'
              ? 'A recovery copy is available'
              : state.kind === 'unreadable'
                ? 'Saved opportunities could not be read'
                : 'Duplicate opportunity records were excluded'}
          </p>

          {state.kind === 'retained' && (
            <p className="mt-s1 mb-0">
              An earlier storage repair preserved a recovery copy in this browser. The active
              opportunity collection is readable. Download the original raw payload, or remove the
              copy once you no longer need it.
            </p>
          )}

          {state.kind === 'unreadable' && (
            <p className="mt-s1 mb-0">
              Launchboard could not read the opportunities saved in this browser.
              {state.preserved
                ? ' The exact stored text has been preserved locally as a recovery copy.'
                : ' A recovery copy could not be preserved, so saving is disabled to protect the original data.'}
            </p>
          )}

          {state.kind === 'duplicates' && (
            <p className="mt-s1 mb-0">
              {duplicateLabel(state.duplicateCount)} excluded from the active collection. The first
              valid record for each ID was kept.
              {state.preserved
                ? ' The original stored collection has been preserved locally as a recovery copy.'
                : ' A recovery copy could not be preserved, so saving is disabled to protect the original stored collection.'}
            </p>
          )}

          {state.preserved && state.kind !== 'retained' && (
            <p className="mt-s1 mb-0">
              {state.repairedSaved
                ? 'The active collection has since been saved. The recovery copy remains available for download.'
                : state.kind === 'unreadable'
                  ? 'You can keep working; your next successful change will replace the unreadable stored value. Download the recovery copy first if you may need the original text.'
                  : 'You can keep working; your next successful change will save the normalized collection without the duplicate records.'}
            </p>
          )}

          {hasConflict && (
            <p className="mt-s1 mb-0">
              Replacing the earlier recovery copy will discard it from this browser. Download both
              copies first, then acknowledge that the earlier payload is safely retained.
            </p>
          )}

          {failure && <p className="mt-s1 mb-0 font-semibold">{failure}</p>}

          <p className="mt-s1 mb-0 text-[0.8rem]">
            A recovery file contains the exact original text. It may not be a valid Launchboard
            backup.
          </p>

          {downloadError && <p className="mt-s1 mb-0 font-semibold">{downloadError}</p>}
        </div>

        <button
          type="button"
          className={dismissButtonClass}
          aria-label="Dismiss storage recovery notice"
          onClick={onDismiss}
        >
          <X size={15} aria-hidden />
        </button>
      </div>

      <div className="mt-s2 flex flex-wrap items-center gap-s2">
        {state.recoveryCopy !== null && (
          <button type="button" className={actionButtonClass} onClick={onDownloadRecovery}>
            <Download size={14} aria-hidden />{' '}
            {hasConflict ? 'Download previous recovery copy' : 'Download recovery copy'}
          </button>
        )}

        {state.primaryRaw !== null && state.primaryRaw !== state.recoveryCopy && (
          <button type="button" className={actionButtonClass} onClick={onDownloadPrimary}>
            <Download size={14} aria-hidden />{' '}
            {state.kind === 'duplicates'
              ? 'Download current stored collection'
              : 'Download current unreadable data'}
          </button>
        )}

        {showRetry && (
          <button type="button" className={actionButtonClass} onClick={onRetryPreservation}>
            Retry preserving recovery copy
          </button>
        )}
      </div>

      {hasConflict && (
        <div
          role="group"
          aria-label="Resolve conflicting recovery copies"
          className="mt-s3 rounded-control border border-danger/40 bg-surface p-s3"
        >
          <label className="flex items-start gap-s2 text-[0.82rem]">
            <input
              type="checkbox"
              className="mt-[3px]"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>
              I have downloaded or otherwise safely retained the earlier recovery copy.
            </span>
          </label>

          {confirmingReplacement ? (
            <div className="mt-s2">
              <p className="m-0 text-[0.82rem]">
                Replace the earlier recovery copy with the current saved payload? The earlier
                payload will be removed from this browser.
              </p>
              <div className="mt-s2 flex flex-wrap gap-s2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setConfirmingReplacement(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={dangerButtonClass}
                  disabled={!acknowledged}
                  onClick={() => {
                    onReplaceRecovery();
                    setConfirmingReplacement(false);
                    setAcknowledged(false);
                  }}
                >
                  Replace and unblock saving
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${actionButtonClass} mt-s2`}
              disabled={!acknowledged}
              onClick={() => setConfirmingReplacement(true)}
            >
              Replace recovery copy
            </button>
          )}
        </div>
      )}

      {showRemove && !hasConflict && (
        <div className="mt-s2">
          {confirmingRemoval ? (
            <div
              role="group"
              aria-label="Confirm recovery copy removal"
              className="rounded-control border border-danger/40 bg-surface p-s3"
            >
              <p className="m-0 text-[0.82rem]">
                Remove the recovery copy? This may eliminate the last in-browser copy of the
                original unreadable or duplicate-containing data. The active opportunity collection
                will not be changed.
              </p>
              <div className="mt-s2 flex flex-wrap gap-s2">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setConfirmingRemoval(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={dangerButtonClass}
                  onClick={() => {
                    onRemoveRecovery();
                    setConfirmingRemoval(false);
                  }}
                >
                  Remove permanently
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => setConfirmingRemoval(true)}
            >
              Remove recovery copy
            </button>
          )}
        </div>
      )}
    </div>
  );
}

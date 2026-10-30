import { useEffect, useRef } from 'react';
import { Undo2, X } from 'lucide-react';

interface Props {
  /** Success description of the action that is available to undo. */
  message: string | null;
  /** False once the entry can no longer be retried (for example, it went stale). */
  canUndo: boolean;
  /** Accessible error shown when the Undo itself fails. */
  error: string | null;
  onUndo: () => void;
  onDismiss: () => void;
  /** Focus target used only if the bar disappears while it contains focus. */
  fallbackFocusId?: string;
}

const undoButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-accent bg-accent px-s3 py-[6px] text-[0.85rem] font-semibold text-white hover:bg-accent-dark';
const dismissButtonClass =
  'inline-grid h-[30px] w-[30px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark';

/**
 * One-level Undo notification.
 *
 * The live region only contains the action description; the interactive
 * controls sit outside it so a status announcement is never atomic with a
 * button. Focus is never moved here automatically. If the bar disappears while
 * it contains focus (expiry, dismissal or a successful Undo), the cleanup
 * moves focus to the configured fallback only when focus would otherwise be
 * lost, which keeps keyboard users in a valid location.
 */
export function UndoBar({
  message,
  canUndo,
  error,
  onUndo,
  onDismiss,
  fallbackFocusId,
}: Props) {
  const hadFocusRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!hadFocusRef.current) return;
      setTimeout(() => {
        // Another dialog or control may have taken focus while unmounting.
        if (document.querySelector('dialog[open]')) return;
        const active = document.activeElement;
        if (active && active !== document.body) return;
        if (fallbackFocusId) document.getElementById(fallbackFocusId)?.focus();
      }, 0);
    };
  }, [fallbackFocusId]);

  return (
    <div
      role="region"
      aria-label="Undo notification"
      className="fixed bottom-s4 left-1/2 z-40 flex w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center justify-between gap-s3 rounded-card border border-border bg-surface p-s4 shadow-modal"
      onFocusCapture={() => {
        hadFocusRef.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          hadFocusRef.current = false;
        }
      }}
    >
      <div className="min-w-0 grow">
        {message && (
          <p
            role="status"
            aria-atomic="true"
            className="m-0 text-[0.9rem] font-medium [overflow-wrap:anywhere]"
          >
            {message}
          </p>
        )}
        <p className="m-0 text-[0.78rem] text-muted">
          Undo is available for 10 seconds. Reloading the page ends it.
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-s2">
        {canUndo && (
          <button type="button" className={undoButtonClass} onClick={onUndo}>
            <Undo2 size={15} aria-hidden /> Undo
          </button>
        )}
        <button
          type="button"
          className={dismissButtonClass}
          aria-label="Dismiss undo notification"
          onClick={onDismiss}
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="m-0 w-full rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.82rem] text-danger [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

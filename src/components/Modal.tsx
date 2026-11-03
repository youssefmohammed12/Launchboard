import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Id of the element that should receive focus when the dialog opens. */
  initialFocusId?: string;
  /**
   * The element that opened the dialog (typically the clicked button).
   * It is recorded explicitly because some browsers (WebKit) move focus to
   * <body> as soon as a button is clicked, so document.activeElement cannot
   * be trusted to identify the trigger.
   */
  opener?: HTMLElement | null;
  /** Id of an element to focus when the opener is gone (e.g. a deleted row). */
  fallbackFocusId?: string;
  /** Prevents closing while a non-cancellable server mutation is in flight. */
  closeDisabled?: boolean;
}

/**
 * Native <dialog>: the browser provides focus trapping and Escape-to-close.
 *
 * Two close paths exist:
 * - Escape (browser) fires the native 'close' event, handled by onClose.
 * - The close button / backdrop call dialog.close(), which fires the same
 *   'close' event, so both paths behave identically.
 *
 * When React unmounts the dialog, the cleanup restores focus to the element
 * that opened it; removing an open dialog would otherwise drop focus to <body>.
 */
export function Modal({ title, onClose, children, initialFocusId, opener, fallbackFocusId, closeDisabled = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  /** The element that should regain focus when the dialog closes. */
  const openerRef = useRef<HTMLElement | null>(null);
  const fallbackRef = useRef<string | undefined>(fallbackFocusId);
  fallbackRef.current = fallbackFocusId;
  /** Latest explicitly recorded trigger; read inside the effect without retriggering it. */
  const openerPropRef = useRef<HTMLElement | null | undefined>(opener);
  openerPropRef.current = opener;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const alreadyOpen = dialog.open;
    // Captured before showModal() moves focus into the dialog. The check on
    // `alreadyOpen` keeps the capture to the first mount only, so a StrictMode
    // remount cannot record the dialog's own close button as the trigger.
    if (!alreadyOpen && openerRef.current === null) {
      const active = document.activeElement as HTMLElement | null;
      const fallbackActive = active && active !== document.body ? active : null;
      openerRef.current = openerPropRef.current ?? fallbackActive;
    }
    if (!dialog.open) dialog.showModal();
    // showModal() moves focus to the first focusable element (the close
    // button), so the requested field is focused explicitly afterwards.
    if (initialFocusId) {
      dialog.querySelector<HTMLElement>(`#${CSS.escape(initialFocusId)}`)?.focus();
    }
    return () => {
      // React removes the dialog right after this cleanup. While the dialog is
      // still in the DOM the browser keeps focus trapped inside it, so the
      // opener is focused on the next tick, once the dialog is gone.
      const trigger = openerRef.current;
      const fallbackId = fallbackRef.current;
      setTimeout(() => {
        // Another dialog may have replaced this one (details -> edit);
        // in that case focus already belongs to the new dialog.
        if (document.querySelector('dialog[open]')) return;
        const target =
          trigger && trigger !== document.body && trigger.isConnected
            ? trigger
            : fallbackId
              ? document.getElementById(fallbackId)
              : null;
        target?.focus();
      }, 0);
    };
  }, [initialFocusId]);

  const requestClose = () => {
    if (closeDisabled) return;
    const dialog = ref.current;
    if (dialog?.open) {
      // Closing through the dialog element lets the browser restore focus to
      // the opener and fires the 'close' event handled below.
      dialog.close();
    } else {
      onClose();
    }
  };

  return (
    <dialog
      ref={ref}
      className="m-auto max-h-[calc(100vh_-_32px)] w-[min(640px,calc(100vw_-_32px))] overflow-auto rounded-card border-0 bg-surface p-0 text-text shadow-modal backdrop:bg-[rgba(23,33,43,0.5)]"
      aria-labelledby="modal-title"
      onClose={onClose}
      onCancel={(event) => {
        if (closeDisabled) event.preventDefault();
      }}
      onClick={(e) => {
        if (!closeDisabled && e.target === ref.current) requestClose(); // backdrop click
      }}
    >
      <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-border bg-surface px-s5 py-s4">
        <h2 id="modal-title" className="m-0">{title}</h2>
        <button
          type="button"
          className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark"
          aria-label="Close dialog"
          disabled={closeDisabled}
          onClick={requestClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

import { Modal } from './Modal';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** The control that opened this dialog, recorded explicitly for focus restore. */
  opener?: HTMLElement | null;
  /** Id of the element to focus when the opener is gone. */
  fallbackFocusId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text hover:border-[#c9c4b9]';
const dangerButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-danger bg-danger px-s4 py-[9px] font-medium text-white';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  opener,
  fallbackFocusId,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Modal title={title} onClose={onCancel} opener={opener} fallbackFocusId={fallbackFocusId}>
      <div className="px-s5 pt-s4 pb-s5">
        <p>{message}</p>
        <div className="mt-s4 flex justify-end gap-s2">
          <button type="button" className={secondaryButtonClass} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={dangerButtonClass} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

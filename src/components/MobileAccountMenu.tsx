import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';

interface Props {
  email: string;
  disabled?: boolean;
  onMigrate: () => void;
  onSignOut: () => void;
}

/** Compact account access for the phone header; desktop keeps its full account controls. */
export function MobileAccountMenu({
  email,
  disabled = false,
  onMigrate,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="lb-mobile-account-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lb-mobile-account-trigger"
        aria-label="Open account options"
        aria-expanded={open}
        aria-controls="lb-mobile-account-options"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="lb-user-avatar" aria-hidden="true">
          {email.slice(0, 1).toUpperCase()}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="lb-mobile-account-options"
          className="lb-mobile-account-panel"
          role="region"
          aria-label="Account options"
        >
          <div className="lb-mobile-account-identity">
            <span>Signed in as</span>
            <strong>{email}</strong>
          </div>
          <button
            type="button"
            className="lb-migration-button lb-mobile-account-action"
            onClick={() => {
              setOpen(false);
              onMigrate();
            }}
          >
            Migrate local data
          </button>
          <button
            type="button"
            className="lb-signout-button lb-mobile-account-action"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

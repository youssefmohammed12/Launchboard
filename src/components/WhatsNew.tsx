import { Sparkles } from 'lucide-react';
import { RELEASE_NOTES } from '../data/releaseNotes';
import { Modal } from './Modal';

interface WhatsNewButtonProps {
  onOpen: (trigger: HTMLElement) => void;
}

export function WhatsNewButton({ onOpen }: WhatsNewButtonProps) {
  return (
    <button
      type="button"
      className="lb-whats-new-button"
      aria-label="What's New"
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <Sparkles size={16} aria-hidden="true" />
      <span className="lb-whats-new-label">What's New</span>
    </button>
  );
}

interface WhatsNewDialogProps {
  open: boolean;
  opener?: HTMLElement | null;
  fallbackFocusId: string;
  onClose: () => void;
  onReplaySpotlight?: () => void;
}

export function WhatsNewDialog({
  open,
  opener,
  fallbackFocusId,
  onClose,
  onReplaySpotlight,
}: WhatsNewDialogProps) {
  if (!open) return null;

  return (
    <Modal
      title="What's New"
      onClose={onClose}
      opener={opener}
      fallbackFocusId={fallbackFocusId}
    >
      <div className="lb-whats-new-dialog" id="whats-new-content">
        <p className="lb-whats-new-intro">
          A running history of the features and improvements added to Launchboard.
        </p>

        {RELEASE_NOTES.map((release, index) => (
          <article className="lb-release-note" key={release.version}>
            <div className="lb-release-meta">
              <span className={index === 0 ? 'lb-release-version is-latest' : 'lb-release-version'}>
                Version {release.version}{index === 0 ? ' · Latest' : ''}
              </span>
              <time>{release.date}</time>
            </div>

            <h3>{release.title}</h3>
            <p className="lb-release-summary">{release.summary}</p>

            {release.accountModeNote && (
              <p className="lb-release-mode-note">{release.accountModeNote}</p>
            )}

            {release.sections.map((section) => (
              <section className="lb-release-section" key={section.heading}>
                <h4>{section.heading}</h4>
                <ul>
                  {section.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
            ))}

            {release.spotlight === 'quick-capture' && onReplaySpotlight && (
              <button
                type="button"
                className="lb-release-spotlight-action"
                onClick={onReplaySpotlight}
              >
                Show the Quick Capture spotlight
              </button>
            )}
          </article>
        ))}
      </div>
    </Modal>
  );
}

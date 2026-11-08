import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  userId: string;
  replayToken: number;
  onTryQuickCapture: (trigger: HTMLElement | null) => void;
}

interface SpotlightLayout {
  hole: { top: number; left: number; right: number; bottom: number };
  card: { top: number; left: number; width: number };
  viewport: { width: number; height: number };
}

const TARGET_SELECTOR = '[data-feature-spotlight="quick-capture"]';
const SPOTLIGHT_STORAGE_PREFIX = 'launchboard.feature-spotlight.quick-capture.v1.3.0';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function FeatureSpotlight({ userId, replayToken, onTryQuickCapture }: Props) {
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState<SpotlightLayout | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const focusPendingRef = useRef(false);
  const previousReplayToken = useRef(replayToken);
  const storageKey = `${SPOTLIGHT_STORAGE_PREFIX}:${encodeURIComponent(userId)}`;

  const markSeen = () => {
    try {
      window.localStorage.setItem(storageKey, 'seen');
    } catch {
      // The spotlight remains dismissible for this session if storage is blocked.
    }
  };

  const dismiss = () => {
    markSeen();
    setVisible(false);
    document.querySelector<HTMLElement>(TARGET_SELECTOR)?.focus();
  };

  const tryFeature = () => {
    const target = document.querySelector<HTMLElement>(TARGET_SELECTOR);
    markSeen();
    setVisible(false);
    onTryQuickCapture(target);
  };

  useEffect(() => {
    let alreadySeen = false;
    try {
      alreadySeen = window.localStorage.getItem(storageKey) === 'seen';
    } catch {
      alreadySeen = true;
    }
    if (alreadySeen) return;

    const timer = window.setTimeout(() => {
      // Never stack the onboarding spotlight on top of an app dialog.
      // If the user opens something during the initial delay, leave the tour
      // available for the next clean workspace entry instead.
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      setVisible(true);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    if (replayToken === previousReplayToken.current) return;
    previousReplayToken.current = replayToken;
    setVisible(true);
  }, [replayToken]);

  useEffect(() => {
    if (!visible) {
      focusPendingRef.current = false;
      setLayout(null);
      return;
    }
    focusPendingRef.current = true;

    const target = document.querySelector<HTMLElement>(TARGET_SELECTOR);
    if (!target) {
      setVisible(false);
      return;
    }

    target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    target.classList.add('lb-feature-spotlight-target');
    const handleTargetClick = () => {
      markSeen();
      setVisible(false);
    };
    target.addEventListener('click', handleTargetClick);

    const updateLayout = () => {
      const rect = target.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const padding = 9;
      const hole = {
        top: clamp(rect.top - padding, 0, viewportHeight),
        left: clamp(rect.left - padding, 0, viewportWidth),
        right: clamp(rect.right + padding, 0, viewportWidth),
        bottom: clamp(rect.bottom + padding, 0, viewportHeight),
      };
      const cardWidth = Math.min(360, viewportWidth - 32);
      const estimatedCardHeight = 218;
      const below = rect.bottom + 18;
      const above = rect.top - estimatedCardHeight - 18;
      const cardTop = below + estimatedCardHeight <= viewportHeight - 16
        ? below
        : Math.max(16, above);
      const cardLeft = clamp(
        rect.left + rect.width / 2 - cardWidth / 2,
        16,
        viewportWidth - cardWidth - 16,
      );

      setLayout({
        hole,
        card: { top: cardTop, left: cardLeft, width: cardWidth },
        viewport: { width: viewportWidth, height: viewportHeight },
      });
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);

    return () => {
      target.removeEventListener('click', handleTargetClick);
      target.classList.remove('lb-feature-spotlight-target');
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible || !layout || !focusPendingRef.current) return;
    primaryActionRef.current?.focus();
    focusPendingRef.current = false;
  }, [layout, visible]);

  if (!visible || !layout) return null;

  const { hole, card, viewport } = layout;
  const bandHeight = hole.bottom - hole.top;

  return (
    <div className="lb-feature-spotlight">
      <div
        className="lb-spotlight-panel"
        style={{ top: 0, left: 0, width: viewport.width, height: hole.top }}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div
        className="lb-spotlight-panel"
        style={{ top: hole.top, left: 0, width: hole.left, height: bandHeight }}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div
        className="lb-spotlight-panel"
        style={{
          top: hole.top,
          left: hole.right,
          width: viewport.width - hole.right,
          height: bandHeight,
        }}
        aria-hidden="true"
        onClick={dismiss}
      />
      <div
        className="lb-spotlight-panel"
        style={{ top: hole.bottom, left: 0, width: viewport.width, height: viewport.height - hole.bottom }}
        aria-hidden="true"
        onClick={dismiss}
      />

      <section
        className="lb-spotlight-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lb-spotlight-title"
        aria-describedby="lb-spotlight-description"
        style={{ top: card.top, left: card.left, width: card.width }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss();
            return;
          }
          if (event.key !== 'Tab') return;

          const actions = event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not([disabled])',
          );
          const first = actions[0];
          const last = actions[actions.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="lb-spotlight-card-topline">
          <span>NEW IN LAUNCHBOARD</span>
          <button
            type="button"
            className="lb-spotlight-close"
            aria-label="Close feature spotlight"
            onClick={dismiss}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <h2 id="lb-spotlight-title">Capture an opportunity in less time</h2>
        <p id="lb-spotlight-description">
          Paste a public job-posting link. On supported pages, Launchboard can suggest details for you to review and edit before saving. You stay in control.
        </p>
        <div className="lb-spotlight-actions">
          <button
            ref={primaryActionRef}
            type="button"
            className="lb-spotlight-try"
            onClick={tryFeature}
          >
            Try Quick Capture
          </button>
          <button type="button" className="lb-spotlight-later" onClick={dismiss}>
            Maybe later
          </button>
        </div>
      </section>
    </div>
  );
}

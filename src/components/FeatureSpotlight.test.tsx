import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeatureSpotlight } from './FeatureSpotlight';

const storageKey = 'launchboard.feature-spotlight.quick-capture.v1.3.0:user-123';

function renderSpotlight(replayToken = 0, onTryQuickCapture = vi.fn()) {
  return {
    onTryQuickCapture,
    ...render(
      <>
        <button type="button" data-feature-spotlight="quick-capture">
          Quick Capture
        </button>
        <FeatureSpotlight
          userId="user-123"
          replayToken={replayToken}
          onTryQuickCapture={onTryQuickCapture}
        />
      </>,
    ),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('FeatureSpotlight', () => {
  it('appears once for the signed-in account and remembers a dismissal', () => {
    renderSpotlight();

    expect(screen.queryByRole('dialog', { name: /Capture an opportunity/ })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByRole('dialog', { name: /Capture an opportunity/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(localStorage.getItem(storageKey)).toBe('seen');
    expect(screen.queryByRole('dialog', { name: /Capture an opportunity/ })).not.toBeInTheDocument();
  });

  it('does not open over another active dialog', () => {
    render(
      <>
        <dialog open role="dialog" aria-label="Existing dialog" />
        <button type="button" data-feature-spotlight="quick-capture">Quick Capture</button>
        <FeatureSpotlight userId="user-123" replayToken={0} onTryQuickCapture={vi.fn()} />
      </>,
    );

    act(() => {
      vi.advanceTimersByTime(850);
    });

    expect(screen.getByRole('dialog', { name: 'Existing dialog' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Capture an opportunity/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('moves focus into the spotlight so Escape can dismiss it', () => {
    renderSpotlight();

    act(() => {
      vi.advanceTimersByTime(850);
    });

    const tryButton = screen.getByRole('button', { name: 'Try Quick Capture' });
    expect(tryButton).toHaveFocus();
    fireEvent.keyDown(tryButton, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: /Capture an opportunity/ })).not.toBeInTheDocument();
    expect(localStorage.getItem(storageKey)).toBe('seen');
  });

  it('can be replayed from release notes and launches Quick Capture', () => {
    localStorage.setItem(storageKey, 'seen');
    const onTryQuickCapture = vi.fn();
    const view = renderSpotlight(0, onTryQuickCapture);

    act(() => {
      vi.advanceTimersByTime(850);
    });
    expect(screen.queryByRole('dialog', { name: /Capture an opportunity/ })).not.toBeInTheDocument();

    view.rerender(
      <>
        <button type="button" data-feature-spotlight="quick-capture">
          Quick Capture
        </button>
        <FeatureSpotlight
          userId="user-123"
          replayToken={1}
          onTryQuickCapture={onTryQuickCapture}
        />
      </>,
    );

    expect(screen.getByRole('dialog', { name: /Capture an opportunity/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try Quick Capture' }));
    expect(onTryQuickCapture).toHaveBeenCalledWith(
      screen.getByRole('button', { name: 'Quick Capture' }),
    );
    expect(localStorage.getItem(storageKey)).toBe('seen');
  });
});

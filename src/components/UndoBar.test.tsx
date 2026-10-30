import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { UndoBar } from './UndoBar';

function renderBar(overrides: Partial<ComponentProps<typeof UndoBar>> = {}) {
  const onUndo = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <>
      <main id="main-content" tabIndex={-1}>
        Page
      </main>
      <UndoBar
        message="Deleted “Frontend Intern”."
        canUndo
        error={null}
        onUndo={onUndo}
        onDismiss={onDismiss}
        fallbackFocusId="main-content"
        {...overrides}
      />
    </>,
  );
  // Removes only the notification; the page container stays mounted, so this
  // mirrors the app when the bar expires or is dismissed.
  const remove = () =>
    view.rerender(
      <>
        <main id="main-content" tabIndex={-1}>
          Page
        </main>
      </>,
    );
  return { onUndo, onDismiss, remove, ...view };
}

describe('UndoBar', () => {
  it('announces the action and exposes Undo and Dismiss controls', () => {
    const { onUndo, onDismiss } = renderBar();

    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Frontend Intern”.');
    expect(screen.getByText(/Undo is available for 10 seconds/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss undo notification' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not move focus when it appears', () => {
    renderBar();

    expect(document.activeElement).toBe(document.body);
  });

  it('shows an accessible error instead of Undo when retrying is impossible', () => {
    renderBar({
      message: null,
      canUndo: false,
      error: 'The archive state has changed, so the earlier change cannot be undone.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('archive state has changed');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dismiss undo notification' }),
    ).toBeInTheDocument();
  });

  it('keeps the action message and the error visually and semantically distinct', () => {
    renderBar({
      canUndo: true,
      error: 'The undo could not be saved to this browser.',
    });

    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Frontend Intern”.');
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('moves focus to the fallback only when it disappears while focused', () => {
    vi.useFakeTimers();
    const { remove } = renderBar();

    screen.getByRole('button', { name: 'Undo' }).focus();
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus();

    remove();
    act(() => {
      vi.runAllTimers();
    });

    expect(document.getElementById('main-content')).toHaveFocus();
  });

  it('leaves focus alone when the bar disappears without containing it', () => {
    vi.useFakeTimers();
    const { remove } = renderBar();
    const main = document.getElementById('main-content');
    main?.focus();

    remove();
    act(() => {
      vi.runAllTimers();
    });

    expect(main).toHaveFocus();
  });
});

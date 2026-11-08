import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WhatsNewButton, WhatsNewDialog } from './WhatsNew';

describe('What’s New', () => {
  it('shows the latest release and the previous release in the history', () => {
    render(
      <WhatsNewDialog
        open
        fallbackFocusId="main-content"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: "What's New" })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Capture opportunities from a link' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Keep every next step moving' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is saved until you review and confirm it/)).toBeInTheDocument();
  });

  it('opens from its button and offers a way to replay the feature spotlight', () => {
    const onOpen = vi.fn();
    const onReplaySpotlight = vi.fn();
    render(
      <>
        <WhatsNewButton onOpen={onOpen} />
        <WhatsNewDialog
          open
          fallbackFocusId="main-content"
          onClose={vi.fn()}
          onReplaySpotlight={onReplaySpotlight}
        />
      </>,
    );

    const trigger = screen.getByRole('button', { name: "What's New" });
    fireEvent.click(trigger);
    expect(onOpen).toHaveBeenCalledWith(trigger);

    fireEvent.click(screen.getByRole('button', { name: 'Show the Quick Capture spotlight' }));
    expect(onReplaySpotlight).toHaveBeenCalledOnce();
  });
});

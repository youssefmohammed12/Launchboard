import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('exposes all primary destinations through a named navigation landmark', () => {
    render(
      <Sidebar
        current="dashboard"
        onNavigate={vi.fn()}
        onSearch={vi.fn()}
      />,
    );

    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(nav).getAllByRole('button')).toHaveLength(6);
    expect(within(nav).getByRole('button', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: 'Opportunities' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(nav).getByRole('button', { name: 'Actions' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('navigates to the Action Center destination', () => {
    const onNavigate = vi.fn();
    render(
      <Sidebar
        current="dashboard"
        onNavigate={onNavigate}
        onSearch={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(onNavigate).toHaveBeenCalledWith('action-center');
  });

  it('preserves the global search trigger and its keyboard shortcut hint', () => {
    const onSearch = vi.fn();
    render(
      <Sidebar
        current="opportunities"
        onNavigate={vi.fn()}
        onSearch={onSearch}
      />,
    );

    const search = screen.getByRole('button', { name: 'Search Launchboard' });
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    fireEvent.click(search);
    expect(onSearch).toHaveBeenCalledWith(search);
  });
});

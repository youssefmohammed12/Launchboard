import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileAccountMenu } from './MobileAccountMenu';

describe('MobileAccountMenu', () => {
  it('shows the signed-in email and keeps account actions available', () => {
    const onMigrate = vi.fn();
    const onSignOut = vi.fn();
    render(
      <MobileAccountMenu
        email="youssef@example.com"
        onMigrate={onMigrate}
        onSignOut={onSignOut}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open account options' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Account options' })).toBeInTheDocument();
    expect(screen.getByText('youssef@example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Migrate local data' }));
    expect(onMigrate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the account trigger', () => {
    render(
      <MobileAccountMenu
        email="youssef@example.com"
        onMigrate={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Open account options' });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes when the user clicks outside the account panel', () => {
    render(
      <>
        <MobileAccountMenu
          email="youssef@example.com"
          onMigrate={vi.fn()}
          onSignOut={vi.fn()}
        />
        <button type="button">Outside</button>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open account options' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));

    expect(screen.queryByRole('region', { name: 'Account options' })).not.toBeInTheDocument();
  });

  it('disables sign out while an account or data operation is busy', () => {
    render(
      <MobileAccountMenu
        email="youssef@example.com"
        disabled
        onMigrate={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open account options' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
  });
});

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from './test/fixtures';
import type { Opportunity } from './types/opportunity';
import App from './App';

const KEY = 'launchboard.opportunities.v1';
const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

function stored(): Opportunity[] {
  return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Opportunity[];
}

function goToOpportunities(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
}

function selectRow(title: string): void {
  fireEvent.click(screen.getByRole('checkbox', { name: `Select ${title}` }));
}

function bulkToolbar(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Bulk actions' });
}

function undoRegion(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Undo notification' });
}

function undoButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Undo' });
}

function confirmDialog(): HTMLElement {
  return screen.getByRole('dialog');
}

function deleteSelected(): void {
  fireEvent.click(
    within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Delete selected' }),
  );
}

describe('App bulk delete', () => {
  it('deletes selected active records in one write and restores the whole batch', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const alpha = makeOpportunity({
      id: 'op-1',
      title: 'Alpha Role',
      status: 'Interview',
      priority: 'High',
      tags: ['remote'],
      notes: 'Keep these notes.',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    const beta = makeOpportunity({ id: 'op-2', title: 'Beta Role', status: 'Applied' });
    const gamma = makeOpportunity({ id: 'op-3', title: 'Gamma Role', status: 'Saved' });
    const archived = makeOpportunity({
      id: 'op-4',
      title: 'Archived Role',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });
    localStorage.setItem(KEY, JSON.stringify([alpha, beta, gamma, archived]));

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    selectRow('Gamma Role');
    expect(within(bulkToolbar() as HTMLElement).getByText('2 selected')).toBeInTheDocument();

    deleteSelected();

    const dialog = confirmDialog();
    expect(
      within(dialog).getByRole('heading', { name: 'Delete selected opportunities' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Delete 2 opportunities from the Active view\?/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/details, activities, interviews, contacts and materials/)).toBeInTheDocument();
    expect(within(dialog).getByText(/undo this for 10 seconds/)).toBeInTheDocument();
    expect(within(dialog).getByText(/recovery requires a backup/)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not keep a copy in the Archived view/)).toBeInTheDocument();

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2' }));
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();

    // Separated records are removed; the unselected and archived records stay.
    expect(stored().map((item) => item.id)).toEqual(['op-2', 'op-4']);
    expect(stored()[1].archivedAt).toBe(ARCHIVED_AT);
    expect(bulkToolbar()).toBeNull();
    expect(screen.queryByRole('button', { name: 'View Alpha Role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Gamma Role' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Beta Role' })).toBeInTheDocument();
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Deleted 2 opportunities.',
    );
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);

    fireEvent.click(undoButton() as HTMLElement);

    const restored = stored();
    expect(restored.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3', 'op-4']);
    expect(restored[0]).toMatchObject({
      title: 'Alpha Role',
      status: 'Interview',
      priority: 'High',
      tags: ['remote'],
      notes: 'Keep these notes.',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    expect(restored[0].archivedAt).toBeUndefined();
    expect(restored[2].title).toBe('Gamma Role');
    expect(restored[3].archivedAt).toBe(ARCHIVED_AT);
    expect(undoRegion()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'All 2 opportunities were restored.',
    );
    expect(screen.getByRole('button', { name: 'View Alpha Role' })).toBeInTheDocument();
  });

  it('deletes from the Archived view and restores the archived state on Undo', () => {
    const active = makeOpportunity({ id: 'op-1', title: 'Active Role' });
    const archived = makeOpportunity({
      id: 'op-2',
      title: 'Archived Role',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });
    localStorage.setItem(KEY, JSON.stringify([active, archived]));

    render(<App />);
    goToOpportunities();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    selectRow('Archived Role');
    deleteSelected();

    const dialog = confirmDialog();
    expect(
      within(dialog).getByText(/Delete 1 opportunity from the Archived view\?/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Its details/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 1' }));

    expect(stored().map((item) => item.id)).toEqual(['op-1']);
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Deleted 1 opportunity.',
    );

    fireEvent.click(undoButton() as HTMLElement);

    const restored = stored();
    expect(restored.map((item) => item.id)).toEqual(['op-1', 'op-2']);
    expect(restored[1].archivedAt).toBe(ARCHIVED_AT);
    expect(screen.getByRole('status')).toHaveTextContent('1 opportunity was restored.');
    // The restored record is visible in the Archived view the user is in.
    expect(screen.getByRole('button', { name: 'View Archived Role' })).toBeInTheDocument();
  });

  it('changes nothing on Cancel and keeps the selection and a pending Undo', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 1' }));
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 1 opportunity.',
    );

    selectRow('Beta Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Cancel' }));

    const unchanged = stored();
    expect(unchanged.map((item) => item.id)).toEqual(['op-1', 'op-2']);
    expect(unchanged[0].archivedAt).toBeTypeOf('string');
    expect(within(bulkToolbar() as HTMLElement).getByText('1 selected')).toBeInTheDocument();
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 1 opportunity.',
    );
  });

  it('keeps storage, selection and the previous Undo when the write fails, then retries', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
        makeOpportunity({ id: 'op-3', title: 'Gamma Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 1' }));
    expect(undoRegion()).not.toBeNull();

    selectRow('Beta Role');
    selectRow('Gamma Role');
    deleteSelected();

    const beforeFailure = localStorage.getItem(KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 2' }));
    setItem.mockRestore();

    expect(screen.getByRole('alert')).toHaveTextContent('The bulk delete could not be saved');
    expect(localStorage.getItem(KEY)).toBe(beforeFailure);
    expect(stored().map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(within(bulkToolbar() as HTMLElement).getByText('2 selected')).toBeInTheDocument();
    // No new Undo entry replaced the still-valid archive entry.
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 1 opportunity.',
    );

    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 2' }));

    expect(stored().map((item) => item.id)).toEqual(['op-1']);
    expect(bulkToolbar()).toBeNull();
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Deleted 2 opportunities.',
    );
  });

  it('expires the batch-delete Undo after ten seconds', () => {
    vi.useFakeTimers();
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 1' }));

    expect(undoButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
    // The deletion remains persisted.
    expect(stored().map((item) => item.id)).toEqual(['op-2']);
  });

  it('dismissing the notification ends the Undo without restoring the batch', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Alpha Role' })]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss undo notification' }));

    expect(undoRegion()).toBeNull();
    expect(stored()).toEqual([]);
  });

  it('does not offer Undo after a reload', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Alpha Role' })]),
    );

    const view = render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 1' }));
    expect(undoButton()).not.toBeNull();

    view.unmount();
    render(<App />);
    goToOpportunities();

    expect(undoButton()).toBeNull();
    expect(undoRegion()).toBeNull();
    expect(stored()).toEqual([]);
  });

  it('invalidates the batch-delete Undo after a later saved change', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Beta Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 1' }));
    expect(undoButton()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Alpha Role' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Renamed Alpha Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
    expect(stored().map((item) => item.id)).toEqual(['op-1']);
  });

  it('replaces the batch-delete Undo with a newer eligible action', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Beta Role');
    deleteSelected();
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Delete 1' }));
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Deleted 1 opportunity.',
    );

    selectRow('Alpha Role');
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 1' }));
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 1 opportunity.',
    );

    fireEvent.click(undoButton() as HTMLElement);

    // Only the newer archive is reversed; the deleted record is not resurrected.
    expect(stored().map((item) => item.id)).toEqual(['op-1']);
    expect(stored()[0].archivedAt).toBeUndefined();
    expect(undoRegion()).toBeNull();
  });
});

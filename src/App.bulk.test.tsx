import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from './test/fixtures';
import App from './App';

const KEY = 'launchboard.opportunities.v1';
const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

function stored(): Record<string, unknown>[] {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown>[];
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

describe('App bulk archive', () => {
  it('archives every selected active record once, then undoes the whole batch', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const first = makeOpportunity({
      id: 'op-1',
      title: 'Alpha Role',
      status: 'Interview',
      priority: 'High',
      notes: 'Keep these notes.',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    const second = makeOpportunity({
      id: 'op-2',
      title: 'Beta Role',
      status: 'Applied',
    });
    const untouched = makeOpportunity({ id: 'op-3', title: 'Gamma Role' });
    localStorage.setItem(KEY, JSON.stringify([first, second, untouched]));

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    selectRow('Beta Role');

    const toolbar = bulkToolbar() as HTMLElement;
    expect(within(toolbar).getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Archive selected' }));

    const dialog = confirmDialog();
    expect(
      within(dialog).getByRole('heading', { name: 'Archive selected opportunities' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Archive 2 opportunities\?/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/They will move to Archived and can be restored\./),
    ).toBeInTheDocument();

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive 2' }));
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();

    const archived = stored();
    expect(archived.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(typeof archived[0].archivedAt).toBe('string');
    expect(typeof archived[1].archivedAt).toBe('string');
    expect(archived[2].archivedAt).toBeUndefined();
    expect(archived[0].status).toBe('Interview');
    expect(archived[1].status).toBe('Applied');
    expect(archived[0].notes).toBe('Keep these notes.');
    expect(archived[0].activities).toEqual([activity]);
    expect(archived[0].contacts).toEqual([contact]);
    expect(archived[0].interviews).toEqual([interview]);
    expect(archived[0].materials).toEqual([material]);

    // Selection clears only after the commit; the batch is one Undo entry.
    expect(bulkToolbar()).toBeNull();
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 2 opportunities.',
    );
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'View Alpha Role' })).not.toBeInTheDocument();

    fireEvent.click(undoButton() as HTMLElement);

    const undone = stored();
    expect(undone[0].archivedAt).toBeUndefined();
    expect(undone[1].archivedAt).toBeUndefined();
    expect(undone[2].archivedAt).toBeUndefined();
    expect(undone[0].status).toBe('Interview');
    expect(undone[0].activities).toEqual([activity]);
    expect(undone[0].interviews).toEqual([interview]);
    expect(undoRegion()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('2 opportunities are active again.');
    expect(screen.getByRole('button', { name: 'View Alpha Role' })).toBeInTheDocument();
  });

  it('does not change data or selection when the confirmation is cancelled', () => {
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
    selectRow('Beta Role');

    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Cancel' }));

    expect(stored().every((item) => item.archivedAt === undefined)).toBe(true);
    expect(within(bulkToolbar() as HTMLElement).getByText('2 selected')).toBeInTheDocument();
    expect(undoRegion()).toBeNull();
  });

  it('keeps the selection and stored data when the bulk write fails, then retries', () => {
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
    selectRow('Beta Role');

    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 2' }));
    setItem.mockRestore();

    expect(screen.getByRole('alert')).toHaveTextContent('The bulk archive could not be saved');
    expect(stored().every((item) => item.archivedAt === undefined)).toBe(true);
    // The selection survives so the user can retry.
    expect(within(bulkToolbar() as HTMLElement).getByText('2 selected')).toBeInTheDocument();
    expect(undoRegion()).toBeNull();

    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 2' }));

    expect(stored().every((item) => typeof item.archivedAt === 'string')).toBe(true);
    expect(bulkToolbar()).toBeNull();
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived 2 opportunities.',
    );
  });
});

describe('App bulk restore', () => {
  it('restores selected archived records and puts their original timestamps back on Undo', () => {
    const secondTimestamp = '2026-05-01T00:00:00.000Z';
    const first = makeOpportunity({
      id: 'op-1',
      title: 'Alpha Role',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });
    const second = makeOpportunity({
      id: 'op-2',
      title: 'Beta Role',
      status: 'Offer',
      archivedAt: secondTimestamp,
    });
    const active = makeOpportunity({ id: 'op-3', title: 'Gamma Role' });
    localStorage.setItem(KEY, JSON.stringify([first, second, active]));

    render(<App />);
    goToOpportunities();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    selectRow('Alpha Role');
    selectRow('Beta Role');

    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Restore selected' }),
    );
    const dialog = confirmDialog();
    expect(
      within(dialog).getByRole('heading', { name: 'Restore selected opportunities' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Restore 2 opportunities\?/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore 2' }));

    const restored = stored();
    expect(restored[0].archivedAt).toBeUndefined();
    expect(restored[1].archivedAt).toBeUndefined();
    expect(restored[0].status).toBe('Rejected');
    expect(restored[1].status).toBe('Offer');
    expect(restored[2]).toEqual(active);
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Restored 2 opportunities.',
    );

    fireEvent.click(undoButton() as HTMLElement);

    const undone = stored();
    expect(undone[0].archivedAt).toBe(ARCHIVED_AT);
    expect(undone[1].archivedAt).toBe(secondTimestamp);
    expect(undone[0].status).toBe('Rejected');
    expect(undone[1].status).toBe('Offer');
    expect(undone[2]).toEqual(active);
    expect(screen.getByRole('status')).toHaveTextContent('2 opportunities are archived again.');
  });

  it('does not change anything when the batch Undo write fails', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role', archivedAt: ARCHIVED_AT }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role', archivedAt: ARCHIVED_AT }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    selectRow('Alpha Role');
    selectRow('Beta Role');
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Restore selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Restore 2' }));

    const restoredStored = localStorage.getItem(KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(undoButton() as HTMLElement);
    setItem.mockRestore();

    expect(within(undoRegion() as HTMLElement).getByRole('alert')).toHaveTextContent(
      'The undo could not be saved',
    );
    expect(localStorage.getItem(KEY)).toBe(restoredStored);
    expect(stored().every((item) => item.archivedAt === undefined)).toBe(true);
    expect(undoButton()).not.toBeNull();

    fireEvent.click(undoButton() as HTMLElement);

    expect(stored()[0].archivedAt).toBe(ARCHIVED_AT);
    expect(stored()[1].archivedAt).toBe(ARCHIVED_AT);
    expect(undoRegion()).toBeNull();
  });
});

describe('App bulk status', () => {
  it('updates selected active records once, adds one history entry each and excludes archived records', () => {
    const first = makeOpportunity({ id: 'op-1', title: 'Alpha Role', status: 'Applied' });
    const second = makeOpportunity({
      id: 'op-2',
      title: 'Beta Role',
      status: 'Interview',
      notes: 'Keep this note.',
    });
    const archived = makeOpportunity({
      id: 'op-3',
      title: 'Archived Role',
      status: 'Applied',
      archivedAt: ARCHIVED_AT,
    });
    localStorage.setItem(KEY, JSON.stringify([first, second, archived]));

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    selectRow('Beta Role');

    const toolbar = bulkToolbar() as HTMLElement;
    fireEvent.change(
      within(toolbar).getByLabelText('New status for selected opportunities'),
      { target: { value: 'Offer' } },
    );

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Apply status' }));
    const dialog = confirmDialog();
    expect(
      within(dialog).getByRole('heading', {
        name: 'Change status for selected opportunities',
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Change 2 opportunities to Offer\?/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change to Offer' }));
    expect(setItem).toHaveBeenCalledTimes(1);
    setItem.mockRestore();

    const updated = stored();
    expect(updated[0].status).toBe('Offer');
    expect(updated[1].status).toBe('Offer');
    expect(updated[1].notes).toBe('Keep this note.');
    expect(updated[0].activities).toEqual([
      expect.objectContaining({
        type: 'Status changed',
        note: 'Status changed from Applied to Offer.',
      }),
    ]);
    expect(updated[1].activities).toEqual([
      expect.objectContaining({
        type: 'Status changed',
        note: 'Status changed from Interview to Offer.',
      }),
    ]);
    // The archived record is not a bulk-status target.
    expect(updated[2].status).toBe('Applied');
    expect(updated[2].archivedAt).toBe(ARCHIVED_AT);
    expect(updated[2].activities).toEqual([]);

    expect(screen.getByRole('status')).toHaveTextContent('Updated 2 opportunities to Offer.');
    expect(bulkToolbar()).toBeNull();
    // Status changes are not undoable, matching the individual workflow.
    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
  });

  it('reports how many records already had the destination status and leaves them unchanged', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role', status: 'Applied' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role', status: 'Offer' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    selectRow('Beta Role');
    fireEvent.change(
      within(bulkToolbar() as HTMLElement).getByLabelText(
        'New status for selected opportunities',
      ),
      { target: { value: 'Offer' } },
    );
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Apply status' }),
    );

    const dialog = confirmDialog();
    expect(within(dialog).getByText(/Change 1 opportunity to Offer\?/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/1 opportunity already has that status and will not be changed\./),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change to Offer' }));

    const updated = stored();
    expect(updated[0].status).toBe('Offer');
    expect(updated[0].activities).toHaveLength(1);
    expect(updated[1].status).toBe('Offer');
    expect(updated[1].activities).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Updated 1 opportunity to Offer. 1 opportunity already had that status.',
    );
  });

  it('keeps every record unchanged when the status write fails', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role', status: 'Applied' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role', status: 'Interview' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    selectRow('Beta Role');
    fireEvent.change(
      within(bulkToolbar() as HTMLElement).getByLabelText(
        'New status for selected opportunities',
      ),
      { target: { value: 'Rejected' } },
    );
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Apply status' }),
    );

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Change to Rejected' }));
    setItem.mockRestore();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The bulk status change could not be saved',
    );
    const unchanged = stored();
    expect(unchanged[0].status).toBe('Applied');
    expect(unchanged[1].status).toBe('Interview');
    expect(unchanged[0].activities).toEqual([]);
    expect(unchanged[1].activities).toEqual([]);
    expect(within(bulkToolbar() as HTMLElement).getByText('2 selected')).toBeInTheDocument();
  });
});

describe('App bulk selection lifecycle', () => {
  it('clears the selection after navigating away and back', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Alpha Role' })]),
    );

    render(<App />);
    goToOpportunities();
    selectRow('Alpha Role');
    expect(bulkToolbar()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));

    expect(bulkToolbar()).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Alpha Role' })).not.toBeChecked();
  });

  it('invalidates a pending batch Undo after a later saved change', () => {
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
    selectRow('Beta Role');
    fireEvent.click(
      within(bulkToolbar() as HTMLElement).getByRole('button', { name: 'Archive selected' }),
    );
    fireEvent.click(within(confirmDialog()).getByRole('button', { name: 'Archive 2' }));
    expect(undoButton()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Gamma Role' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Renamed Gamma Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
  });
});

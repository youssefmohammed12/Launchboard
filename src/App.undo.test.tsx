import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createJsonBackup } from './utils/exports';
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

function backupFile(opportunities: unknown[]): File {
  const raw = {
    ...JSON.parse(createJsonBackup([])),
    opportunities,
  };
  return new File([JSON.stringify(raw)], 'restore.json', { type: 'application/json' });
}

function selectBackup(file: File): void {
  fireEvent.change(screen.getByLabelText('CSV or JSON file'), {
    target: { files: [file] },
  });
}

function goToOpportunities(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
}

function openDetails(title: string): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `View ${title}` }));
  return screen.getByRole('dialog');
}

function archiveFromDetails(title: string): void {
  const dialog = openDetails(title);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
}

function undoRegion(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Undo notification' });
}

function undoButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: 'Undo' });
}

describe('App Undo for archive and restore', () => {
  it('undoes an archive, restoring active state and preserving every other field', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      status: 'Interview',
      priority: 'High',
      notes: 'Keep these notes.',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();

    const dialog = openDetails('Frontend Intern');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    // The Details dialog stays open and the Undo notification never takes
    // focus away from it.
    expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeInTheDocument();

    const region = undoRegion();
    expect(region).not.toBeNull();
    expect(within(region as HTMLElement).getByRole('button', { name: 'Undo' })).not.toHaveFocus();
    expect(within(region as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived “Frontend Intern”.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(undoButton()).not.toBeNull();

    fireEvent.click(undoButton() as HTMLElement);

    expect(stored()).toHaveLength(1);
    expect(stored()[0].id).toBe('op-1');
    expect(stored()[0].status).toBe('Interview');
    expect(stored()[0].priority).toBe('High');
    expect(stored()[0].notes).toBe('Keep these notes.');
    expect(stored()[0].activities).toEqual([activity]);
    expect(stored()[0].contacts).toEqual([contact]);
    expect(stored()[0].interviews).toEqual([interview]);
    expect(stored()[0].materials).toEqual([material]);
    expect(stored()[0].archivedAt).toBeUndefined();

    // Undo itself never fabricates activity history.
    expect(stored()[0].activities).toHaveLength(1);

    expect(undoRegion()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('“Frontend Intern” is active again.');
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });

  it('undoes a restore, putting the same archive timestamp back', () => {
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      status: 'Applied',
      archivedAt: ARCHIVED_AT,
    });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    const dialog = openDetails('Frontend Intern');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Restored “Frontend Intern”.',
    );
    expect(stored()[0].archivedAt).toBeUndefined();

    fireEvent.click(undoButton() as HTMLElement);

    expect(stored()[0].archivedAt).toBe(ARCHIVED_AT);
    expect(stored()[0].status).toBe('Applied');
    expect(stored()[0].activities).toEqual([]);
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('“Frontend Intern” is archived again.');
  });

  it('keeps only the latest eligible action available to undo', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();

    archiveFromDetails('Alpha Role');
    archiveFromDetails('Beta Role');

    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Archived “Beta Role”.',
    );
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);

    fireEvent.click(undoButton() as HTMLElement);

    const afterUndo = stored();
    expect(afterUndo.find((item) => item.id === 'op-2')?.archivedAt).toBeUndefined();
    expect(afterUndo.find((item) => item.id === 'op-1')?.archivedAt).toBeTypeOf('string');
    expect(screen.queryByRole('button', { name: 'View Alpha Role' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View Beta Role' })).toBeInTheDocument();
  });
});

describe('App Undo for deletion', () => {
  it('restores a deleted active opportunity completely and in its original position', () => {
    const activity = makeActivity({ id: 'activity-1' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const deleted = makeOpportunity({
      id: 'op-2',
      title: 'Frontend Intern',
      status: 'Interview',
      priority: 'High',
      tags: ['remote'],
      deadline: '2026-02-01',
      followUpDate: '2026-01-20',
      compensation: '$2,000 / month',
      description: 'Description',
      notes: 'Notes',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    const other = makeOpportunity({ id: 'op-1', title: 'Other Role' });
    localStorage.setItem(KEY, JSON.stringify([deleted, other]));

    render(<App />);
    goToOpportunities();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Frontend Intern' }));
    const confirm = screen.getByRole('dialog');
    expect(within(confirm).getByRole('heading', { name: 'Delete opportunity' })).toBeInTheDocument();
    expect(within(confirm).getByText(/You can undo this for 10 seconds/)).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(stored().map((item) => item.id)).toEqual(['op-1']);
    expect(within(undoRegion() as HTMLElement).getByRole('status')).toHaveTextContent(
      'Deleted “Frontend Intern”.',
    );

    fireEvent.click(undoButton() as HTMLElement);

    const afterUndo = stored();
    expect(afterUndo).toEqual([deleted, other]);
    expect(afterUndo[0].activities).toEqual([activity]);
    expect(afterUndo[0].interviews).toEqual([interview]);
    expect(afterUndo[0].contacts).toEqual([contact]);
    expect(afterUndo[0].materials).toEqual([material]);
    expect((afterUndo[0].interviews as { contactId: string }[])[0].contactId).toBe('contact-1');
    expect(afterUndo[0].archivedAt).toBeUndefined();
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });

  it('restores a deleted archived opportunity as archived', () => {
    const archived = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });
    localStorage.setItem(KEY, JSON.stringify([archived]));

    render(<App />);
    goToOpportunities();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Frontend Intern' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(stored()).toEqual([]);

    fireEvent.click(undoButton() as HTMLElement);

    expect(stored()[0].archivedAt).toBe(ARCHIVED_AT);
    expect(stored()[0].status).toBe('Rejected');
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });

  it('keeps the delete confirmation safeguard, and Cancel removes nothing', () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Frontend Intern' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete opportunity' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(stored()).toHaveLength(1);
    expect(undoRegion()).toBeNull();
  });

  it('creates no Undo entry when the deletion cannot be persisted', () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Frontend Intern' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    setItem.mockRestore();

    expect(stored()).toHaveLength(1);
    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('The deletion could not be saved');
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });
});

describe('App Undo persistence and timing', () => {
  it('does not change anything when the Undo write fails, then succeeds on retry', () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');

    const archivedStored = localStorage.getItem(KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    fireEvent.click(undoButton() as HTMLElement);

    expect(within(undoRegion() as HTMLElement).getByRole('alert')).toHaveTextContent(
      'could not be saved',
    );
    // No success announcement, no hidden state change, Undo still available.
    expect(screen.queryByText(/is active again/)).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(archivedStored);
    expect(screen.queryByRole('button', { name: 'View Frontend Intern' })).not.toBeInTheDocument();
    expect(undoButton()).not.toBeNull();

    setItem.mockRestore();
    fireEvent.click(undoButton() as HTMLElement);

    expect(stored()[0].archivedAt).toBeUndefined();
    expect(undoRegion()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('“Frontend Intern” is active again.');
  });

  it('expires the Undo opportunity after ten seconds', () => {
    vi.useFakeTimers();
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');

    expect(undoButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
    // The completed archive remains persisted.
    expect(typeof stored()[0].archivedAt).toBe('string');
  });

  it('dismissing the notification clears the Undo without reversing the action', () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss undo notification' }));

    expect(undoRegion()).toBeNull();
    expect(typeof stored()[0].archivedAt).toBe('string');
  });

  it('does not offer Undo after a reload', () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    const view = render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');
    expect(undoButton()).not.toBeNull();

    view.unmount();
    render(<App />);
    goToOpportunities();

    expect(undoButton()).toBeNull();
    expect(undoRegion()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });

  it('invalidates the Undo when a later opportunity change is saved', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ]),
    );

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Alpha Role');
    expect(undoButton()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Beta Role' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Renamed Beta Role' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
    expect(stored().find((item) => item.id === 'op-1')?.archivedAt).toBeTypeOf('string');
  });
});

describe('App Undo and JSON import', () => {
  it('invalidates a pending Undo after an import commits a changed collection', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');
    expect(undoButton()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV / JSON' }));
    selectBackup(backupFile([makeOpportunity({ id: 'incoming', title: 'Incoming Role' })]));
    expect(await screen.findByRole('heading', { name: 'Backup preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(await screen.findByText(/Import complete\. Added 1 record\./)).toBeInTheDocument();
    expect(undoRegion()).toBeNull();
    expect(undoButton()).toBeNull();
  });

  it('keeps a still-valid Undo when the import fails to persist', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );

    render(<App />);
    goToOpportunities();
    archiveFromDetails('Frontend Intern');

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV / JSON' }));

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    selectBackup(backupFile([makeOpportunity({ id: 'incoming', title: 'Incoming Role' })]));
    expect(await screen.findByRole('heading', { name: 'Backup preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    setItem.mockRestore();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(undoButton()).not.toBeNull());

    fireEvent.click(undoButton() as HTMLElement);
    expect(stored()[0].archivedAt).toBeUndefined();
  });
});

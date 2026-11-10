import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isValidArchiveTimestamp } from './utils/archive';
import { addDays, toISODate } from './utils/dates';
import { createJsonBackup } from './utils/exports';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from './test/fixtures';
import App from './App';
import type { TaskEntry } from '@launchboard/domain';

const KEY = 'launchboard.opportunities.v1';

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

function totalCardValue(): HTMLElement {
  const card = screen.getByText('Total Opportunities').closest('div');
  if (!card) throw new Error('Total Opportunities card was not found');
  return within(card as HTMLElement).getByText(/^\d+$/);
}

describe('App JSON restoration', () => {  it('does not show or store an import that failed to persist, then succeeds on retry', async () => {
    const current = makeOpportunity({ id: 'current', title: 'Current Role' });
    const incoming = makeOpportunity({ id: 'incoming', title: 'Incoming Role' });
    localStorage.setItem(KEY, JSON.stringify([current]));
    const originalStored = localStorage.getItem(KEY);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(totalCardValue()).toHaveTextContent('1');

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV / JSON' }));
    selectBackup(backupFile([incoming]));
    expect(await screen.findByRole('heading', { name: 'Backup preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.queryByText(/Import complete/)).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(originalStored);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(totalCardValue()).toHaveTextContent('1');

    setItem.mockRestore();

    fireEvent.click(screen.getByRole('button', { name: 'Import CSV / JSON' }));
    selectBackup(backupFile([incoming]));
    expect(await screen.findByRole('heading', { name: 'Backup preview' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(await screen.findByText(/Import complete\. Added 1 record\./)).toBeInTheDocument();
    expect(totalCardValue()).toHaveTextContent('2');

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id: string }[];
    expect(stored.map((item) => item.id)).toEqual(['current', 'incoming']);
  });
});

describe('App interview integration', () => {
  it('adds an interview in details and persists it with the opportunity', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Technical Interview' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      interviews: { id: string; round: string; status: string }[];
    }[];
    expect(stored[0].interviews).toHaveLength(1);
    expect(stored[0].interviews[0]).toMatchObject({
      round: 'Technical Interview',
      status: 'Scheduled',
    });
    expect(stored[0].interviews[0].id).toBeTruthy();
  });

  it('preserves all nested workspace data when core opportunity fields are edited', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    const interview = makeInterview({
      id: 'round-1',
      round: 'Hiring Manager Interview',
      status: 'Completed',
      outcome: 'Positive',
      preparationNotes: 'Keep this preparation note.',
      contactId: 'contact-1',
    });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          activities: [activity],
          interviews: [interview],
          contacts: [contact],
          materials: [material],
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Frontend Intern' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Updated Frontend Intern' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      title: string;
      activities: (typeof activity)[];
      interviews: (typeof interview)[];
      contacts: (typeof contact)[];
      materials: (typeof material)[];
    }[];
    expect(stored[0].title).toBe('Updated Frontend Intern');
    expect(stored[0].activities).toEqual([activity]);
    expect(stored[0].interviews).toEqual([interview]);
    expect(stored[0].contacts).toEqual([contact]);
    expect(stored[0].materials).toEqual([material]);
    expect(stored[0].interviews[0].contactId).toBe('contact-1');
  });

  it('does not change opportunity status when an interview is completed', () => {
    const interview = makeInterview({ id: 'round-1' });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          status: 'Applied',
          interviews: [interview],
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark completed: Recruiter Screen' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      interviews: { status: string }[];
    }[];
    expect(stored[0].status).toBe('Applied');
    expect(stored[0].interviews[0].status).toBe('Completed');
  });
});

describe('App dashboard integration', () => {
  it('opens the correct opportunity from a Next 7 Days event', () => {
    const interview = makeInterview({
      id: 'round-1',
      round: 'Technical Round',
      date: addDays(1),
      time: '10:30',
      mode: 'Video',
      status: 'Scheduled',
    });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          interviews: [interview],
        }),
      ]),
    );

    render(<App />);
    expect(screen.getByRole('heading', { name: 'Next 7 Days' })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Open Frontend Intern for Technical Round interview \(Scheduled\) on .* at 10:30/,
      }),
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]).getByText('Technical Round')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Next 7 Days' })).toBeInTheDocument();
  });

  it('navigates from the Dashboard summary to the Calendar', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', deadline: addDays(1) }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'View calendar' }));

    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Next 7 Days' })).not.toBeInTheDocument();
  });
});

describe('App contacts and materials integration', () => {
  it('adds and edits a contact without changing the opportunity status', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', status: 'Applied' }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Alex Chen' } });
    fireEvent.change(screen.getByLabelText(/Role or title/), {
      target: { value: 'Engineering Manager' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact Alex Chen' }));
    fireEvent.change(screen.getByLabelText(/Role or title/), {
      target: { value: 'Director of Engineering' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      contacts: { id: string; name: string; role: string }[];
    }[];
    expect(stored[0].status).toBe('Applied');
    expect(stored[0].contacts).toHaveLength(1);
    expect(stored[0].contacts[0].id).toBeTruthy();
    expect(stored[0].contacts[0]).toMatchObject({
      name: 'Alex Chen',
      role: 'Director of Engineering',
    });
  });

  it('links an interview to a contact from the details form', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter' });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', contacts: [contact] }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Recruiter Screen' },
    });
    fireEvent.change(screen.getByLabelText('Contact (optional)'), {
      target: { value: 'contact-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      interviews: { contactId: string }[];
    }[];
    expect(stored[0].interviews[0].contactId).toBe('contact-1');
  });

  it('clears contact links on deletion while preserving interviews, history and materials', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const linked = makeInterview({
      id: 'round-1',
      round: 'Recruiter Screen',
      status: 'Completed',
      outcome: 'Positive',
      notes: 'Keep this history.',
      contactId: 'contact-1',
    });
    const unlinked = makeInterview({
      id: 'round-2',
      round: 'Technical Interview',
      date: '2026-02-01',
      contactId: '',
    });
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          status: 'Applied',
          contacts: [contact],
          interviews: [linked, unlinked],
          materials: [material],
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete contact Jordan Lee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete contact: Jordan Lee' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      contacts: unknown[];
      interviews: { id: string; status: string; outcome: string; notes: string; contactId: string }[];
      materials: { id: string }[];
    }[];
    expect(stored[0].status).toBe('Applied');
    expect(stored[0].contacts).toEqual([]);
    expect(stored[0].interviews).toHaveLength(2);
    expect(stored[0].interviews[0]).toMatchObject({
      id: 'round-1',
      status: 'Completed',
      outcome: 'Positive',
      notes: 'Keep this history.',
      contactId: '',
    });
    expect(stored[0].interviews[1]).toMatchObject({ id: 'round-2', contactId: '' });
    expect(stored[0].materials).toEqual([material]);
  });

  it('preserves nested workspace data when status changes on the board', () => {
    const contact = makeContact({ id: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          status: 'Applied',
          contacts: [contact],
          materials: [material],
          interviews: [interview],
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
    fireEvent.change(screen.getByLabelText('Change status for Frontend Intern'), {
      target: { value: 'Interview' },
    });

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      contacts: (typeof contact)[];
      materials: (typeof material)[];
      interviews: (typeof interview)[];
      activities: { type: string }[];
    }[];
    expect(stored[0].status).toBe('Interview');
    expect(stored[0].contacts).toEqual([contact]);
    expect(stored[0].materials).toEqual([material]);
    expect(stored[0].interviews).toEqual([interview]);
    expect(stored[0].activities[0].type).toBe('Status changed');
  });

  it('opens the parent opportunity from an interview calendar event', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter' });
    const interview = makeInterview({
      id: 'round-1',
      round: 'Recruiter Screen',
      date: addDays(1),
      contactId: 'contact-1',
    });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          contacts: [contact],
          interviews: [interview],
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(
      screen.getByRole('heading', { name: 'Calendar' }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', {
        name: /Open Frontend Intern for Recruiter Screen interview \(Scheduled\)/,
      }),
    );

    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]).getByText('Recruiter Screen')).toBeInTheDocument();
    expect(within(dialogs[0]).getAllByText('Jordan Lee').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
  });

  it('adds a material with an empty URL without changing the opportunity status', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', status: 'Applied' }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Draft resume' } });
    fireEvent.change(screen.getByLabelText(/Version/), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      materials: {
        id: string;
        label: string;
        kind: string;
        url: string;
        version: string;
        status: string;
      }[];
    }[];
    expect(stored[0].status).toBe('Applied');
    expect(stored[0].materials).toHaveLength(1);
    expect(stored[0].materials[0]).toMatchObject({
      label: 'Draft resume',
      kind: 'Resume',
      url: '',
      version: 'v1',
      status: 'Draft',
    });
    expect(stored[0].materials[0].id).toBeTruthy();
  });
});

describe('App archive and restore', () => {
  it('archives after persisting, keeps the record inspectable, then restores it', async () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      status: 'Applied',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
    });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    const storedAfterArchive = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      archivedAt?: string;
      activities: typeof activity[];
      contacts: typeof contact[];
      interviews: typeof interview[];
    }[];
    expect(isValidArchiveTimestamp(storedAfterArchive[0].archivedAt)).toBe(true);
    expect(storedAfterArchive[0].status).toBe('Applied');
    expect(storedAfterArchive[0].activities).toEqual([activity]);
    expect(storedAfterArchive[0].contacts).toEqual([contact]);
    expect(storedAfterArchive[0].interviews).toEqual([interview]);

    expect(within(dialog).getByText('Archived')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Archived “Frontend Intern”. It is available in the Archived view.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(document.getElementById('main-content')).toHaveFocus(),
    );
    expect(
      screen.queryByRole('button', { name: 'View Frontend Intern' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));

    const archivedDialog = screen.getByRole('dialog');
    fireEvent.click(within(archivedDialog).getByRole('button', { name: 'Restore' }));

    const storedAfterRestore = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      archivedAt?: string;
      activities: typeof activity[];
      contacts: typeof contact[];
      interviews: typeof interview[];
    }[];
    expect(storedAfterRestore[0].archivedAt).toBeUndefined();
    expect(storedAfterRestore[0].status).toBe('Applied');
    expect(storedAfterRestore[0].activities).toEqual([activity]);
    expect(storedAfterRestore[0].contacts).toEqual([contact]);
    expect(storedAfterRestore[0].interviews).toEqual([interview]);
    expect(within(archivedDialog).getByRole('button', { name: 'Archive' })).toBeInTheDocument();

    fireEvent.click(within(archivedDialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('No archived opportunities.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getByRole('button', { name: 'View Frontend Intern' })).toBeInTheDocument();
  });

  it('persists a specialized archive operation with exactly one collection write', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));

    const collectionWrites = setItem.mock.calls.filter(([key]) => key === KEY);
    expect(collectionWrites).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    setItem.mockRestore();
  });

  it('preserves archive state when a status or core edit changes', () => {
    const archivedAt = '2026-03-04T09:30:00.000Z';
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({
          id: 'op-1',
          title: 'Frontend Intern',
          status: 'Applied',
          archivedAt,
        }),
      ]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));
    fireEvent.change(screen.getByLabelText('Change status for Frontend Intern'), {
      target: { value: 'Interview' },
    });

    const afterStatus = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      archivedAt?: string;
    }[];
    expect(afterStatus[0]).toMatchObject({ status: 'Interview', archivedAt });

    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Frontend Intern' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Updated Frontend Intern' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const afterEdit = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      title: string;
      status: string;
      archivedAt?: string;
      activities: { type: string }[];
    }[];
    expect(afterEdit[0]).toMatchObject({
      title: 'Updated Frontend Intern',
      status: 'Interview',
      archivedAt,
    });
    // The board status change has history, but archive/restore itself does not.
    expect(afterEdit[0].activities.map((activity) => activity.type)).toEqual(['Status changed']);
  });

  it('does not change archive state when the write fails, then retries successfully', async () => {
    const item = makeOpportunity({ id: 'op-1', title: 'Frontend Intern', status: 'Saved' });
    localStorage.setItem(KEY, JSON.stringify([item]));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));

    const dialog = screen.getByRole('dialog');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('could not be saved');
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')[0].archivedAt).toBeUndefined();
    // A failed original action never creates an Undo opportunity.
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();

    setItem.mockRestore();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      archivedAt?: string;
    }[];
    expect(isValidArchiveTimestamp(stored[0].archivedAt)).toBe(true);
    expect(stored[0].status).toBe('Saved');
  });
});

describe('App ordinary mutation persistence', () => {
  it('does not add an opportunity or close the form when creation cannot be saved', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Existing Role' })]),
    );
    const before = localStorage.getItem(KEY);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Opportunity' }));
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'New Role' } });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Acme' },
    });
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Internship' } });

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('heading', { name: 'Add opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('New Role');
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
    expect(localStorage.getItem(KEY)).toBe(before);

    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('heading', { name: 'Add opportunity' })).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored.map((item) => item.title)).toEqual(['Existing Role', 'New Role']);
  });

  it('keeps the edit form open with entered values when an update cannot be saved', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );
    const before = localStorage.getItem(KEY);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Frontend Intern' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Updated Frontend Intern' },
    });

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('heading', { name: 'Edit opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('Updated Frontend Intern');
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
    expect(localStorage.getItem(KEY)).toBe(before);

    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByRole('heading', { name: 'Edit opportunity' })).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored[0].title).toBe('Updated Frontend Intern');
  });

  it('does not change status or add history when a board status update cannot be saved', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', status: 'Applied' }),
      ]),
    );
    const before = localStorage.getItem(KEY);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.change(screen.getByLabelText('Change status for Frontend Intern'), {
      target: { value: 'Interview' },
    });

    expect(localStorage.getItem(KEY)).toBe(before);
    expect(screen.getByLabelText('Change status for Frontend Intern')).toHaveValue('Applied');
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
    const failed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      activities: unknown[];
    }[];
    expect(failed[0].status).toBe('Applied');
    expect(failed[0].activities).toEqual([]);

    setItem.mockRestore();
    fireEvent.change(screen.getByLabelText('Change status for Frontend Intern'), {
      target: { value: 'Interview' },
    });

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      status: string;
      activities: { type: string }[];
    }[];
    expect(stored[0].status).toBe('Interview');
    expect(stored[0].activities.map((activity) => activity.type)).toEqual(['Status changed']);
  });

  it('keeps a nested material editor open and unchanged when the write fails', () => {
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Frontend Intern', materials: [material] }),
      ]),
    );
    const before = localStorage.getItem(KEY);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit material Frontend Resume' }));
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: 'Updated Resume' },
    });

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(screen.getByRole('heading', { name: 'Edit material' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Label/)).toHaveValue('Updated Resume');
    expect(screen.getByRole('alert')).toHaveTextContent('Changes could not be saved');
    expect(localStorage.getItem(KEY)).toBe(before);

    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(screen.queryByRole('heading', { name: 'Edit material' })).not.toBeInTheDocument();
    expect(screen.getByText('Updated Resume')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      materials: { label: string }[];
    }[];
    expect(stored[0].materials[0].label).toBe('Updated Resume');
  });

  it('preserves a pending Undo when an ordinary nested write fails, then clears it on success', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add material' }));
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: 'Draft resume' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Changes could not be saved');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add material' })).toBeInTheDocument();
    const failed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      archivedAt?: string;
      materials: unknown[];
    }[];
    expect(typeof failed[0].archivedAt).toBe('string');
    expect(failed[0].materials).toEqual([]);

    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      materials: { label: string }[];
    }[];
    expect(stored[0].materials).toHaveLength(1);
    expect(stored[0].materials[0].label).toBe('Draft resume');
  });
});

describe('App Action Center integration', () => {
  it('creates and completes a task in local mode and persists it with its opportunity', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]),
    );

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getByRole('heading', { name: 'Action Center' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add task' });
    fireEvent.change(within(dialog).getByLabelText(/Task title/), {
      target: { value: 'Prepare the application' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Add task' })).not.toBeInTheDocument();
    });
    const created = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      id: string;
      tasks: TaskEntry[];
    }[];
    expect(created[0].tasks).toHaveLength(1);
    expect(created[0].tasks[0]).toMatchObject({
      title: 'Prepare the application',
      completed: false,
      completedOn: '',
    });

    const completeButton = screen.getByRole('button', {
      name: 'Mark Prepare the application complete',
    });
    expect(completeButton).toBeEnabled();
    fireEvent.click(completeButton);

    expect(await screen.findByRole('button', {
      name: 'Reopen Prepare the application',
    })).toBeInTheDocument();

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
        id: string;
        tasks: TaskEntry[];
      }[];
      expect(stored[0].tasks[0]).toMatchObject({
        id: created[0].tasks[0].id,
        completed: true,
        completedOn: toISODate(new Date()),
      });
    });
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();
  });
});

function formatLocalDateForTest(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

describe('App Dashboard and Calendar task navigation', () => {
  it('opens the focused task action from Today’s Focus and the Calendar Tasks filter', async () => {
    const today = toISODate(new Date());
    const opportunity = makeOpportunity({
      id: 'stage-five-opportunity',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      tasks: [{
        id: 'stage-five-task',
        title: 'Tailor my CV',
        notes: '',
        priority: 'High',
        dueDate: today,
        completed: false,
        completedOn: '',
      }],
    });
    localStorage.setItem(KEY, JSON.stringify([opportunity]));

    render(<App />);

    const dashboardTask = screen.getByRole('button', {
      name: 'Open task Tailor my CV for Frontend Intern',
    });
    fireEvent.click(dashboardTask);

    expect(screen.getByRole('heading', { name: 'Action Center' })).toBeInTheDocument();
    const completeFromDashboard = await screen.findByRole('button', {
      name: 'Mark Tailor my CV complete',
    });
    await waitFor(() => expect(completeFromDashboard).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    const selectedDay = screen.getByRole('heading', { name: 'Selected day' }).closest('section');
    expect(selectedDay).not.toBeNull();
    const calendarTask = within(selectedDay as HTMLElement).getByRole('button', {
      name: `Open task Tailor my CV for Frontend Intern on ${formatLocalDateForTest(today)}`,
    });
    fireEvent.click(calendarTask);

    expect(screen.getByRole('heading', { name: 'Action Center' })).toBeInTheDocument();
    const completeFromCalendar = await screen.findByRole('button', {
      name: 'Mark Tailor my CV complete',
    });
    await waitFor(() => expect(completeFromCalendar).toHaveFocus());
  });
});

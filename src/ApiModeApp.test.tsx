import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from './test/fixtures';
import type { AuthState, UseAuthResult } from './hooks/useAuth';
import type {
  OpportunityCollection,
  OpportunityResource,
} from './data/httpOpportunityRepository';
import { ApiRequestError } from './data/apiClient';
import { useAuth } from './hooks/useAuth';
import ApiModeApp from './ApiModeApp';

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  remove: vi.fn(),
  bulkArchive: vi.fn(),
  bulkRestore: vi.fn(),
  bulkStatus: vi.fn(),
  bulkDelete: vi.fn(),
  undoArchive: vi.fn(),
  restoreDeletion: vi.fn(),
  importBackup: vi.fn(),
  exportBackup: vi.fn(),
  signOut: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('./hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('./data/httpOpportunityRepository', () => ({
  HttpOpportunityRepository: class {
    load = mocks.load;
    get = mocks.get;
    create = mocks.create;
    update = mocks.update;
    archive = mocks.archive;
    restore = mocks.restore;
    remove = mocks.remove;
    bulkArchive = mocks.bulkArchive;
    bulkRestore = mocks.bulkRestore;
    bulkStatus = mocks.bulkStatus;
    bulkDelete = mocks.bulkDelete;
    undoArchive = mocks.undoArchive;
    restoreDeletion = mocks.restoreDeletion;
    importBackup = mocks.importBackup;
    exportBackup = mocks.exportBackup;
  },
}));
vi.mock('./components/LocalMigrationDialog', () => ({
  LocalMigrationDialog: ({
    userId,
    onClose,
  }: {
    userId: string;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Migration">
      <p>Migration account: {userId}</p>
      <button type="button" onClick={onClose}>Close migration</button>
    </div>
  ),
}));

const authenticatedState: AuthState = {
  status: 'authenticated',
  user: { id: 'user-1', email: 'person@example.com' },
};
const collection: OpportunityCollection = {
  revision: 7,
  items: [{
    opportunity: makeOpportunity({ id: 'server-1', title: 'Server role', company: 'Northwind' }),
    version: 4,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  }],
};

function configureAuth(state: AuthState = authenticatedState) {
  vi.mocked(useAuth).mockReturnValue({
    state,
    busy: false,
    refresh: mocks.refresh,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: mocks.signOut,
  } as UseAuthResult);
}

beforeEach(() => {
  mocks.load.mockReset();
  mocks.get.mockReset();
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.archive.mockReset();
  mocks.restore.mockReset();
  mocks.remove.mockReset();
  mocks.bulkArchive.mockReset();
  mocks.bulkRestore.mockReset();
  mocks.bulkStatus.mockReset();
  mocks.bulkDelete.mockReset();
  mocks.undoArchive.mockReset();
  mocks.restoreDeletion.mockReset();
  mocks.importBackup.mockReset();
  mocks.exportBackup.mockReset();
  mocks.signOut.mockReset();
  mocks.refresh.mockReset();
  configureAuth();
});

afterEach(() => {
  localStorage.clear();
});

describe('ApiModeApp', () => {
  it('restores auth and loads the authenticated server collection', async () => {
    mocks.load.mockResolvedValue(collection);

    render(<ApiModeApp />);

    expect(await screen.findByText('Server role')).toBeInTheDocument();
    expect(screen.getByText('Your workspace is up to date')).toBeInTheDocument();
    expect(screen.getByText(/opportunities tracked · revision 7/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add opportunity' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledWith('all');
  });

  it('offers authentication when there is no active session', () => {
    configureAuth({ status: 'anonymous' });

    render(<ApiModeApp />);

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('keeps server outages distinct from the signed-out state', () => {
    configureAuth({ status: 'unavailable', error: 'Cannot reach API.' });

    render(<ApiModeApp />);

    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach API.');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
  });

  it('isolates collections across account changes and ignores late responses from the prior account', async () => {
    let resolveFirstAccount!: (value: OpportunityCollection) => void;
    const firstAccountRequest = new Promise<OpportunityCollection>((resolve) => {
      resolveFirstAccount = resolve;
    });
    const secondAccountCollection: OpportunityCollection = {
      revision: 12,
      items: [{
        ...collection.items[0],
        opportunity: makeOpportunity({
          id: 'server-2',
          title: 'Account two role',
          company: 'Contoso',
        }),
      }],
    };
    mocks.load
      .mockReturnValueOnce(firstAccountRequest)
      .mockResolvedValueOnce(secondAccountCollection);

    const { rerender } = render(<ApiModeApp />);
    configureAuth({
      status: 'authenticated',
      user: { id: 'user-2', email: 'second@example.com' },
    });
    rerender(<ApiModeApp />);

    expect(await screen.findByText('Account two role')).toBeInTheDocument();
    resolveFirstAccount(collection);

    await waitFor(() => {
      expect(screen.getByText('Account two role')).toBeInTheDocument();
      expect(screen.queryByText('Server role')).not.toBeInTheDocument();
    });
  });

  it('allows the user to retry a failed collection read', async () => {
    mocks.load
      .mockRejectedValueOnce(new Error('network issue'))
      .mockResolvedValueOnce(collection);

    render(<ApiModeApp />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The request could not be completed. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('Server role')).toBeInTheDocument());
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('opens migration for the active user and signs out through the auth hook', async () => {
    mocks.load.mockResolvedValue(collection);

    render(<ApiModeApp />);

    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'Migrate local data' }));
    expect(screen.getByRole('dialog', { name: 'Migration' })).toHaveTextContent('user-1');
    fireEvent.click(screen.getByRole('button', { name: 'Close migration' }));
    expect(screen.queryByRole('dialog', { name: 'Migration' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('creates an opportunity through the server API using the validated async form', async () => {
    const empty: OpportunityCollection = { revision: 7, items: [] };
    mocks.load.mockResolvedValueOnce(empty).mockResolvedValueOnce(collection);
    mocks.create.mockResolvedValue(collection.items[0]);

    render(<ApiModeApp />);
    await screen.findByText('You have no opportunities yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add opportunity' }));

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Server role' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Northwind' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Server role');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.any(String),
      title: 'Server role',
      company: 'Northwind',
      activities: [],
      interviews: [],
      contacts: [],
      materials: [],
    }));
  });

  it('updates using the loaded server version and preserves the existing record as the comparison source', async () => {
    mocks.load.mockResolvedValue(collection);
    const updated = {
      ...collection.items[0],
      opportunity: { ...collection.items[0].opportunity, title: 'Updated role' },
      version: 5,
    };
    mocks.update.mockResolvedValue(updated);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Server role' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Updated role' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Updated role');
    expect(mocks.update).toHaveBeenCalledWith(
      'server-1',
      4,
      collection.items[0].opportunity,
      expect.objectContaining({ title: 'Updated role' }),
      undefined,
    );
  });

  it('archives and restores with the resource version', async () => {
    const archivedResource = {
      ...collection.items[0],
      opportunity: {
        ...collection.items[0].opportunity,
        archivedAt: '2026-11-01T18:00:00.000Z',
      },
      version: 5,
    };
    const archivedCollection: OpportunityCollection = {
      revision: 8,
      items: [archivedResource],
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce(archivedCollection)
      .mockResolvedValueOnce(collection);
    mocks.get
      .mockResolvedValueOnce(collection.items[0])
      .mockResolvedValueOnce(archivedResource);
    mocks.archive.mockResolvedValue(archivedResource);
    mocks.restore.mockResolvedValue(collection.items[0]);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('server-1', 4));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(mocks.restore).toHaveBeenCalledWith('server-1', 5));
  });

  it('soft-deletes and restores the same deletion batch through Undo', async () => {
    const empty: OpportunityCollection = { revision: 8, items: [] };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(collection);
    const batch = {
      deletionBatchId: 'batch-1',
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      deleted: [{ id: 'server-1', version: 5 }],
    };
    mocks.remove.mockResolvedValue(batch);
    mocks.restoreDeletion.mockResolvedValue({ revision: 9, items: collection.items });

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Server role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete opportunity' }));

    await screen.findByRole('button', { name: 'Undo delete' });
    expect(mocks.remove).toHaveBeenCalledWith('server-1', 4);
    await screen.findByText('You have no opportunities yet.');

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await waitFor(() => expect(mocks.restoreDeletion).toHaveBeenCalledWith('batch-1'));
    expect(await screen.findByText('Server role')).toBeInTheDocument();
  });

  it('loads the latest aggregate and persists contact changes using its current server version', async () => {
    const original = collection.items[0];
    const updatedOpportunity = {
      ...original.opportunity,
      contacts: [{
        id: 'contact-new',
        name: 'Morgan Lee',
        role: 'Recruiter',
        email: 'morgan@example.com',
        phone: '',
        website: '',
        notes: '',
      }],
    };
    const updatedResource: OpportunityResource = {
      ...original,
      version: 5,
      opportunity: updatedOpportunity,
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce({ revision: 8, items: [updatedResource] });
    mocks.get.mockResolvedValue(original);
    mocks.update.mockResolvedValue(updatedResource);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));
    expect(await screen.findByRole('heading', { name: 'Contacts' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.change(screen.getByLabelText(/Name/), {
      target: { value: 'Morgan Lee' },
    });
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: 'morgan@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    await screen.findByText('Morgan Lee');
    expect(mocks.get).toHaveBeenCalledWith('server-1');
    expect(mocks.update).toHaveBeenCalledWith(
      'server-1',
      4,
      original.opportunity,
      expect.objectContaining({
        contacts: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            name: 'Morgan Lee',
            email: 'morgan@example.com',
          }),
        ]),
      }),
    );
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });

  it('persists user activities without attempting to write system-generated history', async () => {
    const original = collection.items[0];
    const updatedResource: OpportunityResource = {
      ...original,
      version: 5,
      opportunity: {
        ...original.opportunity,
        activities: [{
          id: 'activity-new',
          type: 'Other',
          date: '2026-11-01',
          note: 'Discussed interview timeline.',
        }],
      },
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce({ revision: 8, items: [updatedResource] });
    mocks.get.mockResolvedValue(original);
    mocks.update.mockResolvedValue(updatedResource);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));

    fireEvent.change(screen.getByLabelText('Activity type'), {
      target: { value: 'Other' },
    });
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Discussed interview timeline.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add activity/i }));

    await screen.findByText('Discussed interview timeline.');
    expect(mocks.update).toHaveBeenCalledWith(
      'server-1',
      4,
      original.opportunity,
      expect.objectContaining({
        activities: expect.arrayContaining([
          expect.objectContaining({
            type: 'Other',
            note: 'Discussed interview timeline.',
          }),
        ]),
      }),
    );
  });

  it('persists interview creation through the versioned server aggregate', async () => {
    const original = collection.items[0];
    const updatedResource: OpportunityResource = {
      ...original,
      version: 5,
      opportunity: {
        ...original.opportunity,
        interviews: [{
          id: 'interview-new',
          round: 'Hiring Manager',
          date: '2026-11-10',
          time: '14:30',
          mode: 'Video',
          status: 'Scheduled',
          outcome: '',
          meetingUrl: '',
          location: '',
          preparationNotes: '',
          notes: '',
          contactId: '',
        }],
      },
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce({ revision: 8, items: [updatedResource] });
    mocks.get.mockResolvedValue(original);
    mocks.update.mockResolvedValue(updatedResource);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));
    expect(await screen.findByRole('heading', { name: 'Interviews' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Hiring Manager' },
    });
    fireEvent.change(screen.getByLabelText(/Interview date/), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(screen.getByLabelText(/Interview time/), {
      target: { value: '14:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    await screen.findByText('Hiring Manager');
    expect(mocks.get).toHaveBeenCalledWith('server-1');
    expect(mocks.update).toHaveBeenCalledWith(
      'server-1',
      4,
      original.opportunity,
      expect.objectContaining({
        interviews: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            round: 'Hiring Manager',
            date: '2026-11-10',
            time: '14:30',
          }),
        ]),
      }),
    );
  });

  it('persists material creation through the versioned server aggregate', async () => {
    const original = collection.items[0];
    const updatedResource: OpportunityResource = {
      ...original,
      version: 5,
      opportunity: {
        ...original.opportunity,
        materials: [{
          id: 'material-new',
          label: 'Frontend resume',
          kind: 'Resume',
          url: 'https://example.com/resume.pdf',
          version: 'v2',
          status: 'Ready',
          notes: 'Updated frontend projects.',
        }],
      },
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce({ revision: 8, items: [updatedResource] });
    mocks.get.mockResolvedValue(original);
    mocks.update.mockResolvedValue(updatedResource);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));
    expect(await screen.findByRole('heading', { name: 'Application materials' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add material' }));
    fireEvent.change(screen.getByLabelText(/Label/), {
      target: { value: 'Frontend resume' },
    });
    fireEvent.change(screen.getByLabelText(/Version/), {
      target: { value: 'v2' },
    });
    fireEvent.change(screen.getByLabelText(/Link/), {
      target: { value: 'https://example.com/resume.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save material' }));

    await screen.findByText('Frontend resume');
    expect(mocks.get).toHaveBeenCalledWith('server-1');
    expect(mocks.update).toHaveBeenCalledWith(
      'server-1',
      4,
      original.opportunity,
      expect.objectContaining({
        materials: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            label: 'Frontend resume',
            version: 'v2',
            url: 'https://example.com/resume.pdf',
          }),
        ]),
      }),
    );
  });

  it("refreshes a stale edit base but preserves the user's unsaved fields and server-side nested data", async () => {
    const original = collection.items[0].opportunity;
    const latest: OpportunityResource = {
      ...collection.items[0],
      version: 5,
      opportunity: {
        ...original,
        notes: 'A note added from another tab.',
        contacts: [{
          id: 'contact-latest',
          name: 'Morgan Lee',
          role: 'Recruiter',
          email: 'morgan@example.com',
          phone: '',
          website: '',
          notes: '',
        }],
      },
    };
    const updated: OpportunityResource = {
      ...latest,
      version: 6,
      opportunity: { ...latest.opportunity, title: 'My updated title' },
    };
    mocks.load.mockResolvedValueOnce(collection).mockResolvedValue({
      revision: 9,
      items: [updated],
    });
    mocks.get.mockResolvedValue(latest);
    mocks.update
      .mockRejectedValueOnce(new ApiRequestError('Stale version.', {
        status: 409,
        code: 'STALE_VERSION',
      }))
      .mockResolvedValueOnce(updated);

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Server role' }));
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'My updated title' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A newer version was found');
    expect(screen.getByLabelText(/Title/)).toHaveValue('My updated title');
    expect(screen.getByLabelText(/Personal notes/)).toHaveValue('A note added from another tab.');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('My updated title')).toBeInTheDocument();
    expect(mocks.update).toHaveBeenNthCalledWith(
      2,
      'server-1',
      5,
      expect.objectContaining({
        title: 'My updated title',
        notes: 'A note added from another tab.',
        contacts: latest.opportunity.contacts,
      }),
      expect.objectContaining({
        title: 'My updated title',
        notes: 'A note added from another tab.',
        contacts: latest.opportunity.contacts,
      }),
      undefined,
    );
  });

  it('bulk archives selected active opportunities and safely undoes the archive batch', async () => {
    const archivedResource: OpportunityResource = {
      ...collection.items[0],
      opportunity: {
        ...collection.items[0].opportunity,
        archivedAt: '2026-11-01T18:00:00.000Z',
      },
      version: 5,
    };
    const archivedCollection: OpportunityCollection = {
      revision: 8,
      items: [archivedResource],
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce(archivedCollection)
      .mockResolvedValueOnce(collection);
    mocks.bulkArchive.mockResolvedValue({ revision: 8, items: [archivedResource] });
    mocks.undoArchive.mockResolvedValue({ revision: 9, items: collection.items });

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByLabelText('Select all visible opportunities'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive selected' }));

    expect(await screen.findByRole('button', { name: 'Undo archive change' })).toBeInTheDocument();
    expect(mocks.bulkArchive).toHaveBeenCalledWith([
      { id: 'server-1', expectedVersion: 4 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo archive change' }));
    await waitFor(() => expect(mocks.undoArchive).toHaveBeenCalledWith([
      {
        id: 'server-1',
        expectedArchivedAt: '2026-11-01T18:00:00.000Z',
        previousArchivedAt: null,
      },
    ]));
    expect(await screen.findByText('Server role')).toBeInTheDocument();
  });

  it('bulk restores archived opportunities and can undo that restore', async () => {
    const archivedResource: OpportunityResource = {
      ...collection.items[0],
      opportunity: {
        ...collection.items[0].opportunity,
        archivedAt: '2026-10-30T12:00:00.000Z',
      },
      version: 5,
    };
    const archivedCollection: OpportunityCollection = {
      revision: 8,
      items: [archivedResource],
    };
    const restoredResource: OpportunityResource = {
      ...archivedResource,
      opportunity: { ...archivedResource.opportunity, archivedAt: undefined },
      version: 6,
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce(archivedCollection)
      .mockResolvedValueOnce({ revision: 9, items: [restoredResource] })
      .mockResolvedValueOnce(archivedCollection);
    mocks.get.mockResolvedValueOnce(collection.items[0]);
    mocks.archive.mockResolvedValue(archivedResource);
    mocks.bulkRestore.mockResolvedValue({ revision: 9, items: [restoredResource] });
    mocks.undoArchive.mockResolvedValue({ revision: 10, items: [archivedResource] });

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByRole('button', { name: 'View Server role' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith('server-1', 4));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await screen.findByText('Server role');
    fireEvent.click(screen.getByLabelText('Select all visible opportunities'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore selected' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore selected' }));

    await screen.findByRole('button', { name: 'Undo archive change' });
    expect(mocks.bulkRestore).toHaveBeenCalledWith([
      { id: 'server-1', expectedVersion: 5 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo archive change' }));
    await waitFor(() => expect(mocks.undoArchive).toHaveBeenCalledWith([
      {
        id: 'server-1',
        expectedArchivedAt: null,
        previousArchivedAt: '2026-10-30T12:00:00.000Z',
      },
    ]));
  });

  it('uses only shared opportunity statuses for bulk status updates', async () => {
    const updatedResource: OpportunityResource = {
      ...collection.items[0],
      opportunity: { ...collection.items[0].opportunity, status: 'Interview' },
      version: 5,
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce({ revision: 8, items: [updatedResource] });
    mocks.bulkStatus.mockResolvedValue({ revision: 8, items: [updatedResource] });

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByLabelText('Select all visible opportunities'));

    const statusSelect = screen.getByLabelText('New status for selected opportunities');
    expect(within(statusSelect).getByRole('option', { name: 'Interview' })).toBeInTheDocument();
    expect(within(statusSelect).queryByRole('option', { name: 'Interviewing' })).not.toBeInTheDocument();
    fireEvent.change(statusSelect, { target: { value: 'Interview' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply status' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change status' }));

    await waitFor(() => expect(mocks.bulkStatus).toHaveBeenCalledWith(
      [{ id: 'server-1', expectedVersion: 4 }],
      'Interview',
      expect.any(String),
    ));
    expect(await screen.findByText('Server role')).toBeInTheDocument();
  });

  it('bulk deletes the selected view as one server batch and restores it through Undo', async () => {
    const empty: OpportunityCollection = { revision: 8, items: [] };
    const batch = {
      deletionBatchId: 'bulk-batch-1',
      expiresAt: new Date(Date.now() + 10_000).toISOString(),
      deleted: [{ id: 'server-1', version: 5 }],
    };
    mocks.load
      .mockResolvedValueOnce(collection)
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(collection);
    mocks.bulkDelete.mockResolvedValue(batch);
    mocks.restoreDeletion.mockResolvedValue({ revision: 9, items: collection.items });

    render(<ApiModeApp />);
    await screen.findByText('Server role');
    fireEvent.click(screen.getByLabelText('Select all visible opportunities'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete selected' }));

    await screen.findByRole('button', { name: 'Undo delete' });
    expect(mocks.bulkDelete).toHaveBeenCalledWith([
      { id: 'server-1', expectedVersion: 4 },
    ], 'active');

    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await waitFor(() => expect(mocks.restoreDeletion).toHaveBeenCalledWith('bulk-batch-1'));
    expect(await screen.findByText('Server role')).toBeInTheDocument();
  });

  it('restores the existing dashboard, calendar, deadlines and reports navigation in API mode', async () => {
    mocks.load.mockResolvedValue(collection);

    render(<ApiModeApp />);
    await screen.findByText('Server role');

    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Primary navigation' })).getByRole('button', { name: 'Deadlines' }));
    expect(await screen.findByRole('heading', { name: 'Deadlines' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV / JSON' }));
    expect(screen.getByRole('dialog', { name: 'Import opportunities to your account' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('opens a server-backed opportunity from global search', async () => {
    mocks.load.mockResolvedValue(collection);

    render(<ApiModeApp />);
    await screen.findByText('Server role');

    fireEvent.click(screen.getByRole('button', { name: 'Search Launchboard' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search Launchboard' }), {
      target: { value: 'Server role' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Server role/ }));

    expect(await screen.findByRole('heading', { name: 'Server role' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Search Launchboard' })).not.toBeInTheDocument();
  });
});

  it('opens password-reset links even when the browser still has an authenticated session', async () => {
    window.history.replaceState({}, '', '/#resetPassword=one-time-reset-token');
    render(<ApiModeApp />);

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(mocks.load).not.toHaveBeenCalled();

    window.history.replaceState({}, '', '/');
  });

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import { opportunityRepository } from '../data/opportunityRepository';
import type {
  OpportunityCollection,
  BackupImportResult,
} from '../data/httpOpportunityRepository';
import type { LocalMigrationCompletion, LocalMigrationPreview } from '../data/localMigration';
import * as migration from '../data/localMigration';
import { LocalMigrationDialog } from './LocalMigrationDialog';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  complete: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock('../data/opportunityRepository', () => ({
  opportunityRepository: { load: vi.fn() },
}));

vi.mock('../utils/exports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/exports')>();
  return { ...actual, downloadJsonBackup: vi.fn() };
});

vi.mock('../data/localMigration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/localMigration')>();
  return {
    ...actual,
    previewLocalMigration: mocks.preview,
    completeLocalMigration: mocks.complete,
    finalizeLocalMigration: mocks.finalize,
  };
});

const cleanSnapshot = {
  items: [makeOpportunity({ id: 'local-1', title: 'Local role' })],
  recovery: {
    kind: 'none',
    preserved: false,
    writesBlocked: false,
    duplicateCount: 0,
    recoveryCopy: null,
    primaryRaw: null,
    failure: null,
  },
};

const serverAfter: OpportunityCollection = { revision: 42, items: [] };
const dryRunResult: BackupImportResult = {
  mode: 'merge',
  dryRun: true,
  revision: 41,
  totalRecords: 1,
  validRecords: 1,
  repairedRecords: 0,
  invalidRecords: 0,
  duplicateRecords: 0,
  added: 1,
  skippedExisting: 0,
  replaced: 0,
  finalCount: 1,
  skipped: [],
};
const appliedResult: BackupImportResult = { ...dryRunResult, dryRun: false, revision: 42 };

function makePreview(mode: 'merge' | 'replace' = 'merge'): LocalMigrationPreview {
  return {
    userId: 'user-1',
    mode,
    backup: {
      format: 'launchboard-backup',
      schemaVersion: 1,
      exportedAt: '2026-11-01T12:00:00.000Z',
      opportunities: cleanSnapshot.items,
    },
    expectedRevision: 41,
    localRecordCount: 1,
    serverRecordCount: 0,
    result: { ...dryRunResult, mode },
  };
}

function makeCompletion(mode: 'merge' | 'replace' = 'merge'): LocalMigrationCompletion {
  return {
    importResult: { ...appliedResult, mode },
    collection: serverAfter,
    marker: {
      schemaVersion: 1,
      userId: 'user-1',
      completedAt: '2026-11-01T12:05:00.000Z',
      mode,
      localRecordCount: 1,
      serverRecordCount: 0,
      serverRevision: 42,
    },
  };
}

function repositoryStub() {
  return {} as import('../data/httpOpportunityRepository').HttpOpportunityRepository;
}

function acknowledgeSafetyBackup() {
  fireEvent.click(screen.getByRole('button', { name: 'Download local safety backup' }));
  fireEvent.click(screen.getByRole('checkbox', {
    name: 'I have saved the downloaded backup somewhere safe.',
  }));
}

beforeEach(() => {
  vi.mocked(opportunityRepository.load).mockReturnValue(
    cleanSnapshot as ReturnType<typeof opportunityRepository.load>,
  );
  mocks.preview.mockReset();
  mocks.complete.mockReset();
  mocks.finalize.mockReset();
  mocks.preview.mockResolvedValue(makePreview());
  mocks.complete.mockResolvedValue(makeCompletion());
  mocks.finalize.mockResolvedValue(makeCompletion());
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('LocalMigrationDialog', () => {
  it('requires a saved safety backup and dry-run preview before merging without clearing local records', async () => {
    const repository = repositoryStub();
    const onClose = vi.fn();
    const localRecordsRaw = JSON.stringify(cleanSnapshot.items);
    const recoveryRaw = '{"kind":"retained","source":"local-recovery"}';
    localStorage.setItem('launchboard.opportunities.v1', localRecordsRaw);
    localStorage.setItem('launchboard.recovery.raw.v1', recoveryRaw);
    const onImported = vi.fn();

    render(
      <LocalMigrationDialog
        repository={repository}
        userId="user-1"
        onClose={onClose}
        onImported={onImported}
      />,
    );

    expect(screen.getByRole('button', { name: 'Preview server import' })).toBeDisabled();
    acknowledgeSafetyBackup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview server import' }));

    expect(await screen.findByText('Server dry-run preview')).toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledWith(
      'user-1',
      cleanSnapshot.items,
      'merge',
      repository,
    );
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Import local records' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.complete).toHaveBeenCalledWith(makePreview(), repository);
    expect(onImported).toHaveBeenCalledWith(serverAfter);
    expect(localStorage.getItem('launchboard.opportunities.v1')).toBe(localRecordsRaw);
    expect(localStorage.getItem('launchboard.recovery.raw.v1')).toBe(recoveryRaw);
  });

  it('requires explicit replace acknowledgement and passes the revision-bound preview to completion', async () => {
    const repository = repositoryStub();
    const replacePreview = makePreview('replace');
    mocks.preview.mockResolvedValue(replacePreview);
    mocks.complete.mockResolvedValue(makeCompletion('replace'));

    render(
      <LocalMigrationDialog
        repository={repository}
        userId="user-1"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    acknowledgeSafetyBackup();
    fireEvent.click(screen.getByRole('radio', { name: /Replace server data/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview server import' }));
    await screen.findByText('Server dry-run preview');

    const apply = screen.getByRole('button', { name: 'Confirm replace and import' });
    expect(apply).toBeDisabled();
    expect(mocks.preview).toHaveBeenCalledWith(
      'user-1',
      cleanSnapshot.items,
      'replace',
      repository,
    );

    fireEvent.click(screen.getByRole('checkbox', {
      name: /I understand that Replace removes all existing server opportunities/,
    }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);

    await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith(replacePreview, repository));
  });

  it('blocks migration when local recovery needs attention', () => {
    vi.mocked(opportunityRepository.load).mockReturnValue({
      ...cleanSnapshot,
      recovery: { ...cleanSnapshot.recovery, kind: 'retained' },
    } as ReturnType<typeof opportunityRepository.load>);

    render(
      <LocalMigrationDialog
        repository={repositoryStub()}
        userId="user-1"
        onClose={vi.fn()}
        onImported={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Resolve local recovery first');
    expect(screen.queryByRole('button', { name: 'Download local safety backup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview server import' })).not.toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('retries reload/finalization without re-running an applied import', async () => {
    const repository = repositoryStub();
    const preview = makePreview();
    mocks.preview.mockResolvedValue(preview);
    mocks.complete.mockRejectedValue(
      new migration.LocalMigrationError(
        'IMPORT_SUCCEEDED_RELOAD_FAILED',
        'The import was accepted but could not be reloaded.',
        appliedResult,
      ),
    );
    mocks.finalize.mockResolvedValue(makeCompletion());
    const onClose = vi.fn();
    const onImported = vi.fn();

    render(
      <LocalMigrationDialog
        repository={repository}
        userId="user-1"
        onClose={onClose}
        onImported={onImported}
      />,
    );

    acknowledgeSafetyBackup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview server import' }));
    await screen.findByText('Server dry-run preview');
    fireEvent.click(screen.getByRole('button', { name: 'Import local records' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be reloaded');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry server reload' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.finalize).toHaveBeenCalledWith(preview, appliedResult, repository);
    expect(onImported).toHaveBeenCalledWith(serverAfter);
  });

  it('prevents dismissal while a server migration mutation is in flight', async () => {
    let resolveCompletion!: (completion: LocalMigrationCompletion) => void;
    const completionPromise = new Promise<LocalMigrationCompletion>((resolve) => {
      resolveCompletion = resolve;
    });
    mocks.complete.mockReturnValue(completionPromise);
    const onClose = vi.fn();

    render(
      <LocalMigrationDialog
        repository={repositoryStub()}
        userId="user-1"
        onClose={onClose}
        onImported={vi.fn()}
      />,
    );

    acknowledgeSafetyBackup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview server import' }));
    await screen.findByText('Server dry-run preview');
    fireEvent.click(screen.getByRole('button', { name: 'Import local records' }));

    const dialog = screen.getByRole('dialog', { name: 'Move local opportunities to your account' });
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();

    const cancelEvent = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);
    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();

    resolveCompletion(makeCompletion());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

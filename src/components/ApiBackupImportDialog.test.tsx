import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { makeOpportunity } from '../test/fixtures';
import type {
  BackupImportResult,
  HttpOpportunityRepository,
  OpportunityCollection,
} from '../data/httpOpportunityRepository';
import { createCsv, createJsonBackup } from '../utils/exports';
import { ApiBackupImportDialog } from './ApiBackupImportDialog';

function previewResult(mode: 'merge' | 'replace', revision = 7): BackupImportResult {
  return {
    mode,
    dryRun: true,
    revision,
    totalRecords: 1,
    validRecords: 1,
    repairedRecords: 0,
    invalidRecords: 0,
    duplicateRecords: 0,
    added: 1,
    skippedExisting: mode === 'merge' ? 0 : 0,
    replaced: mode === 'replace' ? 2 : 0,
    finalCount: mode === 'replace' ? 1 : 3,
    skipped: [],
  };
}

const importedCollection: OpportunityCollection = {
  revision: 8,
  items: [],
};

function renderDialog(repository: HttpOpportunityRepository) {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <ApiBackupImportDialog
      repository={repository}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { onClose, onImported };
}

function backupFile() {
  return new File(
    [createJsonBackup([makeOpportunity({ id: 'backup-1', title: 'Imported role' })])],
    'launchboard-backup.json',
    { type: 'application/json' },
  );
}

function csvFile() {
  return new File(
    [createCsv([makeOpportunity({ id: 'csv-1', title: 'CSV imported role' })])],
    'opportunities.csv',
    { type: 'text/csv' },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiBackupImportDialog', () => {
  it('previews a valid backup on the server and merges only after explicit confirmation', async () => {
    const repository = {
      importBackup: vi.fn()
        .mockResolvedValueOnce(previewResult('merge'))
        .mockResolvedValueOnce({ ...previewResult('merge'), dryRun: false }),
      load: vi.fn().mockResolvedValue(importedCollection),
    } as unknown as HttpOpportunityRepository;
    const { onClose, onImported } = renderDialog(repository);

    fireEvent.change(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup'), {
      target: { files: [backupFile()] },
    });

    await screen.findByText('Server import preview');
    expect(repository.importBackup).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'merge',
      dryRun: true,
      backup: expect.objectContaining({
        format: 'launchboard-backup',
        schemaVersion: 3,
        opportunities: expect.arrayContaining([
          expect.objectContaining({
            id: 'backup-1',
            title: 'Imported role',
            tasks: [],
          }),
        ]),
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new records' }));
    await waitFor(() => expect(repository.load).toHaveBeenCalledWith('all'));
    expect(repository.importBackup).toHaveBeenCalledTimes(2);
    expect(repository.importBackup).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'merge',
      backup: expect.any(Object),
    }));
    expect(onImported).toHaveBeenCalledWith(importedCollection);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('converts CSV into the shared backup envelope before server-side preview and import', async () => {
    const repository = {
      importBackup: vi.fn()
        .mockResolvedValueOnce(previewResult('merge'))
        .mockResolvedValueOnce({ ...previewResult('merge'), dryRun: false }),
      load: vi.fn().mockResolvedValue(importedCollection),
    } as unknown as HttpOpportunityRepository;
    const { onClose, onImported } = renderDialog(repository);

    fireEvent.change(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup'), {
      target: { files: [csvFile()] },
    });

    await screen.findByText('Server import preview');
    expect(repository.importBackup).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'merge',
      dryRun: true,
      backup: expect.objectContaining({
        format: 'launchboard-backup',
        schemaVersion: 1,
        opportunities: expect.arrayContaining([
          expect.objectContaining({ id: 'csv-1', title: 'CSV imported role' }),
        ]),
      }),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new records' }));
    await waitFor(() => expect(repository.load).toHaveBeenCalledWith('all'));
    expect(repository.importBackup).toHaveBeenCalledTimes(2);
    expect(onImported).toHaveBeenCalledWith(importedCollection);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('requires exact-revision confirmation before replacing account records', async () => {
    const repository = {
      importBackup: vi.fn()
        .mockResolvedValueOnce(previewResult('merge'))
        .mockResolvedValueOnce(previewResult('replace', 12))
        .mockResolvedValueOnce({ ...previewResult('replace', 13), dryRun: false }),
      load: vi.fn().mockResolvedValue(importedCollection),
    } as unknown as HttpOpportunityRepository;
    const { onClose, onImported } = renderDialog(repository);

    fireEvent.change(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup'), {
      target: { files: [backupFile()] },
    });
    await screen.findByText('Server import preview');

    fireEvent.change(screen.getByLabelText('Import mode'), {
      target: { value: 'replace' },
    });
    await waitFor(() => expect(repository.importBackup).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Review replacement' }));
    const confirmation = screen.getByLabelText(/I understand this replaces all current account opportunities/);
    fireEvent.click(confirmation);
    fireEvent.click(screen.getByRole('button', { name: 'Replace account records' }));

    await waitFor(() => expect(repository.importBackup).toHaveBeenCalledTimes(3));
    expect(repository.importBackup).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'replace',
      confirmReplace: true,
      expectedRevision: 12,
    }));
    expect(repository.load).toHaveBeenCalledWith('all');
    expect(onImported).toHaveBeenCalledWith(importedCollection);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('prevents dismissal while a server import mutation is in flight', async () => {
    let resolveApply!: (result: BackupImportResult) => void;
    const applyPromise = new Promise<BackupImportResult>((resolve) => {
      resolveApply = resolve;
    });
    const repository = {
      importBackup: vi.fn()
        .mockResolvedValueOnce(previewResult('merge'))
        .mockReturnValueOnce(applyPromise),
      load: vi.fn().mockResolvedValue(importedCollection),
    } as unknown as HttpOpportunityRepository;
    const { onClose } = renderDialog(repository);

    fireEvent.change(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup'), {
      target: { files: [backupFile()] },
    });
    await screen.findByText('Server import preview');
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new records' }));

    const dialog = screen.getByRole('dialog', { name: 'Import opportunities to your account' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    expect(dialog).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    resolveApply({ ...previewResult('merge'), dryRun: false });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('re-enables the dialog after rejecting an invalid JSON backup', async () => {
    const repository = {
      importBackup: vi.fn(),
      load: vi.fn(),
    } as unknown as HttpOpportunityRepository;
    renderDialog(repository);

    fireEvent.change(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup'), {
      target: {
        files: [new File(['not valid json'], 'broken-backup.json', { type: 'application/json' })],
      },
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('CSV spreadsheet or Launchboard JSON backup')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled();
    expect(repository.importBackup).not.toHaveBeenCalled();
  });
});

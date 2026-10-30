import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BACKUP_BYTES,
  type ParsedBackup,
  type ImportMode,
  type RestoreOutcome,
} from '../utils/backup';
import { createJsonBackup } from '../utils/exports';
import { makeOpportunity } from '../test/fixtures';
import { RestoreBackupDialog } from './RestoreBackupDialog';

function backupFile(opportunities: unknown[]): File {
  const raw = {
    ...JSON.parse(createJsonBackup([])),
    opportunities,
  };
  return new File([JSON.stringify(raw)], 'launchboard-backup.json', {
    type: 'application/json',
  });
}

function selectFile(file: File): void {
  fireEvent.change(screen.getByLabelText('JSON backup file'), {
    target: { files: [file] },
  });
}

async function previewFor(file: File): Promise<void> {
  selectFile(file);
  // FileReader is asynchronous; the full parallel suite can briefly starve the
  // event loop, so allow more than Testing Library's one-second default.
  expect(
    await screen.findByRole(
      'heading',
      { name: 'Backup preview' },
      { timeout: 5000 },
    ),
  ).toBeInTheDocument();
}

function definitionValue(term: string): HTMLElement {
  const dt = screen.getByText(term);
  const dd = dt.parentElement?.querySelector('dd');
  if (!dd) throw new Error(`No value found for ${term}`);
  return dd as HTMLElement;
}

describe('RestoreBackupDialog', () => {
  it('renders a validated preview and merges new records', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );
    const onClose = vi.fn();
    const current = [makeOpportunity({ id: 'current' })];
    const incoming = makeOpportunity({ id: 'incoming', title: 'Incoming Role' });

    render(
      <RestoreBackupDialog
        currentItems={current}
        onClose={onClose}
        onRestore={onRestore}
      />,
    );

    await previewFor(backupFile([incoming]));

    expect(definitionValue('Total records')).toHaveTextContent('1');
    expect(definitionValue('Valid records')).toHaveTextContent('1');
    expect(definitionValue('Repaired')).toHaveTextContent('0');
    expect(definitionValue('Invalid/skipped')).toHaveTextContent('0');
    expect(screen.getByText(/Merge keeps all 1 current record and adds 1 new record/)).toBeVisible();
    expect(screen.getByText(/Final collection: 2 records/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ validRecords: 1 }),
      'merge',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows repaired, invalid, and duplicate counts with skip details', async () => {
    const valid = makeOpportunity({ id: 'valid' });
    const duplicate = makeOpportunity({ id: 'valid', title: 'Duplicate Role' });
    const repaired = makeOpportunity({
      id: 'repaired',
      deadline: '2026-02-30',
      followUpDate: 'not-a-date',
    });

    render(
      <RestoreBackupDialog
        currentItems={[]}
        onClose={vi.fn()}
        onRestore={vi.fn(
          (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
        )}
      />,
    );

    await previewFor(backupFile([valid, duplicate, repaired, null]));

    expect(definitionValue('Total records')).toHaveTextContent('4');
    expect(definitionValue('Valid records')).toHaveTextContent('2');
    expect(definitionValue('Repaired')).toHaveTextContent('1');
    expect(definitionValue('Invalid/skipped')).toHaveTextContent('2');
    expect(definitionValue('Duplicate IDs')).toHaveTextContent('1');

    fireEvent.click(screen.getByText('Review skipped records (2)'));
    expect(screen.getByText(/Duplicate ID in this backup/)).toBeVisible();
    expect(screen.getByText(/Record is not an object/)).toBeVisible();
  });

  it('shows invalid JSON accessibly without offering a preview', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );

    render(
      <RestoreBackupDialog
        currentItems={[]}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    selectFile(
      new File(['{not-json'], 'broken.json', {
        type: 'application/json',
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
    expect(screen.queryByRole('heading', { name: 'Backup preview' })).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('rejects files over the size limit before attempting to read them', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );

    render(
      <RestoreBackupDialog currentItems={[]} onClose={vi.fn()} onRestore={onRestore} />,
    );

    const file = new File(['{}'], 'too-large.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: MAX_BACKUP_BYTES + 1 });
    selectFile(file);

    expect(await screen.findByRole('alert')).toHaveTextContent('too large');
    expect(screen.queryByRole('heading', { name: 'Backup preview' })).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('requires a separate confirmation and checkbox before replacement', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );
    const current = [makeOpportunity({ id: 'current' })];
    const incoming = makeOpportunity({ id: 'incoming' });

    render(
      <RestoreBackupDialog
        currentItems={current}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    await previewFor(backupFile([incoming]));
    fireEvent.click(screen.getByRole('radio', { name: /Replace all current records/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review replacement' }));

    expect(screen.getByRole('heading', { name: 'Confirm replacement' })).toBeInTheDocument();
    const finalButton = screen.getByRole('button', { name: 'Replace all records' });
    expect(finalButton).toBeDisabled();
    expect(onRestore).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I understand that my current records will be replaced.',
      }),
    );
    expect(finalButton).not.toBeDisabled();
    fireEvent.click(finalButton);

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ validRecords: 1 }), 'replace');
  });

  it('disables replacement when every backup record is invalid', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );

    render(
      <RestoreBackupDialog
        currentItems={[makeOpportunity()]}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    await previewFor(backupFile([null]));
    fireEvent.click(screen.getByRole('radio', { name: /Replace all current records/ }));

    expect(screen.getByText(/none are valid/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Replacement unavailable' })).toBeDisabled();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('makes empty replacement explicit and still requires confirmation', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );

    render(
      <RestoreBackupDialog
        currentItems={[makeOpportunity({ id: 'current' })]}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    await previewFor(backupFile([]));
    fireEvent.click(screen.getByRole('radio', { name: /Replace all current records/ }));

    expect(screen.getByText(/valid but empty/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review replacement' }));

    expect(screen.getByText(/permanently remove all 1 current record/i)).toBeVisible();
    const finalButton = screen.getByRole('button', { name: 'Replace with empty backup' });
    expect(finalButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I understand that all current records will be removed.',
      }),
    );
    fireEvent.click(finalButton);

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ validRecords: 0 }), 'replace');
  });

  it('shows persistence failures as an alert and keeps the dialog open', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({
        ok: false,
        message: 'The import could not be saved.',
      }),
    );

    render(
      <RestoreBackupDialog
        currentItems={[]}
        onClose={vi.fn()}
        onRestore={onRestore}
      />,
    );

    await previewFor(backupFile([makeOpportunity({ id: 'incoming' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 record' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(screen.getByRole('heading', { name: 'Backup preview' })).toBeInTheDocument();
  });

  it('cancels without applying an import', async () => {
    const onRestore = vi.fn(
      (_backup: ParsedBackup, _mode: ImportMode): RestoreOutcome => ({ ok: true }),
    );
    const onClose = vi.fn();

    render(
      <RestoreBackupDialog currentItems={[]} onClose={onClose} onRestore={onRestore} />,
    );

    await previewFor(backupFile([makeOpportunity({ id: 'incoming' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });
});

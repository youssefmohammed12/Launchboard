import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import {
  completeLocalMigration,
  getLocalMigrationMarker,
  LocalMigrationError,
  previewLocalMigration,
  type MigrationRepository,
} from './localMigration';
import type {
  BackupImportResult,
  OpportunityCollection,
} from './httpOpportunityRepository';

function importResult(
  overrides: Partial<BackupImportResult> = {},
): BackupImportResult {
  return {
    mode: 'merge',
    dryRun: true,
    revision: 12,
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
    ...overrides,
  };
}

function collection(revision = 12): OpportunityCollection {
  return { revision, items: [] };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('local-to-server migration', () => {
  it('previews a merge without changing local opportunity or recovery data', async () => {
    const item = makeOpportunity({ id: 'local-1', title: 'Keep local' });
    const recoveryRaw = '{malformed local recovery copy';
    localStorage.setItem('launchboard.opportunities.v1', JSON.stringify([item]));
    localStorage.setItem('launchboard.recovery.raw.v1', recoveryRaw);

    const load = vi.fn(async () => collection(12));
    const importBackup = vi.fn(async () => importResult());
    const repository: MigrationRepository = { load, importBackup };

    const preview = await previewLocalMigration('user-1', [item], 'merge', repository);

    expect(load).toHaveBeenCalledWith('all');
    expect(importBackup).toHaveBeenCalledWith({
      mode: 'merge',
      backup: preview.backup,
      dryRun: true,
    });
    expect(preview).toMatchObject({
      userId: 'user-1',
      mode: 'merge',
      expectedRevision: 12,
      localRecordCount: 1,
      serverRecordCount: 0,
    });
    expect(preview.backup.opportunities[0]).toMatchObject({ id: 'local-1', title: 'Keep local' });
    expect(localStorage.getItem('launchboard.opportunities.v1')).toBe(JSON.stringify([item]));
    expect(localStorage.getItem('launchboard.recovery.raw.v1')).toBe(recoveryRaw);
    expect(getLocalMigrationMarker('user-1')).toBeNull();
  });

  it('binds replace preview to the current server revision and explicit confirmation', async () => {
    const item = makeOpportunity({ id: 'local-replace' });
    const load = vi.fn(async () => collection(27));
    const importBackup = vi.fn(async () => importResult({
      mode: 'replace',
      added: 1,
      replaced: 4,
      finalCount: 1,
    }));
    const repository: MigrationRepository = { load, importBackup };

    const preview = await previewLocalMigration('user-2', [item], 'replace', repository);

    expect(preview.expectedRevision).toBe(27);
    expect(importBackup).toHaveBeenCalledWith({
      mode: 'replace',
      backup: preview.backup,
      dryRun: true,
      confirmReplace: true,
      expectedRevision: 27,
    });
  });

  it('marks migration complete only after importing and reloading server state', async () => {
    const item = makeOpportunity({ id: 'local-complete' });
    const localRaw = JSON.stringify([item]);
    const recoveryRaw = 'exact recovery content';
    localStorage.setItem('launchboard.opportunities.v1', localRaw);
    localStorage.setItem('launchboard.recovery.raw.v1', recoveryRaw);
    const previewRepository: MigrationRepository = {
      load: async () => collection(12),
      importBackup: async () => importResult(),
    };
    const preview = await previewLocalMigration('user-3', [item], 'merge', previewRepository);

    const events: string[] = [];
    const repository: MigrationRepository = {
      load: async () => {
        events.push('reload');
        return collection(13);
      },
      importBackup: async (input) => {
        events.push(input.dryRun ? 'dry-run' : 'import');
        return importResult({ dryRun: false, revision: 13 });
      },
    };

    const completed = await completeLocalMigration(preview, repository);

    expect(events).toEqual(['import', 'reload']);
    expect(completed.collection.revision).toBe(13);
    expect(completed.marker).toMatchObject({
      userId: 'user-3',
      mode: 'merge',
      localRecordCount: 1,
      serverRecordCount: 0,
      serverRevision: 13,
    });
    expect(getLocalMigrationMarker('user-3')).toEqual(completed.marker);
    expect(getLocalMigrationMarker('different-user')).toBeNull();
    expect(localStorage.getItem('launchboard.opportunities.v1')).toBe(localRaw);
    expect(localStorage.getItem('launchboard.recovery.raw.v1')).toBe(recoveryRaw);
  });

  it('does not mark completion when the post-import server reload fails', async () => {
    const item = makeOpportunity({ id: 'local-reload-fail' });
    const preview = await previewLocalMigration('user-4', [item], 'merge', {
      load: async () => collection(2),
      importBackup: async () => importResult(),
    });
    localStorage.setItem('launchboard.opportunities.v1', JSON.stringify([item]));

    const repository: MigrationRepository = {
      load: async () => {
        throw new Error('server reload unavailable');
      },
      importBackup: async () => importResult({ dryRun: false }),
    };

    await expect(completeLocalMigration(preview, repository)).rejects.toMatchObject({
      name: 'LocalMigrationError',
      code: 'IMPORT_SUCCEEDED_RELOAD_FAILED',
      importResult: { dryRun: false },
    });
    expect(getLocalMigrationMarker('user-4')).toBeNull();
    expect(localStorage.getItem('launchboard.opportunities.v1')).toBe(JSON.stringify([item]));
  });

  it('refuses a preview unless the server explicitly confirms dry-run mode', async () => {
    const item = makeOpportunity({ id: 'local-not-dry-run' });
    await expect(previewLocalMigration('user-dry', [item], 'merge', {
      load: async () => collection(),
      importBackup: async () => importResult({ dryRun: false }),
    })).rejects.toMatchObject({
      name: 'LocalMigrationError',
      code: 'DRY_RUN_NOT_CONFIRMED',
    });
    expect(getLocalMigrationMarker('user-dry')).toBeNull();
  });

  it('does not mark completion when the server does not confirm an actual import', async () => {
    const item = makeOpportunity({ id: 'local-not-applied' });
    const preview = await previewLocalMigration('user-not-applied', [item], 'merge', {
      load: async () => collection(4),
      importBackup: async () => importResult(),
    });

    await expect(completeLocalMigration(preview, {
      load: async () => collection(4),
      importBackup: async () => importResult({ dryRun: true }),
    })).rejects.toMatchObject({
      name: 'LocalMigrationError',
      code: 'IMPORT_NOT_APPLIED',
    });
    expect(getLocalMigrationMarker('user-not-applied')).toBeNull();
  });

  it('blocks unsafe local records instead of silently dropping them during migration', async () => {
    const invalid = {
      ...makeOpportunity({ id: 'bad-local' }),
      status: 'not-a-valid-status',
    } as unknown as ReturnType<typeof makeOpportunity>;
    const load = vi.fn(async () => collection());
    const importBackup = vi.fn(async () => importResult());

    await expect(previewLocalMigration('user-5', [invalid], 'merge', {
      load,
      importBackup,
    })).rejects.toBeInstanceOf(LocalMigrationError);
    expect(load).not.toHaveBeenCalled();
    expect(importBackup).not.toHaveBeenCalled();
    expect(getLocalMigrationMarker('user-5')).toBeNull();
  });
});

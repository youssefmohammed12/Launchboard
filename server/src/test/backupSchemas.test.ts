import { MAX_BACKUP_RECORDS } from '@launchboard/domain';
import { describe, expect, it } from 'vitest';
import {
  backupEnvelopeSchema,
  backupImportBodySchema,
} from '../validation/backupSchemas.js';
import { backupEnvelope } from './helpers/fixtures.js';

describe('backup envelope schema', () => {
  it('accepts the version-1 envelope and ignores unknown envelope keys', () => {
    const result = backupEnvelopeSchema.safeParse({
      ...backupEnvelope([], { extra: 'ignored' }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('extra' in result.data).toBe(false);
    }
  });

  it('treats exportedAt as optional', () => {
    const envelope = backupEnvelope();
    delete envelope.exportedAt;
    expect(backupEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it('rejects wrong formats while allowing the service to identify unsupported integer versions', () => {
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { format: 'other' })).success,
    ).toBe(false);
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { schemaVersion: 2 })).success,
    ).toBe(true);
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { schemaVersion: '2' })).success,
    ).toBe(false);
  });

  it('rejects a missing or non-array opportunities list', () => {
    const envelope = backupEnvelope();
    delete envelope.opportunities;
    expect(backupEnvelopeSchema.safeParse(envelope).success).toBe(false);
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { opportunities: {} })).success,
    ).toBe(false);
  });

  it('treats malformed exportedAt as advisory metadata', () => {
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { exportedAt: 123 })).success,
    ).toBe(true);
    expect(
      backupEnvelopeSchema.safeParse(backupEnvelope([], { exportedAt: null })).success,
    ).toBe(true);
  });

  it('accepts opaque records so invalid records can be skipped and counted', () => {
    expect(backupEnvelopeSchema.safeParse(backupEnvelope([null, 42, {}])).success).toBe(
      true,
    );
  });

  it('accepts duplicate IDs for import-time skip/count handling', () => {
    expect(
      backupEnvelopeSchema.safeParse(
        backupEnvelope([{ id: 'same' }, { id: 'same' }]),
      ).success,
    ).toBe(true);
  });

  it('enforces the 20,000-record cap', () => {
    const exact = Array.from({ length: MAX_BACKUP_RECORDS }, () => null);
    const tooMany = Array.from({ length: MAX_BACKUP_RECORDS + 1 }, () => null);
    expect(backupEnvelopeSchema.safeParse(backupEnvelope(exact)).success).toBe(true);
    expect(backupEnvelopeSchema.safeParse(backupEnvelope(tooMany)).success).toBe(false);
  });

  it('rejects a browser recovery payload as a backup', () => {
    expect(backupEnvelopeSchema.safeParse({ raw: 'launchboard.recovery.raw.v1' }).success).toBe(
      false,
    );
  });
});

describe('backup import request schema', () => {
  it('accepts a merge request', () => {
    expect(
      backupImportBodySchema.safeParse({
        mode: 'merge',
        backup: backupEnvelope(),
        dryRun: true,
      }).success,
    ).toBe(true);
  });

  it('requires confirmation and a revision for replace mode', () => {
    const result = backupImportBodySchema.safeParse({
      mode: 'replace',
      backup: backupEnvelope(),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['confirmReplace', 'expectedRevision']),
      );
    }

    expect(
      backupImportBodySchema.safeParse({
        mode: 'replace',
        backup: backupEnvelope(),
        confirmReplace: true,
        expectedRevision: 4,
      }).success,
    ).toBe(true);
  });

  it('rejects invalid modes, revisions and flag types', () => {
    for (const body of [
      { mode: 'upsert', backup: backupEnvelope() },
      { mode: 'merge', backup: backupEnvelope(), expectedRevision: -1 },
      { mode: 'merge', backup: backupEnvelope(), dryRun: 'yes' },
      { mode: 'merge', backup: backupEnvelope(), confirmReplace: 'yes' },
      { mode: 'merge' },
    ]) {
      expect(backupImportBodySchema.safeParse(body).success).toBe(false);
    }
  });

  it('rejects unknown import-request properties but ignores unknown envelope keys', () => {
    expect(
      backupImportBodySchema.safeParse({
        mode: 'merge',
        backup: backupEnvelope(),
        unexpected: true,
      }).success,
    ).toBe(false);

    expect(
      backupImportBodySchema.safeParse({
        mode: 'merge',
        backup: backupEnvelope([], { unexpected: true }),
      }).success,
    ).toBe(true);
  });
});

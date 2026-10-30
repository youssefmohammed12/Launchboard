import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  MAX_BACKUP_RECORDS,
} from '@launchboard/domain';
import { z } from 'zod';

/**
 * The version-1 backup envelope. Validation mirrors the frontend importer:
 * the format marker, schema version, advisory `exportedAt` and the record array
 * are checked, while individual records stay opaque so the import service can
 * skip/count invalid and duplicate records instead of failing the whole file.
 *
 * Unknown envelope keys are ignored, matching the frontend. The surrounding
 * import request is a strict object.
 */
export const backupEnvelopeSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.string().optional(),
  opportunities: z
    .array(z.unknown())
    .max(
      MAX_BACKUP_RECORDS,
      `must contain at most ${MAX_BACKUP_RECORDS} records`,
    ),
});

/**
 * The import request DTO. Replace mode is destructive, so it must explicitly
 * confirm and carry the revision the client last read.
 */
export const backupImportBodySchema = z
  .strictObject({
    mode: z.enum(['merge', 'replace']),
    backup: backupEnvelopeSchema,
    dryRun: z.boolean().optional(),
    confirmReplace: z.boolean().optional(),
    expectedRevision: z.number().int('must be an integer').min(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== 'replace') return;
    if (value.confirmReplace !== true) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmReplace'],
        message: 'must be true when mode is replace',
      });
    }
    if (value.expectedRevision === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedRevision'],
        message: 'is required when mode is replace',
      });
    }
  });

export type BackupEnvelopeInput = z.infer<typeof backupEnvelopeSchema>;
export type BackupImportBody = z.infer<typeof backupImportBodySchema>;

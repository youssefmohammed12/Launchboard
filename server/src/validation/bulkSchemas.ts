import { OPPORTUNITY_STATUSES } from '@launchboard/domain';
import { z } from 'zod';
import { dateSchema, idSchema } from './common.js';

export const bulkItemSchema = z.strictObject({
  id: idSchema,
  expectedVersion: z
    .number()
    .int('must be an integer')
    .min(1, 'must be at least 1'),
});

function addDuplicateIdIssues(
  items: readonly { id: string }[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: 'must not repeat an ID in the same request',
      });
    }
    seen.add(item.id);
  });
}

/** A non-empty, duplicate-free list of `{id, expectedVersion}` items. */
export const bulkItemsSchema = z
  .array(bulkItemSchema)
  .min(1, 'must contain at least one item')
  .superRefine(addDuplicateIdIssues);

export const bulkArchiveBodySchema = z.strictObject({
  items: bulkItemsSchema,
});

export const bulkRestoreBodySchema = z.strictObject({
  items: bulkItemsSchema,
});

export const bulkStatusBodySchema = z.strictObject({
  items: bulkItemsSchema,
  status: z.enum(OPPORTUNITY_STATUSES),
  statusActivityDate: dateSchema,
});

export const bulkDeleteBodySchema = z.strictObject({
  items: bulkItemsSchema,
  archiveView: z.enum(['active', 'archived']),
});

/** Archive metadata is a real ISO timestamp, or `null` for an active record. */
const archiveTimestampSchema = z.iso.datetime({ offset: true });

export const undoArchiveItemSchema = z.strictObject({
  id: idSchema,
  expectedArchivedAt: z.union([z.null(), archiveTimestampSchema]),
  previousArchivedAt: z.union([z.null(), archiveTimestampSchema]),
});

export const bulkUndoArchiveBodySchema = z.strictObject({
  items: z
    .array(undoArchiveItemSchema)
    .min(1, 'must contain at least one item')
    .superRefine(addDuplicateIdIssues),
});

export type BulkItem = z.infer<typeof bulkItemSchema>;
export type BulkItems = z.infer<typeof bulkItemsSchema>;
export type BulkStatusBody = z.infer<typeof bulkStatusBodySchema>;
export type BulkDeleteBody = z.infer<typeof bulkDeleteBodySchema>;
export type UndoArchiveItem = z.infer<typeof undoArchiveItemSchema>;
export type BulkUndoArchiveBody = z.infer<typeof bulkUndoArchiveBodySchema>;

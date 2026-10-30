import { describe, expect, it } from 'vitest';
import {
  bulkArchiveBodySchema,
  bulkDeleteBodySchema,
  bulkRestoreBodySchema,
  bulkStatusBodySchema,
  bulkUndoArchiveBodySchema,
} from '../validation/bulkSchemas.js';

const items = [
  { id: 'opportunity-1', expectedVersion: 1 },
  { id: 'opportunity-2', expectedVersion: 2 },
];

describe('bulk request schemas', () => {
  it('accepts archive and restore batches', () => {
    expect(bulkArchiveBodySchema.safeParse({ items }).success).toBe(true);
    expect(bulkRestoreBodySchema.safeParse({ items }).success).toBe(true);
  });

  it('requires a non-empty item list', () => {
    expect(bulkArchiveBodySchema.safeParse({ items: [] }).success).toBe(false);
    expect(bulkArchiveBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects duplicate IDs inside one request', () => {
    expect(
      bulkArchiveBodySchema.safeParse({
        items: [
          { id: 'same', expectedVersion: 1 },
          { id: 'same', expectedVersion: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, '1', null])(
    'rejects invalid expectedVersion %s',
    (expectedVersion) => {
      expect(
        bulkArchiveBodySchema.safeParse({
          items: [{ id: 'opportunity-1', expectedVersion }],
        }).success,
      ).toBe(false);
    },
  );

  it('rejects unknown item properties', () => {
    expect(
      bulkArchiveBodySchema.safeParse({
        items: [{ id: 'opportunity-1', expectedVersion: 1, archivedAt: null }],
      }).success,
    ).toBe(false);
  });

  it('validates bulk status bodies', () => {
    expect(
      bulkStatusBodySchema.safeParse({
        items,
        status: 'Offer',
        statusActivityDate: '2026-10-27',
      }).success,
    ).toBe(true);

    for (const body of [
      { items, status: 'Pending', statusActivityDate: '2026-10-27' },
      { items, status: 'Offer' },
      { items, status: 'Offer', statusActivityDate: '2026-02-30' },
      { items, status: 'Offer', statusActivityDate: '' },
    ]) {
      expect(bulkStatusBodySchema.safeParse(body).success).toBe(false);
    }
  });

  it('validates bulk delete archive views', () => {
    expect(
      bulkDeleteBodySchema.safeParse({ items, archiveView: 'active' }).success,
    ).toBe(true);
    expect(
      bulkDeleteBodySchema.safeParse({ items, archiveView: 'archived' }).success,
    ).toBe(true);
    expect(
      bulkDeleteBodySchema.safeParse({ items, archiveView: 'all' }).success,
    ).toBe(false);
    expect(bulkDeleteBodySchema.safeParse({ items }).success).toBe(false);
  });

  it('validates undo-archive timestamps and duplicate IDs', () => {
    const undoItems = [
      {
        id: 'opportunity-1',
        expectedArchivedAt: '2026-10-27T10:00:00.000Z',
        previousArchivedAt: null,
      },
      {
        id: 'opportunity-2',
        expectedArchivedAt: null,
        previousArchivedAt: '2026-10-27T10:00:00.000Z',
      },
    ];

    expect(bulkUndoArchiveBodySchema.safeParse({ items: undoItems }).success).toBe(true);

    for (const body of [
      {
        items: [
          {
            id: 'opportunity-1',
            expectedArchivedAt: '2026-02-30T00:00:00Z',
            previousArchivedAt: null,
          },
        ],
      },
      {
        items: [
          {
            id: 'opportunity-1',
            expectedArchivedAt: 'yesterday',
            previousArchivedAt: null,
          },
        ],
      },
      {
        items: [
          {
            id: 'same',
            expectedArchivedAt: null,
            previousArchivedAt: null,
          },
          {
            id: 'same',
            expectedArchivedAt: null,
            previousArchivedAt: null,
          },
        ],
      },
      { items: [] },
    ]) {
      expect(bulkUndoArchiveBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

import type { Opportunity } from '../types/opportunity';
import { isArchived, normalizeArchivedAt } from './archive';

/**
 * One-level Undo.
 *
 * The entry lives in application memory only; it is never written to
 * localStorage. A page reload therefore ends the current Undo opportunity,
 * while the completed archive/restore/delete remains persisted.
 */
export const UNDO_WINDOW_MS = 10_000;

/** An archive or restore, reversed by putting the previous archive marker back. */
export interface ArchiveUndoEntry {
  kind: 'archive' | 'restore';
  id: string;
  title: string;
  /** Archive state before the action; `undefined` means active. */
  previousArchivedAt: string | undefined;
  /** Archive state produced by the action, used to detect a stale entry. */
  resultingArchivedAt: string | undefined;
}

/**
 * A deletion, reversed by re-inserting the complete pre-deletion snapshot.
 * `snapshot` is a deep copy, so later edits of the in-memory collection can
 * never mutate what Undo would restore.
 */
export interface DeleteUndoEntry {
  kind: 'delete';
  id: string;
  title: string;
  /** Original zero-based position in the collection. */
  index: number;
  snapshot: Opportunity;
}

/** One opportunity inside a batch archive/restore entry. */
export interface BatchArchiveItem {
  id: string;
  title: string;
  /** Archive state before the batch action; `undefined` means active. */
  previousArchivedAt: string | undefined;
  /** Archive state produced by the batch action, used to detect staleness. */
  resultingArchivedAt: string | undefined;
}

/**
 * A bulk archive or restore, reversed atomically. Only immutable archive
 * metadata is retained, never a live opportunity reference, so later edits are
 * preserved by the reversal instead of being overwritten.
 */
export interface BatchArchiveUndoEntry {
  kind: 'batch-archive' | 'batch-restore';
  items: BatchArchiveItem[];
}

/** One deleted opportunity inside a batch delete entry. */
export interface BatchDeleteItem {
  id: string;
  title: string;
  /** Original zero-based position in the full collection. */
  index: number;
  /** Deep copy of the complete record as it was before deletion. */
  snapshot: Opportunity;
}

/**
 * A bulk deletion, reversed atomically by re-inserting every independent
 * snapshot at its original position. Snapshots are deep copies, so nothing that
 * happens to the live collection after the delete can change what Undo restores.
 */
export interface BatchDeleteUndoEntry {
  kind: 'batch-delete';
  items: BatchDeleteItem[];
}

export type UndoEntry =
  | ArchiveUndoEntry
  | DeleteUndoEntry
  | BatchArchiveUndoEntry
  | BatchDeleteUndoEntry;

export type UndoFailureReason = 'missing' | 'conflict' | 'stale';

export type UndoResult =
  | { ok: true; items: Opportunity[]; message: string }
  | { ok: false; reason: UndoFailureReason; message: string };

function cloneOpportunity(item: Opportunity): Opportunity {
  // structuredClone keeps every nested activity/interview/contact/material
  // field and any future supported optional field, without round-tripping
  // through form data or JSON-specific conversion.
  return structuredClone(item);
}

/**
 * Captures an archive (active -> archived) or restore (archived -> active).
 * Returns null when nothing changed, so an idempotent no-op never creates an
 * Undo entry.
 */
export function createArchiveUndoEntry(
  before: Opportunity,
  after: Opportunity,
): ArchiveUndoEntry | null {
  if (before.id !== after.id) return null;
  const wasArchived = isArchived(before);
  const isNowArchived = isArchived(after);
  if (wasArchived === isNowArchived) return null;

  return {
    kind: wasArchived ? 'restore' : 'archive',
    id: after.id,
    title: after.title,
    previousArchivedAt: normalizeArchivedAt(before.archivedAt),
    resultingArchivedAt: normalizeArchivedAt(after.archivedAt),
  };
}

/** Captures a deletion and its original position. */
export function createDeleteUndoEntry(
  item: Opportunity,
  index: number,
): DeleteUndoEntry {
  return {
    kind: 'delete',
    id: item.id,
    title: item.title,
    index: Number.isInteger(index) && index >= 0 ? index : 0,
    snapshot: cloneOpportunity(item),
  };
}

/** "1 opportunity" / "3 opportunities", used in Undo messages. */
export function opportunityCount(count: number): string {
  return `${count} ${count === 1 ? 'opportunity' : 'opportunities'}`;
}

/**
 * Captures one batch archive/restore as a single Undo entry.
 *
 * Only records whose archive state actually changed are retained, and only
 * their archive metadata is copied. Returns null when the batch changed
 * nothing, so a no-op never creates an Undo opportunity.
 */
export function createBatchArchiveUndoEntry(
  before: readonly Opportunity[],
  after: readonly Opportunity[],
): BatchArchiveUndoEntry | null {
  const afterById = new Map(after.map((item) => [item.id, item]));
  const items: BatchArchiveItem[] = [];

  for (const original of before) {
    const updated = afterById.get(original.id);
    if (!updated) continue;
    const previousArchivedAt = normalizeArchivedAt(original.archivedAt);
    const resultingArchivedAt = normalizeArchivedAt(updated.archivedAt);
    if (previousArchivedAt === resultingArchivedAt) continue;
    items.push({
      id: updated.id,
      title: updated.title,
      previousArchivedAt,
      resultingArchivedAt,
    });
  }

  if (items.length === 0) return null;
  return {
    // A batch is homogeneous; the first changed record determines the label.
    kind: items[0].resultingArchivedAt === undefined ? 'batch-restore' : 'batch-archive',
    items,
  };
}

/**
 * Captures one bulk deletion as a single Undo entry.
 *
 * Only records present in `collection` whose IDs were requested are retained,
 * in their original collection order, each with an independent deep copy and
 * its original index. Returns null when the request matches nothing, so a
 * no-op never creates an Undo opportunity.
 */
export function createBatchDeleteUndoEntry(
  collection: readonly Opportunity[],
  ids: Iterable<string>,
): BatchDeleteUndoEntry | null {
  const wanted = new Set(ids);
  if (wanted.size === 0) return null;

  const items: BatchDeleteItem[] = [];
  collection.forEach((item, index) => {
    if (!wanted.has(item.id)) return;
    items.push({
      id: item.id,
      title: item.title,
      index,
      snapshot: cloneOpportunity(item),
    });
  });

  if (items.length === 0) return null;
  return { kind: 'batch-delete', items };
}

function fail(reason: UndoFailureReason, message: string): UndoResult {
  return { ok: false, reason, message };
}

/**
 * Builds the candidate collection for an Undo without mutating `items`.
 *
 * Archive/restore entries only reverse the archive state of the record that is
 * still present, preserving every field that changed since. Delete entries are
 * refused when a record with the same ID now exists, so Undo can never
 * overwrite newer data or silently resurrect a replaced record.
 */
export function applyUndo(items: readonly Opportunity[], entry: UndoEntry): UndoResult {
  if (entry.kind === 'delete') {
    if (items.some((item) => item.id === entry.id)) {
      return fail(
        'conflict',
        `A record with the ID “${entry.id}” already exists, so “${entry.title}” cannot be restored.`,
      );
    }
    if (!entry.snapshot || entry.snapshot.id !== entry.id) {
      return fail('missing', `“${entry.title}” can no longer be restored.`);
    }

    const candidate = [...items];
    const index = Math.min(Math.max(entry.index, 0), candidate.length);
    candidate.splice(index, 0, cloneOpportunity(entry.snapshot));
    const view = isArchived(entry.snapshot) ? 'Archived' : 'Active';
    return {
      ok: true,
      items: candidate,
      message: `“${entry.title}” was restored to the ${view} view.`,
    };
  }

  if (entry.kind === 'batch-archive' || entry.kind === 'batch-restore') {
    if (entry.items.length === 0) {
      return fail('stale', 'There is no archive change left to undo.');
    }

    const updates = new Map<string, Opportunity>();
    for (const target of entry.items) {
      const current = items.find((item) => item.id === target.id);
      if (!current) {
        return fail(
          'missing',
          `“${target.title}” is no longer in your opportunities, so the batch change cannot be undone. Nothing was changed.`,
        );
      }

      if (normalizeArchivedAt(current.archivedAt) !== target.resultingArchivedAt) {
        return fail(
          'stale',
          `The archive state of “${target.title}” has changed since, so the batch change cannot be undone. Nothing was changed.`,
        );
      }

      const previousArchivedAt = normalizeArchivedAt(target.previousArchivedAt);
      if (previousArchivedAt === target.resultingArchivedAt) {
        return fail(
          'stale',
          `There is no archive change left to undo for “${target.title}”.`,
        );
      }

      const updated: Opportunity = { ...current };
      if (previousArchivedAt === undefined) {
        delete updated.archivedAt;
      } else {
        updated.archivedAt = previousArchivedAt;
      }
      updates.set(target.id, updated);
    }

    const count = entry.items.length;
    return {
      ok: true,
      items: items.map((item) => updates.get(item.id) ?? item),
      message:
        entry.kind === 'batch-archive'
          ? `${opportunityCount(count)} ${count === 1 ? 'is' : 'are'} active again.`
          : `${opportunityCount(count)} ${count === 1 ? 'is' : 'are'} archived again.`,
    };
  }

  if (entry.kind === 'batch-delete') {
    if (entry.items.length === 0) {
      return fail('stale', 'There is nothing left to restore.');
    }

    const snapshotIds = new Set<string>();
    const currentIds = new Set(items.map((item) => item.id));

    for (const item of entry.items) {
      if (!item.id || !item.snapshot || item.snapshot.id !== item.id) {
        return fail(
          'missing',
          `“${item.title || item.id}” can no longer be restored. Nothing was changed.`,
        );
      }
      if (snapshotIds.has(item.id)) {
        return fail(
          'stale',
          `The deleted batch cannot be restored because “${item.title}” appears more than once. Nothing was changed.`,
        );
      }
      snapshotIds.add(item.id);
      if (currentIds.has(item.id)) {
        return fail(
          'conflict',
          `A record with the ID “${item.id}” already exists, so the deleted batch cannot be restored. Nothing was changed.`,
        );
      }
      if (!Number.isInteger(item.index) || item.index < 0) {
        return fail(
          'stale',
          'The deleted batch cannot be restored because its original positions are invalid. Nothing was changed.',
        );
      }
    }

    // Ascending original positions, with the ID as a deterministic tie-breaker
    // if malformed data repeats one. Each insertion is clamped to the current
    // bounds, so earlier insertions cannot push a later record out of range.
    const ordered = [...entry.items].sort((a, b) =>
      a.index === b.index ? a.id.localeCompare(b.id) : a.index - b.index,
    );
    const candidate = [...items];
    for (const item of ordered) {
      const index = Math.min(item.index, candidate.length);
      candidate.splice(index, 0, cloneOpportunity(item.snapshot));
    }

    const count = entry.items.length;
    return {
      ok: true,
      items: candidate,
      // "All" makes it explicit that the whole batch, not a subset, came back.
      message:
        count === 1
          ? '1 opportunity was restored.'
          : `All ${count} opportunities were restored.`,
    };
  }

  // The batch branches always return; this guard makes the remaining variant
  // explicit for the type checker.
  if (entry.kind !== 'archive' && entry.kind !== 'restore') {
    return fail('stale', 'There is no archive change left to undo.');
  }

  const current = items.find((item) => item.id === entry.id);
  if (!current) {
    return fail(
      'missing',
      `“${entry.title}” is no longer in your opportunities, so the change cannot be undone.`,
    );
  }

  if (normalizeArchivedAt(current.archivedAt) !== entry.resultingArchivedAt) {
    return fail(
      'stale',
      `The archive state of “${entry.title}” has changed since, so the earlier change cannot be undone.`,
    );
  }

  const previousArchivedAt = normalizeArchivedAt(entry.previousArchivedAt);
  if (previousArchivedAt === entry.resultingArchivedAt) {
    return fail('stale', `There is no archive change left to undo for “${entry.title}”.`);
  }

  const updated: Opportunity = { ...current };
  if (previousArchivedAt === undefined) {
    delete updated.archivedAt;
  } else {
    updated.archivedAt = previousArchivedAt;
  }

  return {
    ok: true,
    items: items.map((item) => (item.id === entry.id ? updated : item)),
    message:
      entry.kind === 'archive'
        ? `“${entry.title}” is active again.`
        : `“${entry.title}” is archived again.`,
  };
}

/** Text for the Undo notification; explains the action that can be reversed. */
export function describeUndoAction(entry: UndoEntry): string {
  switch (entry.kind) {
    case 'archive':
      return `Archived “${entry.title}”.`;
    case 'restore':
      return `Restored “${entry.title}”.`;
    case 'delete':
      return `Deleted “${entry.title}”.`;
    case 'batch-archive':
      return `Archived ${opportunityCount(entry.items.length)}.`;
    case 'batch-restore':
      return `Restored ${opportunityCount(entry.items.length)}.`;
    case 'batch-delete':
      return `Deleted ${opportunityCount(entry.items.length)}.`;
  }
}

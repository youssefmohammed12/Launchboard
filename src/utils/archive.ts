import type { Opportunity } from '../types/opportunity';

/**
 * Archive metadata is a real ISO 8601 timestamp with a date, time and timezone.
 * Accepting only timestamps (rather than any truthy string) keeps malformed
 * stored data from being mistaken for a valid archive state.
 */
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;

/** True only for a genuine ISO 8601 timestamp such as `toISOString()` output. */
export function isValidArchiveTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);

  // Reject impossible dates that `Date.parse` would silently roll over.
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return false;
  }

  if (hour > 23 || minute > 59 || second > 59) return false;
  if (offsetHour > 23 || offsetMinute > 59) return false;

  return Number.isFinite(Date.parse(value));
}

/**
 * Canonical stored representation of archive metadata: a valid timestamp, or
 * `undefined` for active records. Malformed values are repaired to active
 * instead of discarding the opportunity or crashing.
 */
export function normalizeArchivedAt(value: unknown): string | undefined {
  return isValidArchiveTimestamp(value) ? value : undefined;
}

/** A missing or malformed `archivedAt` is treated as active everywhere. */
export function isArchived(item: Pick<Opportunity, 'archivedAt'>): boolean {
  return isValidArchiveTimestamp(item.archivedAt);
}

/** Active records in their original order. Does not mutate the input. */
export function activeOpportunities(items: readonly Opportunity[]): Opportunity[] {
  return items.filter((item) => !isArchived(item));
}

/** Archived records in their original order. Does not mutate the input. */
export function archivedOpportunities(items: readonly Opportunity[]): Opportunity[] {
  return items.filter((item) => isArchived(item));
}

/**
 * Returns an archived copy of an opportunity. Archiving an already archived
 * record is a no-op that keeps the original timestamp and object identity.
 * Only `archivedAt` changes; IDs, status, nested records and activities stay.
 */
export function archiveOpportunity(
  item: Opportunity,
  archivedAt: string = new Date().toISOString(),
): Opportunity {
  if (isArchived(item)) return item;
  const timestamp = normalizeArchivedAt(archivedAt) ?? new Date().toISOString();
  return { ...item, archivedAt: timestamp };
}

/**
 * Returns an active copy of an opportunity, with the archive marker removed.
 * Restoring an already active record is a no-op. Every other field is kept.
 */
export function restoreOpportunity(item: Opportunity): Opportunity {
  if (!isArchived(item)) return item;
  const restored = { ...item };
  delete restored.archivedAt;
  return restored;
}

/** Result shape returned by the app's persist-then-commit archive actions. */
export type ArchiveOperationResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

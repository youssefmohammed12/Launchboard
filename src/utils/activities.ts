import {
  ACTIVITY_TYPES,
  SYSTEM_ACTIVITY_TYPE,
  type ActivityEntry,
  type ActivityType,
  type OpportunityStatus,
} from '../types/opportunity';
import { isValidISODate, toISODate } from './dates';

function isActivityType(value: unknown): value is ActivityType {
  return typeof value === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(value);
}

/**
 * Repairs activities read from storage. A malformed entry is dropped without
 * discarding its parent opportunity. Missing notes become '', while valid
 * entries keep their id, type, date and note.
 */
export function normalizeStoredActivities(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const activities: ActivityEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== 'string' || !entry.id) continue;
    if (!isActivityType(entry.type)) continue;
    if (typeof entry.date !== 'string' || !isValidISODate(entry.date)) continue;
    activities.push({
      id: entry.id,
      type: entry.type,
      date: entry.date,
      note: typeof entry.note === 'string' ? entry.note : '',
    });
  }
  return activities;
}

/**
 * Newest event date first. The stored array is append-only, so for equal dates
 * the later array position is the most recently added event.
 */
export function sortActivities(activities: ActivityEntry[]): ActivityEntry[] {
  return activities
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byDate = b.entry.date.localeCompare(a.entry.date);
      return byDate !== 0 ? byDate : b.index - a.index;
    })
    .map(({ entry }) => entry);
}

/** Creates the single automatic history entry for a genuine status change. */
export function createStatusChangeEntry(
  from: OpportunityStatus,
  to: OpportunityStatus,
  id: string,
): ActivityEntry {
  return {
    id,
    type: SYSTEM_ACTIVITY_TYPE,
    date: toISODate(new Date()),
    note: `Status changed from ${from} to ${to}.`,
  };
}

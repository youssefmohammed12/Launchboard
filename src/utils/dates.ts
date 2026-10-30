import { daysBetweenISODates, isValidISODate, parseISODate, toISODate } from '@launchboard/domain';

/**
 * Calendar-date rules that must match on the client and server live in
 * `@launchboard/domain`. This module keeps the browser-facing helpers that
 * depend on "today" or on locale formatting.
 */
export {
  addDaysToISODate,
  daysBetweenISODates,
  isValidISODate,
  parseISODate,
  toISODate,
} from '@launchboard/domain';

export function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Whole calendar days from today to the deadline (negative = overdue). */
export function daysUntil(iso: string): number | null {
  return daysBetweenISODates(toISODate(new Date()), iso);
}

export function formatDate(iso: string): string {
  const p = parseISODate(iso);
  if (!p || !isValidISODate(iso)) return '—';
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export type DeadlineState = 'overdue' | 'today' | 'upcoming';

export function deadlineLabel(iso: string): { state: DeadlineState; text: string } | null {
  const diff = daysUntil(iso);
  if (diff === null) return null;
  if (diff < 0) return { state: 'overdue', text: `${-diff} day${diff === -1 ? '' : 's'} overdue` };
  if (diff === 0) return { state: 'today', text: 'Due today' };
  return { state: 'upcoming', text: `In ${diff} day${diff === 1 ? '' : 's'}` };
}

export function followUpLabel(iso: string): { state: DeadlineState; text: string } | null {
  if (!isValidISODate(iso)) return null;
  return deadlineLabel(iso);
}

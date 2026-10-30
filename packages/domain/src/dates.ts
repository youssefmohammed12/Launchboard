const pad = (n: number): string => String(n).padStart(2, '0');

/** The three numeric parts of a validated calendar date. */
export interface CalendarDateParts {
  y: number;
  m: number;
  d: number;
}

/**
 * Parses the shape of a `YYYY-MM-DD` string without validating the calendar.
 * Callers that need a real date must also use `isValidISODate`.
 */
export function parseISODate(iso: string): CalendarDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Formats a Date using LOCAL fields (never toISOString, which shifts to UTC). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True only for a real local calendar date in YYYY-MM-DD format. */
export function isValidISODate(iso: string): boolean {
  const p = parseISODate(iso);
  if (!p) return false;
  const d = new Date(p.y, p.m - 1, p.d);
  return d.getFullYear() === p.y && d.getMonth() === p.m - 1 && d.getDate() === p.d;
}

/**
 * Adds whole calendar days to a valid local date. Returns null for an invalid
 * input instead of inventing a date.
 */
export function addDaysToISODate(iso: string, days: number): string | null {
  const p = parseISODate(iso);
  if (!p || !isValidISODate(iso) || !Number.isInteger(days)) return null;
  return toISODate(new Date(p.y, p.m - 1, p.d + days));
}

/**
 * Whole calendar days from one local date to another (negative when `toIso`
 * is earlier). UTC midnights keep DST changes from skewing the result.
 */
export function daysBetweenISODates(fromIso: string, toIso: string): number | null {
  const from = parseISODate(fromIso);
  const to = parseISODate(toIso);
  if (!from || !to || !isValidISODate(fromIso) || !isValidISODate(toIso)) return null;
  const fromDay = Date.UTC(from.y, from.m - 1, from.d);
  const toDay = Date.UTC(to.y, to.m - 1, to.d);
  return Math.round((toDay - fromDay) / 86_400_000);
}

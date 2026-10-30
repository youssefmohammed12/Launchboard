import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  addDaysToISODate,
  daysBetweenISODates,
  daysUntil,
  deadlineLabel,
  followUpLabel,
  formatDate,
  isValidISODate,
  toISODate,
} from './dates';

const TODAY = new Date(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
});

describe('toISODate', () => {
  it('uses local calendar fields rather than UTC fields', () => {
    expect(toISODate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toISODate(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });

  it('pads month and day values', () => {
    expect(toISODate(new Date(2026, 8, 5, 12))).toBe('2026-09-05');
  });
});

describe('addDays', () => {
  it('returns today for zero days', () => {
    expect(addDays(0)).toBe('2026-01-15');
  });

  it('handles positive and negative offsets', () => {
    expect(addDays(1)).toBe('2026-01-16');
    expect(addDays(-1)).toBe('2026-01-14');
  });

  it('crosses month and year boundaries', () => {
    vi.setSystemTime(new Date(2026, 11, 31, 12));

    expect(addDays(1)).toBe('2027-01-01');
    expect(addDays(-1)).toBe('2026-12-30');
  });
});

describe('addDaysToISODate', () => {
  it('adds local calendar days across month, year and leap boundaries', () => {
    expect(addDaysToISODate('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysToISODate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToISODate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToISODate('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToISODate('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('returns null instead of inventing a date for invalid input', () => {
    expect(addDaysToISODate('', 1)).toBeNull();
    expect(addDaysToISODate('2026-02-30', 1)).toBeNull();
    expect(addDaysToISODate('2026-01-01', 1.5)).toBeNull();
  });
});

describe('daysBetweenISODates', () => {
  it('counts whole local calendar days in both directions', () => {
    expect(daysBetweenISODates('2026-01-15', '2026-01-15')).toBe(0);
    expect(daysBetweenISODates('2026-01-15', '2026-01-16')).toBe(1);
    expect(daysBetweenISODates('2026-01-16', '2026-01-15')).toBe(-1);
    expect(daysBetweenISODates('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetweenISODates('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('returns null for invalid dates', () => {
    expect(daysBetweenISODates('', '2026-01-15')).toBeNull();
    expect(daysBetweenISODates('2026-02-30', '2026-03-01')).toBeNull();
  });
});

describe('isValidISODate', () => {
  it('accepts real calendar dates, including leap days', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2026-01-15')).toBe(true);
  });

  it('rejects impossible or non-canonical dates', () => {
    expect(isValidISODate('2023-02-29')).toBe(false);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('2026-1-1')).toBe(false);
    expect(isValidISODate('2026-01-01T00:00:00')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('daysUntil', () => {
  it('returns calendar-day differences relative to today', () => {
    expect(daysUntil('2026-01-15')).toBe(0);
    expect(daysUntil('2026-01-16')).toBe(1);
    expect(daysUntil('2026-01-14')).toBe(-1);
    expect(daysUntil('2026-02-01')).toBe(17);
  });

  it('returns null for missing or invalid dates', () => {
    expect(daysUntil('')).toBeNull();
    expect(daysUntil('not-a-date')).toBeNull();
    expect(daysUntil('2026-02-30')).toBeNull();
  });
});

describe('deadlineLabel', () => {
  it('describes overdue, today and upcoming deadlines', () => {
    expect(deadlineLabel('2026-01-14')).toEqual({ state: 'overdue', text: '1 day overdue' });
    expect(deadlineLabel('2026-01-13')).toEqual({ state: 'overdue', text: '2 days overdue' });
    expect(deadlineLabel('2026-01-15')).toEqual({ state: 'today', text: 'Due today' });
    expect(deadlineLabel('2026-01-16')).toEqual({ state: 'upcoming', text: 'In 1 day' });
    expect(deadlineLabel('2026-01-17')).toEqual({ state: 'upcoming', text: 'In 2 days' });
  });

  it('returns null for invalid dates', () => {
    expect(deadlineLabel('not-a-date')).toBeNull();
    expect(deadlineLabel('2026-02-30')).toBeNull();
  });
});

describe('followUpLabel', () => {
  it('uses the same urgency labels for valid follow-up dates', () => {
    expect(followUpLabel('2026-01-15')).toEqual({ state: 'today', text: 'Due today' });
    expect(followUpLabel('2026-01-18')).toEqual({ state: 'upcoming', text: 'In 3 days' });
  });

  it('rejects invalid follow-up dates', () => {
    expect(followUpLabel('2026-02-30')).toBeNull();
    expect(followUpLabel('')).toBeNull();
  });
});

describe('formatDate', () => {
  it('formats valid dates and uses an em dash for invalid dates', () => {
    expect(formatDate('2026-01-05')).not.toBe('—');
    expect(formatDate('2026-01-05')).toContain('2026');
    expect(formatDate('2026-02-30')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

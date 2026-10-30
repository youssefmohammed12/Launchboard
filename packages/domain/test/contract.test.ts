import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_TYPES,
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  SYSTEM_ACTIVITY_TYPE,
  USER_ACTIVITY_TYPES,
  addDaysToISODate,
  daysBetweenISODates,
  isValidContactEmail,
  isValidISODate,
  isValidInterviewTime,
  isValidUrl,
  normalizeTagList,
  toISODate,
} from '../src/index';

const sourceDir = join(process.cwd(), 'packages', 'domain', 'src');

describe('controlled values', () => {
  it('keeps the persisted allowlists stable', () => {
    expect(OPPORTUNITY_TYPES).toEqual(['Internship', 'Full-time', 'Part-time', 'Freelance']);
    expect(OPPORTUNITY_STATUSES).toEqual(['Saved', 'Applied', 'Interview', 'Offer', 'Rejected']);
    expect(PRIORITIES).toEqual(['Low', 'Medium', 'High']);
    expect(INTERVIEW_MODES).toEqual(['Phone', 'Video', 'In person', 'Assessment', 'Other']);
    expect(INTERVIEW_STATUSES).toEqual(['Scheduled', 'Completed', 'Cancelled']);
    expect(INTERVIEW_OUTCOMES).toEqual(['Positive', 'Negative', 'No decision']);
    expect(MATERIAL_KINDS).toEqual(['Resume', 'Cover Letter', 'Portfolio', 'Assessment', 'Other']);
    expect(MATERIAL_STATUSES).toEqual(['Draft', 'Ready', 'Submitted', 'Superseded']);
    expect(SYSTEM_ACTIVITY_TYPE).toBe('Status changed');
    expect(ACTIVITY_TYPES).toEqual([...USER_ACTIVITY_TYPES, SYSTEM_ACTIVITY_TYPE]);
  });
});

describe('calendar dates', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(isValidISODate('2024-02-29')).toBe(true);
    expect(isValidISODate('2023-02-29')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-4-01')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });

  it('formats local dates without a UTC shift', () => {
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysToISODate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToISODate('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToISODate('2026-13-01', 1)).toBeNull();
    expect(addDaysToISODate('2026-01-01', 1.5)).toBeNull();
  });

  it('counts whole calendar days without DST skew', () => {
    expect(daysBetweenISODates('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetweenISODates('2026-03-30', '2026-03-28')).toBe(-2);
    expect(daysBetweenISODates('2026-02-30', '2026-03-01')).toBeNull();
  });
});

describe('tag normalization', () => {
  it('trims, drops empties and deduplicates case-insensitively', () => {
    expect(normalizeTagList([' Remote ', 'remote', 42, '', '  ', 'React'])).toEqual([
      'Remote',
      'React',
    ]);
  });

  it('caps individual tags without capping the count', () => {
    const longTag = 'x'.repeat(30);
    expect(normalizeTagList([longTag])).toEqual(['x'.repeat(24)]);
    expect(normalizeTagList(Array.from({ length: 12 }, (_, i) => `tag-${i}`))).toHaveLength(12);
  });
});

describe('field validation', () => {
  it('accepts only http(s) URLs', () => {
    expect(isValidUrl('https://example.com/a?b=1')).toBe(true);
    expect(isValidUrl('http://example.com')).toBe(true);
    expect(isValidUrl('ftp://example.com')).toBe(false);
    expect(isValidUrl('not a url')).toBe(false);
  });

  it('accepts only HH:mm local times', () => {
    expect(isValidInterviewTime('09:05')).toBe(true);
    expect(isValidInterviewTime('23:59')).toBe(true);
    expect(isValidInterviewTime('9:05')).toBe(false);
    expect(isValidInterviewTime('24:00')).toBe(false);
  });

  it('uses the practical email rule', () => {
    expect(isValidContactEmail('jordan+tag@example.co.uk')).toBe(true);
    expect(isValidContactEmail('name@example')).toBe(false);
    expect(isValidContactEmail('name @example.com')).toBe(false);
  });
});

describe('backup contract', () => {
  it('keeps the version-1 envelope identity', () => {
    expect(BACKUP_FORMAT).toBe('launchboard-backup');
    expect(BACKUP_SCHEMA_VERSION).toBe(1);
  });
});

describe('environment independence', () => {
  it('contains no browser, React or persistence modules', () => {
    const forbidden = [
      /\bwindow\b/,
      /\bdocument\b/,
      /\blocalStorage\b/,
      /\bsessionStorage\b/,
      /from ['"]react['"]/,
      /@testing-library/,
      /from ['"]\.\/storage/,
    ];
    const files = readdirSync(sourceDir).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(join(sourceDir, file), 'utf8');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${file} matched ${pattern}`).toBe(false);
      }
    }
  });
});

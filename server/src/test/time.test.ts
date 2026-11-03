import { describe, expect, it } from 'vitest';
import {
  isUtcExpired,
  isWithinIdleWindow,
  parseUtcDateTime,
} from '../auth/time.js';

describe('parseUtcDateTime', () => {
  it('parses SQL DATETIME values as UTC, including milliseconds', () => {
    expect(parseUtcDateTime('2026-10-31 10:20:30.125').toISOString()).toBe(
      '2026-10-31T10:20:30.125Z',
    );
    expect(parseUtcDateTime('2026-10-31 10:20:30.5').toISOString()).toBe(
      '2026-10-31T10:20:30.500Z',
    );
  });

  it('parses ISO timestamps only when an explicit timezone is present', () => {
    expect(parseUtcDateTime('2026-10-31T10:20:30.125Z').toISOString()).toBe(
      '2026-10-31T10:20:30.125Z',
    );
    expect(parseUtcDateTime('2026-10-31T12:20:30+02:00').toISOString()).toBe(
      '2026-10-31T10:20:30.000Z',
    );
  });

  it('clones valid Date values and preserves their instant', () => {
    const original = new Date('2026-10-31T10:20:30.000Z');
    const parsed = parseUtcDateTime(original);
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
  });

  it.each([
    null,
    undefined,
    '',
    '2026-10-31',
    '2026-10-31T10:20:30',
    '2026-02-30 10:20:30',
    '2025-02-29 10:20:30',
    '2026-10-31 24:00:00',
    '2026-10-31 10:60:00',
    '2026-10-31 10:20:60',
    '2026-10-31 10:20:30.1234',
    '2026-10-31T10:20:30+15:00',
    'not-a-date',
  ])('returns Invalid Date for invalid or absent input: %s', (value) => {
    expect(Number.isNaN(parseUtcDateTime(value as any).getTime())).toBe(true);
  });

  it('returns Invalid Date for an invalid Date instance', () => {
    expect(Number.isNaN(parseUtcDateTime(new Date(Number.NaN)).getTime())).toBe(true);
  });
});

describe('isUtcExpired', () => {
  const now = new Date('2026-10-31T10:00:00.000Z');

  it('returns false for a future expiry', () => {
    expect(isUtcExpired('2026-10-31 10:00:00.001', now)).toBe(false);
  });

  it('returns true at the exact expiry boundary and after expiry', () => {
    expect(isUtcExpired('2026-10-31 10:00:00.000', now)).toBe(true);
    expect(isUtcExpired('2026-10-31 09:59:59.999', now)).toBe(true);
  });

  it('fails closed for invalid expiry and comparison timestamps', () => {
    expect(isUtcExpired('invalid', now)).toBe(true);
    expect(isUtcExpired(null, now)).toBe(true);
    expect(isUtcExpired('2026-10-31 11:00:00', new Date(Number.NaN))).toBe(true);
  });
});

describe('isWithinIdleWindow', () => {
  const now = new Date('2026-10-31T10:00:00.000Z');
  const idleMs = 30 * 60 * 1000;

  it('accepts timestamps inside and exactly on the idle boundary', () => {
    expect(isWithinIdleWindow('2026-10-31 09:45:00.000', idleMs, now)).toBe(true);
    expect(isWithinIdleWindow('2026-10-31 09:30:00.000', idleMs, now)).toBe(true);
  });

  it('rejects timestamps outside the idle window or in the future', () => {
    expect(isWithinIdleWindow('2026-10-31 09:29:59.999', idleMs, now)).toBe(false);
    expect(isWithinIdleWindow('2026-10-31 10:00:00.001', idleMs, now)).toBe(false);
  });

  it('fails closed for invalid timestamps and invalid idle windows', () => {
    expect(isWithinIdleWindow('not-a-date', idleMs, now)).toBe(false);
    expect(isWithinIdleWindow(null, idleMs, now)).toBe(false);
    expect(isWithinIdleWindow('2026-10-31 09:59:00', idleMs, new Date(Number.NaN))).toBe(false);
    expect(isWithinIdleWindow('2026-10-31 09:59:00', -1, now)).toBe(false);
    expect(isWithinIdleWindow('2026-10-31 09:59:00', Number.NaN, now)).toBe(false);
  });
});

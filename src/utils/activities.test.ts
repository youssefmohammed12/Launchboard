import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeActivity } from '../test/fixtures';
import {
  createStatusChangeEntry,
  normalizeStoredActivities,
  sortActivities,
} from './activities';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
});

describe('normalizeStoredActivities', () => {
  it('returns an empty list for non-array input', () => {
    expect(normalizeStoredActivities(undefined)).toEqual([]);
    expect(normalizeStoredActivities('not-an-array')).toEqual([]);
    expect(normalizeStoredActivities({})).toEqual([]);
  });

  it('keeps valid manual and automatic activities and repairs a missing note', () => {
    const manual = makeActivity({
      id: 'manual',
      type: 'Interview scheduled',
      date: '2026-01-10',
      note: 'Technical screen',
    });
    const automatic = makeActivity({
      id: 'automatic',
      type: 'Status changed',
      date: '2026-01-11',
      note: 'Status changed from Applied to Interview.',
    });
    const missingNote = {
      id: 'missing-note',
      type: 'Other',
      date: '2026-01-12',
    };

    expect(normalizeStoredActivities([manual, automatic, missingNote])).toEqual([
      manual,
      automatic,
      { ...missingNote, note: '' },
    ]);
  });

  it('drops only malformed activity entries', () => {
    const valid = makeActivity({ id: 'valid' });
    const malformed = [
      null,
      'not-an-activity',
      { id: '', type: 'Other', date: '2026-01-01' },
      { id: 'bad-type', type: 'Unknown activity', date: '2026-01-01' },
      { id: 'bad-date', type: 'Other', date: '2026-02-30' },
      { id: 'missing-date', type: 'Other' },
    ];

    expect(normalizeStoredActivities([valid, ...malformed])).toEqual([valid]);
  });
});

describe('sortActivities', () => {
  it('sorts by date descending and later append order first for equal dates', () => {
    const older = makeActivity({ id: 'older', date: '2026-01-10' });
    const newerFirst = makeActivity({ id: 'newer-first', date: '2026-01-12' });
    const newerSecond = makeActivity({ id: 'newer-second', date: '2026-01-12' });

    const sorted = sortActivities([older, newerFirst, newerSecond]);

    expect(sorted.map((activity) => activity.id)).toEqual([
      'newer-second',
      'newer-first',
      'older',
    ]);
  });

  it('does not mutate the stored order', () => {
    const activities = [
      makeActivity({ id: 'older', date: '2026-01-10' }),
      makeActivity({ id: 'newer', date: '2026-01-12' }),
    ];

    sortActivities(activities);

    expect(activities.map((activity) => activity.id)).toEqual(['older', 'newer']);
  });
});

describe('createStatusChangeEntry', () => {
  it('creates a dated automatic entry with the user-facing note', () => {
    expect(createStatusChangeEntry('Applied', 'Interview', 'status-1')).toEqual({
      id: 'status-1',
      type: 'Status changed',
      date: '2026-01-15',
      note: 'Status changed from Applied to Interview.',
    });
  });
});

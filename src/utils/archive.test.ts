import { describe, expect, it } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from '../test/fixtures';
import {
  activeOpportunities,
  archiveOpportunity,
  archivedOpportunities,
  isArchived,
  isValidArchiveTimestamp,
  normalizeArchivedAt,
  restoreOpportunity,
} from './archive';

const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

describe('archive timestamps', () => {
  it('accepts genuine ISO 8601 timestamps and preserves them exactly', () => {
    expect(isValidArchiveTimestamp(ARCHIVED_AT)).toBe(true);
    expect(isValidArchiveTimestamp('2026-03-04T09:30:00Z')).toBe(true);
    expect(isValidArchiveTimestamp('2026-03-04T09:30:00+02:00')).toBe(true);
    expect(normalizeArchivedAt(ARCHIVED_AT)).toBe(ARCHIVED_AT);
  });

  it('rejects date-only values, arbitrary strings, impossible dates and non-strings', () => {
    for (const value of [
      '',
      'archived',
      '2026-03-04',
      '2026-02-30T09:30:00.000Z',
      '2026-13-04T09:30:00.000Z',
      '2026-03-04T25:30:00.000Z',
      null,
      undefined,
      42,
      true,
    ]) {
      expect(isValidArchiveTimestamp(value)).toBe(false);
      expect(normalizeArchivedAt(value)).toBeUndefined();
    }
  });

  it('treats missing or malformed metadata as active', () => {
    expect(isArchived(makeOpportunity())).toBe(false);
    expect(isArchived(makeOpportunity({ archivedAt: 'not-a-timestamp' }))).toBe(false);
    expect(isArchived(makeOpportunity({ archivedAt: ARCHIVED_AT }))).toBe(true);
  });
});

describe('active and archived selectors', () => {
  const active = makeOpportunity({ id: 'active' });
  const archived = makeOpportunity({ id: 'archived', archivedAt: ARCHIVED_AT });
  const malformed = makeOpportunity({ id: 'malformed', archivedAt: 'archived yesterday' });

  it('splits records without mutating or reordering them', () => {
    const items = [active, archived, malformed];
    const snapshot = [...items];

    expect(activeOpportunities(items).map((item) => item.id)).toEqual(['active', 'malformed']);
    expect(archivedOpportunities(items).map((item) => item.id)).toEqual(['archived']);
    expect(items).toEqual(snapshot);
  });

  it('returns empty collections when there is nothing to select', () => {
    expect(activeOpportunities([])).toEqual([]);
    expect(archivedOpportunities([])).toEqual([]);
    expect(archivedOpportunities([active])).toEqual([]);
    expect(activeOpportunities([archived])).toEqual([]);
  });
});

describe('archiveOpportunity', () => {
  it('adds only the archive timestamp while preserving ids, status and nested data', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this activity.' });
    const contact = makeContact({ id: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'op-1',
      status: 'Interview',
      activities: [activity],
      contacts: [contact],
      materials: [material],
      interviews: [interview],
    });
    const snapshot = JSON.parse(JSON.stringify(item)) as typeof item;

    const archived = archiveOpportunity(item, ARCHIVED_AT);

    expect(archived.archivedAt).toBe(ARCHIVED_AT);
    expect(archived.id).toBe('op-1');
    expect(archived.status).toBe('Interview');
    expect(archived.activities).toEqual([activity]);
    expect(archived.contacts).toEqual([contact]);
    expect(archived.materials).toEqual([material]);
    expect(archived.interviews).toEqual([interview]);
    expect(archived.activities).toHaveLength(1);
    expect(archived).not.toBe(item);
    expect(item).toEqual(snapshot);
    expect(item.archivedAt).toBeUndefined();
  });

  it('is idempotent for an already archived record', () => {
    const item = makeOpportunity({ id: 'op-1', archivedAt: ARCHIVED_AT });

    expect(archiveOpportunity(item, '2026-04-01T00:00:00.000Z')).toBe(item);
    expect(archiveOpportunity(item).archivedAt).toBe(ARCHIVED_AT);
  });

  it('never fabricates activity history or changes application status', () => {
    const item = makeOpportunity({ status: 'Offer', activities: [] });

    const archived = archiveOpportunity(item, ARCHIVED_AT);

    expect(archived.status).toBe('Offer');
    expect(archived.activities).toEqual([]);
  });
});

describe('restoreOpportunity', () => {
  it('removes the archive marker while preserving every other field', () => {
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'op-1',
      status: 'Applied',
      archivedAt: ARCHIVED_AT,
      contacts: [contact],
      interviews: [interview],
    });
    const snapshot = JSON.parse(JSON.stringify(item)) as typeof item;

    const restored = restoreOpportunity(item);

    expect(isArchived(restored)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(restored, 'archivedAt')).toBe(false);
    expect(restored.id).toBe('op-1');
    expect(restored.status).toBe('Applied');
    expect(restored.contacts).toEqual([contact]);
    expect(restored.interviews).toEqual([interview]);
    expect(restored.activities).toEqual([]);
    expect(item).toEqual(snapshot);
  });

  it('is idempotent for an already active record', () => {
    const item = makeOpportunity({ id: 'op-1' });

    expect(restoreOpportunity(item)).toBe(item);
  });
});

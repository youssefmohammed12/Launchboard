import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import {
  activeDeadlines,
  applyFilters,
  collectTags,
  computeStats,
  emptyForm,
  followUpItems,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normalizeStoredTags,
  normalizeTagList,
  parseTagInput,
  resolveBulkDeleteTargets,
  validate,
  type Filters,
} from './opportunities';

const baseFilters: Filters = {
  query: '',
  type: 'All',
  status: 'All',
  priority: 'All',
  tag: '',
  sort: 'asc',
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
});

describe('computeStats', () => {
  it('returns zeros for an empty collection', () => {
    expect(computeStats([])).toEqual({ total: 0, applied: 0, interviews: 0, offers: 0 });
  });

  it('uses the application-sent definition implemented by the app', () => {
    const items = [
      makeOpportunity({ id: 'saved', status: 'Saved' }),
      makeOpportunity({ id: 'applied', status: 'Applied' }),
      makeOpportunity({ id: 'interview', status: 'Interview' }),
      makeOpportunity({ id: 'offer', status: 'Offer' }),
      makeOpportunity({ id: 'rejected', status: 'Rejected' }),
    ];

    expect(computeStats(items)).toEqual({
      total: 5,
      applied: 3,
      interviews: 1,
      offers: 1,
    });
  });

  it('excludes archived opportunities from active statistics', () => {
    const items = [
      makeOpportunity({ id: 'active', status: 'Interview' }),
      makeOpportunity({
        id: 'archived-offer',
        status: 'Offer',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ];

    expect(computeStats(items)).toEqual({
      total: 1,
      applied: 1,
      interviews: 1,
      offers: 0,
    });
  });
});

describe('applyFilters', () => {
  const items = [
    makeOpportunity({
      id: 'react-intern',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      type: 'Internship',
      status: 'Applied',
      priority: 'High',
      tags: ['Remote', 'React'],
      deadline: '2026-02-01',
    }),
    makeOpportunity({
      id: 'backend',
      title: 'Backend Developer',
      company: 'Frontend Co.',
      type: 'Full-time',
      status: 'Interview',
      priority: 'Medium',
      tags: ['Backend'],
      deadline: '2026-01-15',
    }),
    makeOpportunity({
      id: 'freelance',
      title: 'Landing Page',
      company: 'Olive & Co.',
      type: 'Freelance',
      status: 'Saved',
      priority: 'Low',
      tags: ['Design'],
      deadline: '',
    }),
  ];

  it('searches title and company case-insensitively and trims the query', () => {
    expect(applyFilters(items, { ...baseFilters, query: '  FRONTEND  ' }).map((o) => o.id)).toEqual([
      'backend',
      'react-intern',
    ]);
  });

  it('combines type, status, priority and tag filters', () => {
    const result = applyFilters(items, {
      ...baseFilters,
      type: 'Full-time',
      status: 'Interview',
      priority: 'Medium',
      tag: 'backend',
    });

    expect(result.map((o) => o.id)).toEqual(['backend']);
  });

  it('matches tags case-insensitively but does not use substring matching', () => {
    expect(applyFilters(items, { ...baseFilters, tag: 'react' }).map((o) => o.id)).toEqual([
      'react-intern',
    ]);
    expect(applyFilters(items, { ...baseFilters, tag: 'reac' })).toEqual([]);
  });

  it('returns an empty list when nothing matches or the collection is empty', () => {
    expect(applyFilters(items, { ...baseFilters, query: 'No Such Role' })).toEqual([]);
    expect(applyFilters([], baseFilters)).toEqual([]);
  });

  it('sorts deadlines ascending and descending with undated items last', () => {
    const ascending = applyFilters(items, { ...baseFilters, sort: 'asc' });
    const descending = applyFilters(items, { ...baseFilters, sort: 'desc' });

    expect(ascending.map((o) => o.id)).toEqual(['backend', 'react-intern', 'freelance']);
    expect(descending.map((o) => o.id)).toEqual(['react-intern', 'backend', 'freelance']);
  });

  it('does not change the original collection', () => {
    const before = items.map((o) => o.id);
    applyFilters(items, { ...baseFilters, sort: 'desc' });

    expect(items.map((o) => o.id)).toEqual(before);
  });
});

describe('activeDeadlines', () => {
  it('keeps active statuses, excludes offers/rejections, and sorts by deadline', () => {
    const items = [
      makeOpportunity({ id: 'saved-later', status: 'Saved', deadline: '2026-02-01' }),
      makeOpportunity({ id: 'applied-today', status: 'Applied', deadline: '2026-01-15' }),
      makeOpportunity({ id: 'interview-earlier', status: 'Interview', deadline: '2026-01-10' }),
      makeOpportunity({ id: 'offer', status: 'Offer', deadline: '2026-01-01' }),
      makeOpportunity({ id: 'rejected', status: 'Rejected', deadline: '2026-01-02' }),
      makeOpportunity({ id: 'undated', status: 'Saved', deadline: '' }),
    ];

    expect(activeDeadlines(items).map((o) => o.id)).toEqual([
      'interview-earlier',
      'applied-today',
      'saved-later',
    ]);
  });

  it('returns an empty list when there are no active deadlines', () => {
    expect(activeDeadlines([])).toEqual([]);
    expect(
      activeDeadlines([makeOpportunity({ status: 'Offer', deadline: '2026-01-01' })]),
    ).toEqual([]);
  });

  it('excludes archived deadlines', () => {
    const items = [
      makeOpportunity({ id: 'active', deadline: '2026-02-01' }),
      makeOpportunity({
        id: 'archived',
        deadline: '2026-01-01',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ];

    expect(activeDeadlines(items).map((o) => o.id)).toEqual(['active']);
  });
});

describe('followUpItems', () => {
  it('orders overdue follow-ups by most recent, then today, then upcoming', () => {
    const items = [
      makeOpportunity({ id: 'upcoming-near', followUpDate: '2026-01-16' }),
      makeOpportunity({ id: 'overdue-old', followUpDate: '2026-01-10' }),
      makeOpportunity({ id: 'today', followUpDate: '2026-01-15' }),
      makeOpportunity({ id: 'overdue-recent', followUpDate: '2026-01-14' }),
      makeOpportunity({ id: 'upcoming-far', followUpDate: '2026-01-20' }),
      makeOpportunity({ id: 'invalid', followUpDate: '2026-02-30' }),
      makeOpportunity({ id: 'hidden', followUpDate: '' }),
    ];

    expect(followUpItems(items).map((o) => o.id)).toEqual([
      'overdue-recent',
      'overdue-old',
      'today',
      'upcoming-near',
      'upcoming-far',
    ]);
  });

  it('returns an empty list when no valid follow-up dates exist', () => {
    expect(followUpItems([])).toEqual([]);
    expect(followUpItems([makeOpportunity({ followUpDate: 'not-a-date' })])).toEqual([]);
  });

  it('excludes archived follow-ups', () => {
    const items = [
      makeOpportunity({ id: 'active', followUpDate: '2026-01-16' }),
      makeOpportunity({
        id: 'archived',
        followUpDate: '2026-01-17',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ];

    expect(followUpItems(items).map((o) => o.id)).toEqual(['active']);
  });
});

describe('tag normalization', () => {
  it('trims, removes empties, deduplicates case-insensitively and caps length', () => {
    const longTag = 'x'.repeat(MAX_TAG_LENGTH + 10);

    expect(normalizeTagList([' Remote ', 'remote', 42, '', '  ', 'React', longTag])).toEqual([
      'Remote',
      'React',
      'x'.repeat(MAX_TAG_LENGTH),
    ]);
  });

  it('caps stored tags at the per-opportunity maximum', () => {
    const tags = Array.from({ length: MAX_TAGS + 3 }, (_, index) => `tag-${index}`);

    expect(normalizeStoredTags(tags)).toEqual(tags.slice(0, MAX_TAGS));
    expect(normalizeStoredTags('not-an-array')).toEqual([]);
  });

  it('parses comma-separated form input and reports invalid input', () => {
    expect(parseTagInput(' Remote, React, remote ')).toEqual({
      tags: ['Remote', 'React'],
      error: null,
    });
    expect(parseTagInput('')).toEqual({ tags: [], error: null });

    const tooLong = parseTagInput('x'.repeat(MAX_TAG_LENGTH + 1));
    expect(tooLong.tags).toEqual([]);
    expect(tooLong.error).toContain('24 characters');

    const tooMany = parseTagInput(
      Array.from({ length: MAX_TAGS + 1 }, (_, index) => `tag-${index}`).join(','),
    );
    expect(tooMany.error).toContain('at most 10 tags');
  });

  it('collects unique tags in stable sorted order', () => {
    expect(
      collectTags([
        makeOpportunity({ tags: ['react', 'vue'] }),
        makeOpportunity({ tags: ['Vue', 'angular'] }),
      ]),
    ).toEqual(['angular', 'react', 'vue']);
  });
});

describe('validate', () => {
  it('requires title and company and accepts a valid record', () => {
    expect(validate(emptyForm)).toEqual({
      title: 'Title is required.',
      company: 'Company or client is required.',
    });

    expect(
      validate({
        ...emptyForm,
        title: 'Frontend Intern',
        company: 'Northwind Labs',
        url: 'https://example.com/jobs/1',
        followUpDate: '2026-01-20',
      }),
    ).toEqual({});
  });

  it('rejects non-http(s) URLs and invalid optional dates', () => {
    const errors = validate({
      ...emptyForm,
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      url: 'ftp://example.com/jobs/1',
      deadline: '2026-02-30',
      followUpDate: 'next Friday',
    });

    expect(errors.url).toContain('http:// or https://');
    expect(errors.deadline).toContain('valid deadline');
    expect(errors.followUpDate).toContain('valid follow-up date');
  });

  it('accepts valid leap-day deadlines and follow-up dates', () => {
    expect(
      validate({
        ...emptyForm,
        title: 'Frontend Intern',
        company: 'Northwind Labs',
        deadline: '2028-02-29',
        followUpDate: '2028-03-01',
      }),
    ).toEqual({});
  });
});

describe('resolveBulkDeleteTargets', () => {
  const archivedAt = '2026-03-04T09:30:00.000Z';
  const items = [
    makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
    makeOpportunity({ id: 'op-2', title: 'Beta Role', archivedAt }),
    makeOpportunity({ id: 'op-3', title: 'Gamma Role' }),
  ];

  it('returns the requested active records in collection order', () => {
    const result = resolveBulkDeleteTargets(items, ['op-3', 'op-1'], 'active');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets.map((item) => item.id)).toEqual(['op-1', 'op-3']);
  });

  it('returns the requested archived records for the archived mode', () => {
    const result = resolveBulkDeleteTargets(items, ['op-2'], 'archived');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.targets.map((item) => item.id)).toEqual(['op-2']);
    expect(result.targets[0].archivedAt).toBe(archivedAt);
  });

  it('refuses an empty request', () => {
    expect(resolveBulkDeleteTargets(items, [], 'active')).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('refuses duplicated IDs in the request', () => {
    expect(
      resolveBulkDeleteTargets(items, ['op-1', 'op-1'], 'active'),
    ).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('refuses a request for a record that no longer exists', () => {
    expect(
      resolveBulkDeleteTargets(items, ['op-1', 'missing'], 'active'),
    ).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a record that moved to the other archive mode', () => {
    expect(resolveBulkDeleteTargets(items, ['op-2'], 'active')).toEqual({
      ok: false,
      reason: 'mode',
    });
    expect(resolveBulkDeleteTargets(items, ['op-1'], 'archived')).toEqual({
      ok: false,
      reason: 'mode',
    });
  });

  it('refuses a collection whose duplicate IDs make the target ambiguous', () => {
    const duplicated = [
      makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
      makeOpportunity({ id: 'op-1', title: 'Alpha Role Copy' }),
    ];

    expect(resolveBulkDeleteTargets(duplicated, ['op-1'], 'active')).toEqual({
      ok: false,
      reason: 'ambiguous',
    });
  });

  it('refuses a batch that mixes active and archived records', () => {
    expect(
      resolveBulkDeleteTargets(items, ['op-1', 'op-2'], 'active'),
    ).toEqual({ ok: false, reason: 'mode' });
  });
});

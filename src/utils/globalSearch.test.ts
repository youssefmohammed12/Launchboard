import { describe, expect, it } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from '../test/fixtures';
import type { Opportunity } from '../types/opportunity';
import {
  GLOBAL_SEARCH_LIMIT,
  searchOpportunities,
} from './globalSearch';

const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

function richItem(overrides: Partial<Opportunity> = {}): Opportunity {
  return makeOpportunity({
    id: 'op-1',
    title: 'Frontend Intern',
    company: 'Northwind Labs',
    description: 'Build design systems with the platform team.',
    notes: 'Remote-friendly team.',
    tags: ['typescript'],
    type: 'Internship',
    status: 'Applied',
    priority: 'High',
    compensation: '$2,000 / month',
    url: 'https://northwind.example/jobs/42',
    activities: [
      makeActivity({
        id: 'activity-1',
        type: 'Recruiter contacted',
        note: 'Emailed about a referral.',
      }),
    ],
    contacts: [
      makeContact({
        id: 'contact-1',
        name: 'Jordan Lee',
        role: 'Engineering Manager',
        email: 'jordan@northwind.example',
        phone: '+1 555 010 2030',
        notes: 'Met at the career fair.',
      }),
    ],
    interviews: [
      makeInterview({
        id: 'interview-1',
        round: 'Technical Screen',
        preparationNotes: 'Review system design fundamentals.',
        notes: 'Bring portfolio examples.',
        mode: 'Video',
        location: 'Zoom',
        outcome: 'Positive',
        status: 'Scheduled',
        contactId: 'contact-1',
      }),
    ],
    materials: [
      makeMaterial({
        id: 'material-1',
        label: 'Portfolio PDF',
        kind: 'Portfolio',
        version: 'v3',
        status: 'Submitted',
        notes: 'Portfolio case studies included.',
      }),
    ],
    ...overrides,
  });
}

describe('searchOpportunities', () => {
  it('returns no results for an empty or whitespace-only query', () => {
    const items = [richItem()];

    expect(searchOpportunities(items, { query: '' })).toEqual({
      results: [],
      total: 0,
      truncated: false,
    });
    expect(searchOpportunities(items, { query: '   ' })).toEqual({
      results: [],
      total: 0,
      truncated: false,
    });
  });

  it('matches opportunity fields case-insensitively and trims the query', () => {
    const items = [richItem()];

    const byCompany = searchOpportunities(items, { query: '  NORTHWIND  ' });
    expect(byCompany.results[0]).toMatchObject({
      category: 'opportunity',
      label: 'Frontend Intern',
      opportunityId: 'op-1',
      childId: null,
      context: expect.stringContaining('Northwind Labs'),
    });

    for (const query of ['design systems', 'remote-friendly', 'typescript', 'internship', 'high', '$2,000', 'jobs/42']) {
      const response = searchOpportunities(items, { query });
      expect(
        response.results.some(
          (result) => result.category === 'opportunity' && result.childId === null,
        ),
        query,
      ).toBe(true);
    }
  });

  it('returns one typed result per matching nested record with stable identities', () => {
    const items = [richItem()];

    const interview = searchOpportunities(items, { query: 'fundamentals' }).results[0];
    expect(interview).toMatchObject({
      category: 'interview',
      label: 'Technical Screen',
      opportunityId: 'op-1',
      childId: 'interview-1',
      context: expect.stringContaining('Preparation notes'),
    });

    const contact = searchOpportunities(items, { query: 'career fair' }).results[0];
    expect(contact).toMatchObject({
      category: 'contact',
      label: 'Jordan Lee',
      opportunityId: 'op-1',
      childId: 'contact-1',
      context: expect.stringContaining('Notes'),
    });

    const material = searchOpportunities(items, { query: 'v3' }).results[0];
    expect(material).toMatchObject({
      category: 'material',
      label: 'Portfolio PDF',
      opportunityId: 'op-1',
      childId: 'material-1',
      context: expect.stringContaining('Version'),
    });

    const activity = searchOpportunities(items, { query: 'referral' }).results[0];
    expect(activity).toMatchObject({
      category: 'activity',
      label: 'Recruiter contacted',
      opportunityId: 'op-1',
      childId: 'activity-1',
      context: expect.stringContaining('Note'),
    });
  });

  it('does not duplicate a record that matches several of its fields', () => {
    const items = [richItem()];
    const response = searchOpportunities(items, { query: 'portfolio' });

    // The material matches its label, kind and notes; the interview note also
    // matches, but each underlying record appears once.
    expect(response.results.filter((result) => result.category === 'material')).toHaveLength(1);
    expect(response.results.filter((result) => result.category === 'interview')).toHaveLength(1);
    expect(new Set(response.results.map((result) => result.key)).size).toBe(
      response.results.length,
    );

    const byStatus = searchOpportunities(items, { query: 'submitted' });
    expect(byStatus.results.filter((result) => result.category === 'material')).toHaveLength(1);
  });

  it('ranks exact, prefix, other opportunity fields, then nested records', () => {
    const items = [
      makeOpportunity({ id: 'op-1', title: 'Designer', description: 'React interfaces' }),
      makeOpportunity({ id: 'op-2', title: 'React Lead' }),
      makeOpportunity({ id: 'op-3', title: 'React' }),
      makeOpportunity({
        id: 'op-4',
        title: 'Other Role',
        interviews: [makeInterview({ id: 'interview-4', round: 'React Screen' })],
      }),
      makeOpportunity({ id: 'op-5', title: 'React Native' }),
    ];

    const response = searchOpportunities(items, { query: 'react' });

    expect(response.results.map((result) => result.key)).toEqual([
      'opportunity:op-3:root',
      'opportunity:op-2:root',
      'opportunity:op-5:root',
      'opportunity:op-1:root',
      'interview:op-4:interview-4',
    ]);
  });

  it('ranks exact company before a company prefix and other fields', () => {
    const items = [
      makeOpportunity({ id: 'op-1', title: 'Alpha', company: 'Northwind' }),
      makeOpportunity({ id: 'op-2', title: 'Beta', company: 'Northwind Labs' }),
      makeOpportunity({ id: 'op-3', title: 'Gamma', company: 'Other', notes: 'northwind' }),
    ];

    expect(
      searchOpportunities(items, { query: 'northwind' }).results.map((result) => result.key),
    ).toEqual(['opportunity:op-1:root', 'opportunity:op-2:root', 'opportunity:op-3:root']);
  });

  it('breaks ranking ties by collection order and is deterministic', () => {
    const items = [
      makeOpportunity({ id: 'op-1', title: 'React One' }),
      makeOpportunity({ id: 'op-2', title: 'React Two' }),
      makeOpportunity({ id: 'op-3', title: 'React Three' }),
    ];

    const first = searchOpportunities(items, { query: 'react' });
    const second = searchOpportunities(items, { query: 'react' });

    expect(first.results.map((result) => result.opportunityId)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(second.results.map((result) => result.key)).toEqual(
      first.results.map((result) => result.key),
    );
  });

  it('limits results while reporting the true match count', () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      makeOpportunity({ id: `op-${index + 1}`, title: `Role ${index + 1}` }),
    );

    const response = searchOpportunities(items, { query: 'role' });

    expect(response.results).toHaveLength(GLOBAL_SEARCH_LIMIT);
    expect(response.total).toBe(25);
    expect(response.truncated).toBe(true);
    expect(new Set(response.results.map((result) => result.key)).size).toBe(
      GLOBAL_SEARCH_LIMIT,
    );

    const smaller = searchOpportunities(items, { query: 'role', limit: 5 });
    expect(smaller.results).toHaveLength(5);
    expect(smaller.total).toBe(25);
    expect(smaller.truncated).toBe(true);
  });

  it('excludes archived records by default and includes them on request', () => {
    const items = [
      makeOpportunity({ id: 'op-1', title: 'Active Role' }),
      makeOpportunity({
        id: 'op-2',
        title: 'Archived Role',
        archivedAt: ARCHIVED_AT,
      }),
    ];

    const defaultResponse = searchOpportunities(items, { query: 'role' });
    expect(defaultResponse.results.map((result) => result.opportunityId)).toEqual(['op-1']);
    expect(defaultResponse.results[0].archived).toBe(false);

    const included = searchOpportunities(items, { query: 'role', includeArchived: true });
    expect(included.results.map((result) => result.opportunityId)).toEqual(['op-1', 'op-2']);
    expect(included.results[1].archived).toBe(true);

    // Searching must never change the archive state.
    expect(items[1].archivedAt).toBe(ARCHIVED_AT);
  });

  it('does not search or return data from an excluded archived record', () => {
    const items = [
      makeOpportunity({ id: 'op-1', title: 'Active Role' }),
      makeOpportunity({
        id: 'op-2',
        title: 'Archived Role',
        contacts: [makeContact({ id: 'contact-2', name: 'Hidden Recruiter' })],
        archivedAt: ARCHIVED_AT,
      }),
    ];

    const response = searchOpportunities(items, { query: 'hidden' });

    expect(response.results).toEqual([]);
    expect(response.total).toBe(0);
  });

  it('skips child records that have no usable ID', () => {
    const items = [
      makeOpportunity({
        id: 'op-1',
        title: 'Broken Children',
        interviews: [makeInterview({ id: '', round: 'Ghost Screen' })],
        contacts: [makeContact({ id: '', name: 'Ghost Recruiter' })],
      }),
    ];

    expect(searchOpportunities(items, { query: 'ghost' }).results).toEqual([]);
  });

  it('never mutates the source collection', () => {
    const items = [richItem()];
    const before = JSON.stringify(items);

    searchOpportunities(items, { query: 'northwind', includeArchived: true });

    expect(JSON.stringify(items)).toBe(before);
    expect(items[0].contacts[0].name).toBe('Jordan Lee');
    expect(items[0].interviews[0].contactId).toBe('contact-1');
  });
});

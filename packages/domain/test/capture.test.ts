import { describe, expect, it } from 'vitest';
import {
  findOpportunityDuplicates,
  normalizeTextForDuplicateComparison,
  normalizeUrlForDuplicateComparison,
  type OpportunityDuplicateCandidate,
  type Opportunity,
} from '../src/index.js';

const makeOpportunity = (overrides: Partial<Opportunity> = {}): Opportunity => ({
  id: 'opportunity-1',
  title: 'Frontend Engineer',
  company: 'Example Company',
  type: 'Full-time',
  status: 'Saved',
  priority: 'Medium',
  tags: [],
  url: 'https://jobs.example.com/roles/123',
  deadline: '',
  followUpDate: '',
  activities: [],
  interviews: [],
  contacts: [],
  materials: [],
  tasks: [],
  compensation: '',
  description: '',
  notes: '',
  ...overrides,
});

const candidate = (
  overrides: Partial<OpportunityDuplicateCandidate> = {},
): OpportunityDuplicateCandidate => ({
  title: 'Frontend Engineer',
  company: 'Example Company',
  url: 'https://jobs.example.com/roles/123',
  ...overrides,
});

describe('URL duplicate comparison normalization', () => {
  it('normalizes scheme and hostname casing, default ports and fragments', () => {
    expect(normalizeUrlForDuplicateComparison(
      'HTTPS://JOBS.EXAMPLE.COM:443/roles/123?view=full#apply',
    )).toBe('https://jobs.example.com/roles/123?view=full');

    expect(normalizeUrlForDuplicateComparison(
      'http://Jobs.Example.com:80/roles/123',
    )).toBe('http://jobs.example.com/roles/123');
  });

  it('removes known tracking parameters regardless of parameter-name casing', () => {
    expect(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?utm_source=board&gclid=abc&FBCLID=def&view=full&utm_campaign=spring',
    )).toBe('https://jobs.example.com/roles/123?view=full');
  });

  it('keeps job identifiers and all other meaningful query parameters', () => {
    expect(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?jobId=abc-123&source=careers',
    )).toBe('https://jobs.example.com/roles/123?jobId=abc-123&source=careers');

    expect(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?jobId=abc-123',
    )).not.toBe(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?jobId=abc-456',
    ));
  });

  it('does not collapse path case, meaningful query changes or different schemes', () => {
    const base = 'https://jobs.example.com/Roles/123?region=eu';

    expect(normalizeUrlForDuplicateComparison(base)).not.toBe(
      normalizeUrlForDuplicateComparison('https://jobs.example.com/roles/123?region=eu'),
    );
    expect(normalizeUrlForDuplicateComparison(base)).not.toBe(
      normalizeUrlForDuplicateComparison('https://jobs.example.com/Roles/123?region=us'),
    );
    expect(normalizeUrlForDuplicateComparison(base)).not.toBe(
      normalizeUrlForDuplicateComparison('http://jobs.example.com/Roles/123?region=eu'),
    );
  });

  it('ignores ordinary anchor fragments but preserves hash-based job routes', () => {
    expect(normalizeUrlForDuplicateComparison(
      'https://board.example/jobs#apply',
    )).toBe('https://board.example/jobs');

    expect(normalizeUrlForDuplicateComparison(
      'https://board.example/#/jobs/123',
    )).toBe('https://board.example/#/jobs/123');
    expect(normalizeUrlForDuplicateComparison(
      'https://board.example/#!/jobs/123',
    )).toBe('https://board.example/#!/jobs/123');

    expect(normalizeUrlForDuplicateComparison(
      'https://board.example/#/jobs/123',
    )).not.toBe(normalizeUrlForDuplicateComparison(
      'https://board.example/#/jobs/456',
    ));
    expect(normalizeUrlForDuplicateComparison(
      'https://board.example/#!/jobs/123',
    )).not.toBe(normalizeUrlForDuplicateComparison(
      'https://board.example/#!/jobs/456',
    ));
  });

  it('does not match distinct hash-routed jobs as URL duplicates', () => {
    const existing = makeOpportunity({
      url: 'https://board.example/#/jobs/456',
      title: 'A Different Role',
      company: 'A Different Company',
    });

    expect(findOpportunityDuplicates(candidate({
      url: 'https://board.example/#/jobs/123',
    }), [existing])).toEqual([]);
  });

  it('preserves meaningful query parameter order rather than assuming it is interchangeable', () => {
    expect(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?region=eu&jobId=abc',
    )).not.toBe(normalizeUrlForDuplicateComparison(
      'https://jobs.example.com/roles/123?jobId=abc&region=eu',
    ));
  });

  it('returns null for blank, malformed and non-HTTP(S) URLs', () => {
    expect(normalizeUrlForDuplicateComparison('')).toBeNull();
    expect(normalizeUrlForDuplicateComparison('   ')).toBeNull();
    expect(normalizeUrlForDuplicateComparison('not a url')).toBeNull();
    expect(normalizeUrlForDuplicateComparison('javascript:alert(1)')).toBeNull();
    expect(normalizeUrlForDuplicateComparison('ftp://jobs.example.com/roles/123')).toBeNull();
  });
});

describe('duplicate text normalization', () => {
  it('normalizes Unicode compatibility forms, case and repeated whitespace', () => {
    expect(normalizeTextForDuplicateComparison('  ＦＲＯＮＴＥＮＤ\tEngineer  '))
      .toBe('frontend engineer');
    expect(normalizeTextForDuplicateComparison('  EXAMPLE   Company '))
      .toBe('example company');
    expect(normalizeTextForDuplicateComparison('Café')).toBe('café');
  });

  it('does not strip accents or punctuation and does not make blank identities match', () => {
    expect(normalizeTextForDuplicateComparison('resume')).not.toBe(
      normalizeTextForDuplicateComparison('résumé'),
    );
    expect(normalizeTextForDuplicateComparison('Senior Engineer')).not.toBe(
      normalizeTextForDuplicateComparison('Senior-Engineer'),
    );
    expect(normalizeTextForDuplicateComparison(' \t ')).toBe('');
  });
});

describe('opportunity duplicate detection', () => {
  it('reports an exact URL match even when the title differs', () => {
    const existing = makeOpportunity({ title: 'Different title' });
    expect(findOpportunityDuplicates(candidate(), [existing])).toEqual([
      { opportunity: existing, reasons: ['url'] },
    ]);
  });

  it('reports an exact normalized title and company match when URLs differ', () => {
    const existing = makeOpportunity({
      title: '  FRONTEND   ENGINEER ',
      company: 'EXAMPLE COMPANY',
      url: 'https://careers.example.com/job/other',
    });

    expect(findOpportunityDuplicates(candidate(), [existing])).toEqual([
      { opportunity: existing, reasons: ['title-company'] },
    ]);
  });

  it('keeps both reasons when the same record matches by URL and title/company', () => {
    const existing = makeOpportunity();
    expect(findOpportunityDuplicates(candidate(), [existing])).toEqual([
      { opportunity: existing, reasons: ['url', 'title-company'] },
    ]);
  });

  it('includes archived opportunities and preserves the collection order', () => {
    const first = makeOpportunity({
      id: 'archived',
      archivedAt: '2026-10-01T12:00:00.000Z',
      url: 'https://jobs.example.com/roles/123?utm_source=mail',
    });
    const second = makeOpportunity({
      id: 'active',
      title: 'Frontend Engineer',
      company: 'Example Company',
      url: 'https://another.example.com/jobs/5',
    });

    const matches = findOpportunityDuplicates(candidate(), [first, second]);
    expect(matches.map(({ opportunity }) => opportunity.id)).toEqual(['archived', 'active']);
    expect(matches[0]?.reasons).toEqual(['url', 'title-company']);
    expect(matches[1]?.reasons).toEqual(['title-company']);
    expect(matches[0]?.opportunity.archivedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('does not flag a company-only match or a partial title/company identity', () => {
    const sameCompanyOnly = makeOpportunity({
      title: 'Backend Engineer',
      company: 'Example Company',
      url: 'https://careers.example.com/backend',
    });
    const blankTitle = makeOpportunity({
      title: '',
      company: 'Example Company',
      url: 'https://careers.example.com/blank',
    });

    expect(findOpportunityDuplicates(candidate(), [sameCompanyOnly, blankTitle])).toEqual([]);
  });

  it('does not treat invalid candidate URLs as a URL match but still checks title/company', () => {
    const existing = makeOpportunity({
      url: 'https://careers.example.com/jobs/456',
    });

    expect(findOpportunityDuplicates(candidate({ url: 'javascript:alert(1)' }), [existing]))
      .toEqual([{ opportunity: existing, reasons: ['title-company'] }]);
  });

  it('does not mutate the candidate or any existing opportunity', () => {
    const draft = candidate({
      title: '  FRONTEND   ENGINEER ',
      company: ' EXAMPLE COMPANY ',
      url: 'HTTPS://JOBS.EXAMPLE.COM:443/roles/123?utm_source=mail#apply',
    });
    const existing = makeOpportunity({
      title: 'Frontend Engineer',
      company: 'Example Company',
      url: 'https://jobs.example.com/roles/123',
    });
    const draftBefore = { ...draft };
    const existingBefore = structuredClone(existing);

    findOpportunityDuplicates(draft, [existing]);

    expect(draft).toEqual(draftBefore);
    expect(existing).toEqual(existingBefore);
    expect(existing.url).toBe('https://jobs.example.com/roles/123');
    expect(draft.url).toBe('HTTPS://JOBS.EXAMPLE.COM:443/roles/123?utm_source=mail#apply');
  });

  it('returns an empty list for an empty collection or no match', () => {
    expect(findOpportunityDuplicates(candidate(), [])).toEqual([]);
    expect(findOpportunityDuplicates(candidate(), [
      makeOpportunity({
        title: 'Backend Engineer',
        company: 'Other Company',
        url: 'https://careers.example.com/backend',
      }),
    ])).toEqual([]);
  });
});

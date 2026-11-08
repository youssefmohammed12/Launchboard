import { describe, expect, it } from 'vitest';
import {
  extractStructuredJobPostingFields,
  normalizeCompensationDetails,
  normalizeCompensationInterval,
  normalizeEmploymentType,
  normalizeLocationValues,
  normalizePostedDate,
  normalizeWorkplaceType,
} from '../services/captureStructuredFields.js';

describe('structured JobPosting field extraction', () => {
  it('extracts explicit Schema.org locations, department, team, mode, employment type and date', () => {
    const fields = extractStructuredJobPostingFields({
      jobLocation: [
        {
          '@type': 'Place',
          address: {
            streetAddress: '1 Main Street',
            addressLocality: 'Cairo',
            addressRegion: 'Cairo Governorate',
            addressCountry: 'Egypt',
          },
        },
        { '@type': 'Place', name: 'Berlin, Germany' },
      ],
      department: { '@type': 'Organization', name: 'Engineering' },
      team: 'Platform',
      jobLocationType: 'TELECOMMUTE',
      employmentType: ['FULL_TIME'],
      datePosted: '2026-11-05T12:00:00Z',
    });

    expect(fields).toEqual({
      locations: ['1 Main Street, Cairo, Cairo Governorate, Egypt', 'Berlin, Germany'],
      department: 'Engineering',
      team: 'Platform',
      workplaceType: 'Remote',
      employmentType: 'Full-time',
      postedDate: '2026-11-05',
      compensationDetails: null,
    });
  });

  it('extracts structured base salary values without parsing free-text descriptions', () => {
    const fields = extractStructuredJobPostingFields({
      description: 'Salary $40k–$60k; competitive benefits.',
      baseSalary: {
        '@type': 'MonetaryAmount',
        currency: 'USD',
        value: {
          '@type': 'QuantitativeValue',
          minValue: 40000,
          maxValue: 60000,
          unitText: 'YEAR',
        },
      },
    });

    expect(fields.compensationDetails).toEqual({
      minAmount: '40000',
      maxAmount: '60000',
      currency: 'USD',
      interval: 'year',
    });
  });

  it('does not infer physical work locations from applicantLocationRequirements', () => {
    const fields = extractStructuredJobPostingFields({
      applicantLocationRequirements: [
        { '@type': 'AdministrativeArea', name: 'Egypt' },
      ],
      jobLocationType: 'TELECOMMUTE',
    });

    expect(fields.locations).toEqual([]);
    expect(fields.workplaceType).toBe('Remote');
  });

  it('preserves multiple explicit employment types instead of taking only the first', () => {
    expect(extractStructuredJobPostingFields({
      employmentType: ['FULL_TIME', 'PART_TIME'],
    }).employmentType).toBe('Full-time, Part-time');
  });

  it('rejects malformed publication dates while retaining valid date-time values', () => {
    expect(normalizePostedDate('2026-11-05T09:30:00Z')).toBe('2026-11-05');
    expect(normalizePostedDate('2026-02-30T09:30:00Z')).toBe('');
    expect(normalizePostedDate('2026-11-05-not-a-date')).toBe('');
  });

  it('keeps unknown workplace values blank and preserves unknown employer employment labels', () => {
    const fields = extractStructuredJobPostingFields({
      jobLocationType: 'RemoteOrHybrid',
      employmentType: 'Graduate Rotation Programme',
    });

    expect(fields.workplaceType).toBe('');
    expect(fields.employmentType).toBe('Graduate Rotation Programme');
  });
});

describe('provider value normalization', () => {
  it.each([
    ['remote', 'Remote'],
    ['Hybrid', 'Hybrid'],
    ['OnSite', 'On-site'],
    ['unspecified', ''],
  ])('normalizes workplace value %s', (value, expected) => {
    expect(normalizeWorkplaceType(value)).toBe(expected);
  });

  it.each([
    ['FullTime', 'Full-time'],
    ['PartTime', 'Part-time'],
    ['Intern', 'Internship'],
    ['Contract', 'Contract'],
    ['Permanent', 'Permanent'],
  ])('normalizes employment label %s', (value, expected) => {
    expect(normalizeEmploymentType(value)).toBe(expected);
  });

  it.each([
    ['1 YEAR', 'year'],
    ['per-year-salary', 'year'],
    ['MONTHLY', 'month'],
    ['hour', 'hour'],
    ['NONE', ''],
  ])('normalizes salary interval %s', (value, expected) => {
    expect(normalizeCompensationInterval(value)).toBe(expected);
  });

  it('accepts salary ranges only with valid currency/amount data and preserves decimal strings', () => {
    expect(normalizeCompensationDetails('15000.25', '20000.75', 'egp', 'per-month')).toEqual({
      minAmount: '15000.25',
      maxAmount: '20000.75',
      currency: 'EGP',
      interval: 'month',
    });
    expect(normalizeCompensationDetails('25000', '', '', '')).toEqual({
      minAmount: '25000',
      maxAmount: '',
      currency: '',
      interval: '',
    });
    expect(normalizeCompensationDetails('20000', '15000', 'EGP', 'month')).toBeNull();
  });

  it('deduplicates locations and ignores empty labels', () => {
    expect(normalizeLocationValues([' Cairo ', 'cairo', '', 'Berlin'])).toEqual([
      'Cairo',
      'Berlin',
    ]);
  });

  it('keeps only a date-only publication value', () => {
    expect(normalizePostedDate('2026-11-05T09:30:00Z')).toBe('2026-11-05');
    expect(normalizePostedDate('not-a-date')).toBe('');
  });
});

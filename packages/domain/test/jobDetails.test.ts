import { describe, expect, it } from 'vitest';
import { normalizeOpportunityJobDetails } from '../src/index.js';

describe('opportunity job-detail normalization', () => {
  it('defaults every optional field on an old record', () => {
    const result = normalizeOpportunityJobDetails({});

    expect(result).toEqual({
      locations: [],
      department: '',
      team: '',
      workplaceType: '',
      employmentType: '',
      postedDate: '',
      compensationDetails: null,
      repaired: true,
    });
  });

  it('trims and deduplicates locations while preserving their order', () => {
    const result = normalizeOpportunityJobDetails({
      locations: [' Cairo, Egypt ', 'Remote', 'cairo, EGYPT', '', '   ', 'Berlin'],
    });

    expect(result.locations).toEqual(['Cairo, Egypt', 'Remote', 'Berlin']);
    expect(result.repaired).toBe(true);
  });

  it('caps location count and each text field without dropping the rest of the record', () => {
    const result = normalizeOpportunityJobDetails({
      locations: Array.from({ length: 12 }, (_unused, index) => 'Location ' + index),
      department: 'D'.repeat(200),
      team: 'T'.repeat(200),
      employmentType: 'E'.repeat(100),
    });

    expect(result.locations).toHaveLength(10);
    expect(result.department).toHaveLength(160);
    expect(result.team).toHaveLength(160);
    expect(result.employmentType).toHaveLength(80);
    expect(result.repaired).toBe(true);
  });

  it('accepts only known workplace types and real date-only publication dates', () => {
    const result = normalizeOpportunityJobDetails({
      workplaceType: 'Remote',
      postedDate: '2026-11-05',
    });

    expect(result.workplaceType).toBe('Remote');
    expect(result.postedDate).toBe('2026-11-05');
    expect(result.repaired).toBe(true);
    expect(normalizeOpportunityJobDetails({
      workplaceType: 'Anywhere',
      postedDate: '2026-02-30',
    })).toMatchObject({
      workplaceType: '',
      postedDate: '',
    });
  });

  it('rejects currency strings that are longer than a three-letter code', () => {
    expect(normalizeOpportunityJobDetails({
      compensationDetails: {
        minAmount: '15000',
        maxAmount: '',
        currency: 'USDA',
        interval: 'month',
      },
    }).compensationDetails).toEqual({
      minAmount: '15000',
      maxAmount: '',
      currency: '',
      interval: 'month',
    });
  });

  it('does not accept a valid publication-date prefix followed by extra text', () => {
    expect(normalizeOpportunityJobDetails({
      postedDate: '2026-11-05not-a-date',
    }).postedDate).toBe('');
  });

  it('preserves an exact decimal salary range, currency and interval', () => {
    const result = normalizeOpportunityJobDetails({
      compensationDetails: {
        minAmount: '15000.25',
        maxAmount: '20000.75',
        currency: 'egp',
        interval: 'month',
      },
    });

    expect(result.compensationDetails).toEqual({
      minAmount: '15000.25',
      maxAmount: '20000.75',
      currency: 'EGP',
      interval: 'month',
    });
    expect(result.repaired).toBe(true);
  });

  it('allows one-sided salary ranges and leaves unknown currency and interval blank', () => {
    expect(normalizeOpportunityJobDetails({
      compensationDetails: {
        minAmount: '',
        maxAmount: '25000',
        currency: '',
        interval: '',
      },
    }).compensationDetails).toEqual({
      minAmount: '',
      maxAmount: '25000',
      currency: '',
      interval: '',
    });
  });

  it('rejects negative, exponent, malformed and reversed salary ranges', () => {
    for (const compensationDetails of [
      { minAmount: '-1', maxAmount: '', currency: 'USD', interval: 'month' },
      { minAmount: '1e5', maxAmount: '', currency: 'USD', interval: 'month' },
      { minAmount: '15,000', maxAmount: '', currency: 'USD', interval: 'month' },
      { minAmount: '20000', maxAmount: '15000', currency: 'EGP', interval: 'month' },
    ]) {
      expect(normalizeOpportunityJobDetails({ compensationDetails }).compensationDetails).toBeNull();
    }
  });

  it('does not use free-text compensation to invent structured salary details', () => {
    const result = normalizeOpportunityJobDetails({
      compensation: 'EGP 15,000–20,000 per month',
    });

    expect(result.compensationDetails).toBeNull();
    expect(result.repaired).toBe(true);
  });

  it('does not mark already normalized fields as repaired', () => {
    const value = {
      locations: ['Cairo, Egypt', 'Berlin'],
      department: 'Engineering',
      team: 'Platform',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      postedDate: '2026-11-05',
      compensationDetails: {
        minAmount: '15000',
        maxAmount: '20000',
        currency: 'EGP',
        interval: 'month',
      },
    };

    expect(normalizeOpportunityJobDetails(value)).toEqual({
      ...value,
      repaired: false,
    });
  });
});

import {
  COMPENSATION_INTERVALS,
  WORKPLACE_TYPES,
  type CompensationDetails,
  type WorkplaceType,
} from './opportunity.js';
import {
  MAX_COMPENSATION_AMOUNT_LENGTH,
  MAX_OPPORTUNITY_DEPARTMENT_LENGTH,
  MAX_OPPORTUNITY_EMPLOYMENT_TYPE_LENGTH,
  MAX_OPPORTUNITY_LOCATION_LENGTH,
  MAX_OPPORTUNITY_LOCATIONS,
  MAX_OPPORTUNITY_TEAM_LENGTH,
} from './limits.js';
import { isValidISODate } from './dates.js';

export interface NormalizedOpportunityJobDetails {
  locations: string[];
  department: string;
  team: string;
  workplaceType: WorkplaceType | '';
  employmentType: string;
  postedDate: string;
  compensationDetails: CompensationDetails | null;
  repaired: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeLocations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const locations: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (typeof candidate !== 'string') continue;
    const location = candidate.trim().slice(0, MAX_OPPORTUNITY_LOCATION_LENGTH);
    if (!location) continue;
    const key = location.normalize('NFKC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push(location);
    if (locations.length >= MAX_OPPORTUNITY_LOCATIONS) break;
  }
  return locations;
}

function normalizeAmount(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const amount = String(value).trim();
  if (
    !amount ||
    amount.length > MAX_COMPENSATION_AMOUNT_LENGTH ||
    !/^\d{1,14}(?:\.\d{1,4})?$/u.test(amount)
  ) return '';
  return amount;
}

function compareAmounts(left: string, right: string): number {
  const [leftWhole = '0', leftFraction = ''] = left.split('.');
  const [rightWhole = '0', rightFraction = ''] = right.split('.');
  const normalizedLeftWhole = leftWhole.replace(/^0+(?=\d)/u, '');
  const normalizedRightWhole = rightWhole.replace(/^0+(?=\d)/u, '');

  if (normalizedLeftWhole.length !== normalizedRightWhole.length) {
    return normalizedLeftWhole.length < normalizedRightWhole.length ? -1 : 1;
  }
  if (normalizedLeftWhole !== normalizedRightWhole) {
    return normalizedLeftWhole < normalizedRightWhole ? -1 : 1;
  }

  const normalizedLeftFraction = leftFraction.padEnd(4, '0');
  const normalizedRightFraction = rightFraction.padEnd(4, '0');
  if (normalizedLeftFraction === normalizedRightFraction) return 0;
  return normalizedLeftFraction < normalizedRightFraction ? -1 : 1;
}

function normalizeCompensationDetails(value: unknown): CompensationDetails | null {
  if (!isRecord(value)) return null;

  const minAmount = normalizeAmount(value.minAmount);
  const maxAmount = normalizeAmount(value.maxAmount);
  if (!minAmount && !maxAmount) return null;
  if (minAmount && maxAmount && compareAmounts(minAmount, maxAmount) > 0) return null;

  const rawCurrency = typeof value.currency === 'string'
    ? value.currency.trim().toUpperCase()
    : '';
  const currency = /^[A-Z]{3}$/u.test(rawCurrency) ? rawCurrency : '';
  const interval = COMPENSATION_INTERVALS.find((candidate) => candidate === value.interval) ?? '';

  return { minAmount, maxAmount, currency, interval };
}

function sameStringArray(raw: unknown, normalized: string[]): boolean {
  return Array.isArray(raw) &&
    raw.length === normalized.length &&
    raw.every((candidate, index) => candidate === normalized[index]);
}

function sameCompensationDetails(raw: unknown, normalized: CompensationDetails | null): boolean {
  if (normalized === null) return raw === null;
  if (!isRecord(raw)) return false;
  return raw.minAmount === normalized.minAmount &&
    raw.maxAmount === normalized.maxAmount &&
    raw.currency === normalized.currency &&
    raw.interval === normalized.interval;
}

/**
 * Shared normalizer for the new optional job-detail fields.
 * It is used by both LocalStorage and backup/API import paths so their repair
 * behavior does not drift. It never attempts to infer values from free text.
 */
export function normalizeOpportunityJobDetails(
  value: Record<string, unknown>,
): NormalizedOpportunityJobDetails {
  const locations = normalizeLocations(value.locations);
  const department = limitedText(value.department, MAX_OPPORTUNITY_DEPARTMENT_LENGTH);
  const team = limitedText(value.team, MAX_OPPORTUNITY_TEAM_LENGTH);
  const workplaceType = WORKPLACE_TYPES.find((candidate) => candidate === value.workplaceType) ?? '';
  const employmentType = limitedText(value.employmentType, MAX_OPPORTUNITY_EMPLOYMENT_TYPE_LENGTH);
  const postedDateCandidate = typeof value.postedDate === 'string'
    ? value.postedDate.trim()
    : '';
  const postedDate = isValidISODate(postedDateCandidate) ? postedDateCandidate : '';
  const compensationDetails = normalizeCompensationDetails(value.compensationDetails);

  const repaired =
    !sameStringArray(value.locations, locations) ||
    value.department !== department ||
    value.team !== team ||
    value.workplaceType !== workplaceType ||
    value.employmentType !== employmentType ||
    value.postedDate !== postedDate ||
    !sameCompensationDetails(value.compensationDetails, compensationDetails);

  return {
    locations,
    department,
    team,
    workplaceType,
    employmentType,
    postedDate,
    compensationDetails,
    repaired,
  };
}

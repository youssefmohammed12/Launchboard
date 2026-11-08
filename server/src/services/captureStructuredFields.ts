import {
  isValidISODate,
  normalizeOpportunityJobDetails,
  type CompensationDetails,
  type CompensationInterval,
  type CaptureStructuredFields,
  type WorkplaceType,
} from '@launchboard/domain';

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function readName(value: unknown): string {
  const candidate = first(value);
  if (typeof candidate === 'string') return candidate.trim();
  if (isRecord(candidate) && typeof candidate.name === 'string') {
    return candidate.name.trim();
  }
  return '';
}

function joinLocationParts(parts: unknown[]): string {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part.trim();
      if (isRecord(part) && typeof part.name === 'string') return part.name.trim();
      return '';
    })
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function normalizeLocationValues(value: unknown): string[] {
  const locations: string[] = [];
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];

  for (const entry of entries) {
    if (typeof entry === 'string') {
      const label = entry.trim();
      if (label) locations.push(label);
      continue;
    }
    if (!isRecord(entry)) continue;

    const address = isRecord(entry.address) ? entry.address : {};
    const addressLabel = joinLocationParts([
      address.streetAddress,
      address.addressLocality,
      address.addressRegion,
      address.postalCode,
      address.addressCountry,
    ]);
    const label = addressLabel || readName(entry.name) || (
      typeof entry.address === 'string' ? entry.address.trim() : ''
    );
    if (label) locations.push(label);
  }

  return normalizeOpportunityJobDetails({ locations }).locations;
}

export function normalizeWorkplaceType(value: unknown): WorkplaceType | '' {
  const raw = readName(value);
  const normalized = raw.toUpperCase().replace(/[\s_-]+/gu, '');
  if (['REMOTE', 'TELECOMMUTE', 'WORKFROMHOME'].includes(normalized)) return 'Remote';
  if (normalized === 'HYBRID') return 'Hybrid';
  if (['ONSITE', 'INPERSON', 'OFFICE'].includes(normalized)) return 'On-site';
  return '';
}

export function normalizeEmploymentType(value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  const labels: Record<string, string> = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACTOR: 'Contractor',
    CONTRACT: 'Contract',
    TEMPORARY: 'Temporary',
    INTERN: 'Internship',
    INTERNSHIP: 'Internship',
    VOLUNTEER: 'Volunteer',
    PER_DIEM: 'Per diem',
    OTHER: 'Other',
  };
  const normalized = values
    .map(readName)
    .filter(Boolean)
    .map((raw) => {
      const key = raw
        .replace(/([a-z])([A-Z])/gu, '$1_$2')
        .toUpperCase()
        .replace(/[\s-]+/gu, '_');
      return labels[key] ?? raw.slice(0, 80);
    });
  return [...new Set(normalized)].join(', ').slice(0, 80);
}

export function normalizePostedDate(value: unknown): string {
  const raw = readName(value);
  if (!raw) return '';
  const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/u.exec(raw);
  const date = match?.[1] ?? '';
  return isValidISODate(date) ? date : '';
}

function amountString(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim();
}

export function normalizeCompensationInterval(value: unknown, unitCode?: unknown): CompensationInterval | '' {
  const raw = (typeof value === 'string' ? value : typeof unitCode === 'string' ? unitCode : '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
  const normalizedValue = raw.replace(/^per/u, '').replace(/^1(?=hour|day|week|month|year)/u, '');
  const map: Record<string, CompensationInterval> = {
    hour: 'hour',
    hourly: 'hour',
    hur: 'hour',
    day: 'day',
    daily: 'day',
    d: 'day',
    week: 'week',
    weekly: 'week',
    w: 'week',
    month: 'month',
    monthly: 'month',
    mon: 'month',
    year: 'year',
    yearly: 'year',
    annual: 'year',
    ann: 'year',
    peryearsalary: 'year',
    yearsalary: 'year',
    onetime: 'one-time',
  };
  return map[normalizedValue] ?? map[raw] ?? '';
}

export function normalizeCompensationDetails(
  minValue: unknown,
  maxValue: unknown,
  currencyValue: unknown,
  intervalValue: unknown,
  unitCode?: unknown,
): CompensationDetails | null {
  const currency = typeof currencyValue === 'string' ? currencyValue.trim().toUpperCase() : '';
  const details = {
    minAmount: amountString(minValue),
    maxAmount: amountString(maxValue),
    currency,
    interval: normalizeCompensationInterval(intervalValue, unitCode),
  };
  return normalizeOpportunityJobDetails({ compensationDetails: details }).compensationDetails;
}

function structuredCompensation(value: unknown): CaptureStructuredFields['compensationDetails'] {
  const salary = first(value);
  if (!isRecord(salary)) return null;

  const amount = first(salary.value);
  const amountRecord = isRecord(amount) ? amount : {};
  const exactAmount = !isRecord(amount) ? amountString(amount) : '';
  const minAmount = amountString(amountRecord.minValue ?? salary.minValue) || exactAmount;
  const maxAmount = amountString(amountRecord.maxValue ?? salary.maxValue) || exactAmount;
  if (!minAmount && !maxAmount) return null;

  const rawCurrency = typeof salary.currency === 'string' ? salary.currency.trim().toUpperCase() : '';
  const unitText = isRecord(amount) ? amountRecord.unitText : undefined;
  const unitCode = isRecord(amount) ? amountRecord.unitCode : undefined;

  return {
    minAmount,
    maxAmount,
    currency: rawCurrency,
    interval: normalizeCompensationInterval(unitText, unitCode || salary.unitText),
  };
}

/** Reads only explicit Schema.org JobPosting fields; never derives values from prose. */
export function extractStructuredJobPostingFields(
  posting: RecordValue,
): CaptureStructuredFields {
  const normalized = normalizeOpportunityJobDetails({
    locations: normalizeLocationValues(posting.jobLocation),
    department: readName(posting.department),
    team: readName(posting.team),
    workplaceType: normalizeWorkplaceType(posting.jobLocationType),
    employmentType: normalizeEmploymentType(posting.employmentType),
    postedDate: normalizePostedDate(posting.datePosted),
    compensationDetails: structuredCompensation(posting.baseSalary),
  });

  const {
    repaired: _repaired,
    ...fields
  } = normalized;
  return fields;
}

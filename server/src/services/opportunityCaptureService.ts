import { SaxesParser } from 'saxes';
import {
  EMPTY_CAPTURE_STRUCTURED_FIELDS,
  normalizeOpportunityJobDetails,
  type CaptureFieldEvidenceMap,
  type CaptureFieldSource,
  type CaptureStructuredFields,
} from '@launchboard/domain';
import {
  CaptureFetchError,
  fetchPublicCaptureJson,
  fetchPublicCapturePage,
  fetchPublicCaptureXml,
} from './captureHttpClient.js';
import {
  parseCaptureMetadata,
  sanitizeCaptureDescription,
  type CaptureMetadata,
} from './captureMetadataParser.js';
import { parseCaptureTarget } from './captureUrlSafety.js';
import {
  normalizeCompensationDetails,
  normalizeEmploymentType,
  normalizeLocationValues,
  normalizePostedDate,
  normalizeWorkplaceType,
  extractStructuredJobPostingFields,
} from './captureStructuredFields.js';

export type CapturePreviewFailure = 'blocked' | 'not-found' | 'timeout' | 'too-large' | 'unavailable' | 'unsupported';

export type OpportunityCapturePreview =
  | CaptureMetadata
  | CaptureStructuredFields & {
      outcome: CapturePreviewFailure;
      source: 'none';
      title: '';
      company: '';
      description: '';
      compensation: '';
      fieldEvidence: CaptureFieldEvidenceMap;
    };

export type OpportunityCapturePreviewService = (
  url: string,
) => Promise<OpportunityCapturePreview>;

export interface CaptureJsonFetchOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
}

export type CaptureJsonFetcher = (
  url: string,
  options?: CaptureJsonFetchOptions,
) => Promise<unknown>;

export type CaptureHtmlFetcher = (
  url: string,
) => Promise<{ html: string; finalUrl: string }>;

export type CaptureXmlFetcher = (url: string) => Promise<string>;

export interface OpportunityCaptureDependencies {
  fetchJson?: CaptureJsonFetcher;
  fetchHtml?: CaptureHtmlFetcher;
  fetchXml?: CaptureXmlFetcher;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function centsToDecimalAmount(value: unknown): string {
  const cents = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const whole = Math.floor(cents / 100);
  const remainder = cents % 100;
  if (remainder === 0) return String(whole);
  return String(whole) + '.' + String(remainder).padStart(2, '0').replace(/0+$/u, '');
}

function providerSalaryRows(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function ashbySalaryDetails(value: unknown): CaptureStructuredFields['compensationDetails'] {
  const compensation = readRecord(value);
  const tiers = providerSalaryRows(compensation.compensationTiers);
  const components = tiers.flatMap((tier) => providerSalaryRows(tier.components))
    .filter((component) => readString(component.compensationType).toLowerCase() === 'salary')
    .filter((component) => component.minValue !== null || component.maxValue !== null);
  if (components.length === 0) return null;

  const normalized = components.map((component) => normalizeCompensationDetails(
    component.minValue,
    component.maxValue,
    component.currencyCode,
    component.interval,
  ));
  if (normalized.some((entry) => entry === null)) return null;

  const first = normalized[0];
  if (!first) return null;
  const signature = JSON.stringify(first);
  if (normalized.some((entry) => JSON.stringify(entry) !== signature)) return null;
  return first;
}

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded === '.' || decoded === '..') {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function readCompany(value: unknown): string {
  const company = readString(value);
  const genericValues = new Set(['company', 'company name', 'employer', 'unknown', 'unknown company', 'n/a', 'not provided']);
  return genericValues.has(company.toLowerCase()) ? '' : company.slice(0, 160);
}

interface CaptureMetadataOptions {
  structuredFields?: Partial<CaptureStructuredFields>;
  evidenceSource?: CaptureFieldSource;
  evidenceConfidence?: 'high' | 'medium' | 'low';
  evidenceLabel?: string;
  compensationText?: string;
}

function createMetadata(
  titleValue: unknown,
  companyValue: unknown,
  descriptionValue: unknown,
  source: CaptureMetadata['source'] = 'job-posting',
  options: CaptureMetadataOptions = {},
): CaptureMetadata | null {
  const title = readString(titleValue).slice(0, 240);
  const company = readCompany(companyValue);
  const description = sanitizeCaptureDescription(descriptionValue);
  const compensation = readString(options.compensationText).slice(0, 160);
  const normalized = normalizeOpportunityJobDetails({
    ...EMPTY_CAPTURE_STRUCTURED_FIELDS,
    ...options.structuredFields,
  });
  const {
    repaired: _repaired,
    ...structuredFields
  } = normalized;
  const hasStructuredFields = Boolean(
    structuredFields.locations.length ||
    structuredFields.department ||
    structuredFields.team ||
    structuredFields.workplaceType ||
    structuredFields.employmentType ||
    structuredFields.postedDate ||
    structuredFields.compensationDetails,
  );
  if (!title && !company && !description && !compensation && !hasStructuredFields) return null;

  const evidenceSource = options.evidenceSource ?? 'provider-api';
  const confidence = options.evidenceConfidence ?? 'high';
  const label = options.evidenceLabel ?? 'Validated public posting record';
  const fieldEvidence: CaptureFieldEvidenceMap = {};
  const addEvidence = (field: keyof CaptureFieldEvidenceMap, value: unknown): void => {
    const present = Array.isArray(value)
      ? value.length > 0
      : typeof value === 'string'
        ? value.trim().length > 0
        : value !== null && value !== undefined;
    if (present) fieldEvidence[field] = { source: evidenceSource, confidence, label };
  };

  addEvidence('title', title);
  addEvidence('company', company);
  addEvidence('description', description);
  addEvidence('compensation', compensation);
  for (const field of [
    'locations',
    'department',
    'team',
    'workplaceType',
    'employmentType',
    'postedDate',
    'compensationDetails',
  ] as const) {
    addEvidence(field, structuredFields[field]);
  }

  return {
    ...structuredFields,
    outcome: title && company ? 'ready' : 'partial',
    source,
    title,
    company,
    description,
    compensation,
    fieldEvidence,
  };
}

function sameJobPath(candidateUrl: unknown, requestedUrl: URL): boolean {
  const candidate = readString(candidateUrl);
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    const candidatePath = parsed.pathname.endsWith('/') ? parsed.pathname.slice(0, -1) : parsed.pathname;
    const requestedPath = requestedUrl.pathname.endsWith('/') ? requestedUrl.pathname.slice(0, -1) : requestedUrl.pathname;
    return parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === requestedUrl.hostname.toLowerCase() &&
      candidatePath === requestedPath;
  } catch {
    return false;
  }
}

/**
 * Greenhouse publishes an official unauthenticated public Job Board API. The
 * endpoint returns exact posting IDs, employer names and full HTML content.
 * Only fixed API hosts and the exact numeric posting ID from the supplied URL
 * are accepted; no board listings are crawled.
 */
async function previewGreenhouse(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[1]?.toLowerCase() !== 'jobs') return null;

  const board = decodePathSegment(segments[0] ?? '');
  const jobId = decodePathSegment(segments[2] ?? '');
  if (
    !board ||
    !jobId ||
    !/^[a-z0-9_-]{1,100}$/iu.test(board) ||
    !/^\d{3,20}$/u.test(jobId)
  ) return null;

  const endpoint = new URL(
    '/v1/boards/' + encodeURIComponent(board) + '/jobs/' + jobId + '?pay_transparency=true',
    'https://boards-api.greenhouse.io',
  ).toString();
  const payload = readRecord(await fetchJson(endpoint));
  if (String(payload.id ?? '') !== jobId) return null;

  const location = readRecord(payload.location);
  const departments = providerSalaryRows(payload.departments);
  const offices = providerSalaryRows(payload.offices);
  const payRanges = providerSalaryRows(payload.pay_input_ranges);
  const firstPayRange = payRanges.length === 1 ? payRanges[0] : undefined;
  const structuredFields: Partial<CaptureStructuredFields> = {
    locations: normalizeLocationValues([
      location.name,
      ...offices.map((office) => office.location || office.name),
    ]),
    department: departments.length === 1 ? readString(departments[0]?.name) : '',
    postedDate: normalizePostedDate(payload.first_published),
    compensationDetails: firstPayRange
      ? normalizeCompensationDetails(
          centsToDecimalAmount(firstPayRange.min_cents),
          centsToDecimalAmount(firstPayRange.max_cents),
          firstPayRange.currency_type,
          '',
        )
      : null,
  };

  return createMetadata(
    payload.title,
    payload.company_name,
    payload.content,
    'job-posting',
    {
      structuredFields,
      evidenceSource: 'provider-api',
      evidenceConfidence: 'high',
      evidenceLabel: 'Greenhouse Job Board API',
    },
  );
}

/**
 * Ashby's documented public job-board endpoint returns the canonical posting
 * URL, title and description. It does not reliably provide the employer name,
 * so this adapter deliberately leaves company blank rather than guessing it
 * from the board slug.
 */
async function previewAshby(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const board = decodePathSegment(segments[0] ?? '');
  const jobId = decodePathSegment(segments[1] ?? '');
  if (
    !board ||
    !jobId ||
    !/^[a-z0-9 _-]{1,100}$/iu.test(board) ||
    !/^[a-z0-9-]{8,100}$/iu.test(jobId)
  ) return null;

  const endpoint = new URL(
    '/posting-api/job-board/' + encodeURIComponent(board) + '?includeCompensation=true',
    'https://api.ashbyhq.com',
  ).toString();
  const payload = readRecord(await fetchJson(endpoint));
  if (!Array.isArray(payload.jobs)) return null;

  const selected = payload.jobs
    .filter(isRecord)
    .find((job) => (
      sameJobPath(job.jobUrl, inputUrl) &&
      job.isListed !== false
    ));
  if (!selected) return null;

  const primaryAddress = readRecord(readRecord(selected.address).postalAddress);
  const secondaryLocations = providerSalaryRows(selected.secondaryLocations).map((entry) => {
    const address = readRecord(entry.address);
    return readString(entry.location) || normalizeLocationValues([address])[0] || '';
  });
  const locations = normalizeLocationValues([
    selected.location,
    ...secondaryLocations,
  ]);
  const compensation = readRecord(selected.compensation);
  const scrapeableSalarySummary = readString(compensation.scrapeableCompensationSalarySummary);
  const description = readString(selected.descriptionPlain) || selected.descriptionHtml;

  return createMetadata(
    selected.title,
    '',
    description,
    'job-posting',
    {
      structuredFields: {
        locations: locations.length ? locations : normalizeLocationValues([primaryAddress]),
        department: readString(selected.department),
        team: readString(selected.team),
        workplaceType: normalizeWorkplaceType(selected.workplaceType),
        employmentType: normalizeEmploymentType(selected.employmentType),
        postedDate: normalizePostedDate(selected.publishedAt),
        compensationDetails: ashbySalaryDetails(compensation),
      },
      compensationText: scrapeableSalarySummary,
      evidenceSource: 'provider-api',
      evidenceConfidence: 'high',
      evidenceLabel: 'Ashby Public Job Postings API',
    },
  );
}

/**
 * Workable's public careers widget exposes the public posting list with details
 * when details=true. This is a public-facing but undocumented endpoint, so the
 * request and response stay strictly bounded and exact-shortcode matched.
 */
async function previewWorkable(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 3 || segments[1]?.toLowerCase() !== 'j') return null;

  const account = decodePathSegment(segments[0] ?? '');
  const shortcode = decodePathSegment(segments[2] ?? '');
  if (
    !account ||
    !shortcode ||
    !/^[a-z0-9-]{1,100}$/iu.test(account) ||
    !/^[a-z0-9]{5,40}$/iu.test(shortcode)
  ) return null;

  const endpoint = new URL(
    '/api/v1/widget/accounts/' + encodeURIComponent(account) + '?details=true',
    'https://apply.workable.com',
  ).toString();
  const payload = readRecord(await fetchJson(endpoint));
  if (!Array.isArray(payload.jobs)) return null;

  const selected = payload.jobs
    .filter(isRecord)
    .find((job) => readString(job.shortcode).toLowerCase() === shortcode.toLowerCase());
  if (!selected) return null;

  const location = [
    selected.city,
    selected.state,
    selected.country,
  ].map(readString).filter(Boolean).join(', ');
  const workplaceValue = selected.workplace_type ||
    (selected.telecommuting === true ? 'Remote' : '');
  return createMetadata(
    selected.title,
    payload.name,
    selected.description,
    'job-posting',
    {
      structuredFields: {
        locations: normalizeLocationValues([location]),
        department: readString(selected.department),
        workplaceType: normalizeWorkplaceType(workplaceValue),
        employmentType: normalizeEmploymentType(selected.employment_type),
        postedDate: normalizePostedDate(selected.published_on),
      },
      evidenceSource: 'provider-api',
      evidenceConfidence: 'medium',
      evidenceLabel: 'Workable public careers feed',
    },
  );
}

/**
 * Lever documents a public Postings API for published job listings. The API
 * supports exact single-posting lookup on both global and EU instances. Its
 * hostedUrl and ID must both match the submitted job; employer is not inferred
 * from the board slug because the public posting response does not carry a
 * trustworthy employer name.
 */
async function previewLever(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const host = inputUrl.hostname.toLowerCase();
  if (host !== 'jobs.lever.co' && host !== 'jobs.eu.lever.co') return null;

  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const site = decodePathSegment(segments[0] ?? '');
  const postingId = decodePathSegment(segments[1] ?? '');
  if (
    !site ||
    !postingId ||
    !/^[a-z0-9_-]{1,100}$/iu.test(site) ||
    !/^[a-z0-9-]{8,100}$/iu.test(postingId)
  ) return null;

  const apiOrigin = host === 'jobs.eu.lever.co'
    ? 'https://api.eu.lever.co'
    : 'https://api.lever.co';
  const endpoint = new URL(
    '/v0/postings/' + encodeURIComponent(site) + '/' +
      encodeURIComponent(postingId) + '?mode=json',
    apiOrigin,
  ).toString();
  const payload = readRecord(await fetchJson(endpoint));
  if (
    readString(payload.id) !== postingId ||
    !sameJobPath(payload.hostedUrl, inputUrl)
  ) return null;

  const categories = readRecord(payload.categories);
  const salaryRange = readRecord(payload.salaryRange);
  const allLocations = normalizeLocationValues(categories.allLocations);
  const locations = allLocations.length
    ? allLocations
    : normalizeLocationValues([categories.location]);
  const salaryMin = salaryRange.min;
  const salaryMax = salaryRange.max;

  return createMetadata(
    payload.text,
    '',
    readString(payload.descriptionPlain) || payload.description,
    'job-posting',
    {
      structuredFields: {
        locations,
        department: readString(categories.department),
        team: readString(categories.team),
        workplaceType: normalizeWorkplaceType(payload.workplaceType),
        compensationDetails: normalizeCompensationDetails(
          salaryMin,
          salaryMax,
          salaryRange.currency,
          salaryRange.interval,
        ),
      },
      compensationText: readString(payload.salaryDescriptionPlain) ||
        sanitizeCaptureDescription(payload.salaryDescription),
      evidenceSource: 'provider-api',
      evidenceConfidence: 'high',
      evidenceLabel: 'Lever Public Postings API',
    },
  );
}

/**
 * SmartRecruiters has a documented public Posting API. The URL's company
 * identifier and numeric posting ID are extracted and validated before the
 * request is sent to the fixed API origin.
 */
async function previewSmartRecruiters(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const companyIdentifier = decodePathSegment(segments[0] ?? '');
  const postingSegment = decodePathSegment(segments[1] ?? '');
  if (!companyIdentifier || !postingSegment || !/^[a-z0-9_-]{1,100}$/iu.test(companyIdentifier)) {
    return null;
  }

  const idMatch = /^(\d{6,20})(?:-|$)/u.exec(postingSegment);
  if (!idMatch?.[1]) return null;

  const endpoint = new URL(
    '/v1/companies/' + encodeURIComponent(companyIdentifier) +
      '/postings/' + idMatch[1],
    'https://api.smartrecruiters.com',
  ).toString();
  const payload = readRecord(await fetchJson(endpoint));
  const company = readRecord(payload.company);
  const jobAd = readRecord(payload.jobAd);
  const sections = readRecord(jobAd.sections);
  const descriptionSection = readRecord(sections.jobDescription);

  return createMetadata(
    payload.name,
    company.name,
    descriptionSection.text,
  );
}

interface WorkdayRoute {
  tenant: string;
  site: string;
  externalPath: string;
  searchText: string;
}

/**
 * Extracts only the tenant and site from the public Workday career URL. The
 * eventual CXS request remains on that exact validated Workday hostname.
 */
function parseWorkdayRoute(inputUrl: URL): WorkdayRoute | null {
  const hostMatch = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/iu.exec(inputUrl.hostname);
  if (!hostMatch?.[1]) return null;

  const rawSegments = inputUrl.pathname.split('/').filter(Boolean);
  if (rawSegments.length < 4) return null;

  const first = decodePathSegment(rawSegments[0] ?? '');
  const siteIndex = first && /^[a-z]{2}-[a-z]{2}$/iu.test(first) ? 1 : 0;
  const siteRaw = rawSegments[siteIndex];
  const site = siteRaw ? decodePathSegment(siteRaw) : null;
  if (!site || !/^[a-z0-9_-]{1,100}$/iu.test(site)) return null;

  const jobSegment = decodePathSegment(rawSegments[siteIndex + 1] ?? '');
  if (jobSegment !== 'job') return null;

  const externalSegments = rawSegments.slice(siteIndex + 1);
  if (externalSegments.length < 3) return null;
  const externalPath = '/' + externalSegments.join('/');

  const finalSlug = decodePathSegment(externalSegments.at(-1) ?? '');
  if (!finalSlug) return null;
  const roleSlug = finalSlug.replace(/_[A-Z]{1,8}\d[\w-]*$/iu, '');
  const searchText = roleSlug.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (searchText.length < 3 || searchText.length > 160) return null;

  return {
    tenant: hostMatch[1],
    site,
    externalPath,
    searchText,
  };
}

function exactWorkdayExternalPath(
  value: unknown,
  origin: string,
  requestedPath: string,
): string | null {
  const externalPath = readString(value);
  if (!externalPath || !externalPath.startsWith('/job/')) return null;
  try {
    const parsed = new URL(externalPath, origin);
    if (
      parsed.origin !== origin ||
      parsed.pathname !== externalPath ||
      parsed.pathname !== requestedPath
    ) return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

/**
 * Workday public career pages frequently return only an empty HTML shell.
 * Their public CXS service supplies the same structured job data used by the
 * careers UI. It is not a published third-party integration contract, so each
 * result is matched to the exact original /job path and failed closed otherwise.
 */
async function previewWorkday(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const route = parseWorkdayRoute(inputUrl);
  if (!route) return null;

  const cxsRoot = '/wday/cxs/' +
    encodeURIComponent(route.tenant) + '/' +
    encodeURIComponent(route.site);
  const listEndpoint = new URL(cxsRoot + '/jobs', inputUrl.origin).toString();
  const listPayload = readRecord(await fetchJson(listEndpoint, {
    method: 'POST',
    body: {
      appliedFacets: {},
      limit: 20,
      offset: 0,
      searchText: route.searchText,
    },
  }));

  if (!Array.isArray(listPayload.jobPostings)) return null;
  const posting = listPayload.jobPostings
    .filter(isRecord)
    .find((candidate) => exactWorkdayExternalPath(
      candidate.externalPath,
      inputUrl.origin,
      route.externalPath,
    ));
  if (!posting) return null;

  const detailEndpoint = new URL(
    cxsRoot + route.externalPath,
    inputUrl.origin,
  ).toString();
  const detailPayload = readRecord(await fetchJson(detailEndpoint));
  const info = readRecord(detailPayload.jobPostingInfo);
  const organization = readRecord(
    detailPayload.hiringOrganization ?? info.hiringOrganization,
  );

  return createMetadata(
    info.title || posting.title,
    organization.name,
    info.jobDescription,
  );
}

function mergeIncompleteCaptureMetadata(
  primary: CaptureMetadata,
  fallback: CaptureMetadata,
): CaptureMetadata {
  // Keep exact-ID provider data. An ambiguous generic page must never inject
  // fields from one of several possible postings into this result.
  if (fallback.outcome === 'ambiguous') return primary;

  const title = primary.title || fallback.title;
  const company = primary.company || fallback.company;
  const description = fallback.description.length > primary.description.length
    ? fallback.description
    : primary.description || fallback.description;
  const locations = primary.locations.length ? primary.locations : fallback.locations;
  const department = primary.department || fallback.department;
  const team = primary.team || fallback.team;
  const workplaceType = primary.workplaceType || fallback.workplaceType;
  const employmentType = primary.employmentType || fallback.employmentType;
  const postedDate = primary.postedDate || fallback.postedDate;
  const compensationDetails = primary.compensationDetails || fallback.compensationDetails;
  const compensation = primary.compensation || fallback.compensation;
  const descriptionEvidence = fallback.description.length > primary.description.length
    ? fallback.fieldEvidence.description
    : primary.fieldEvidence.description || fallback.fieldEvidence.description;
  const fieldEvidence: CaptureFieldEvidenceMap = {
    ...fallback.fieldEvidence,
    ...primary.fieldEvidence,
    ...(descriptionEvidence ? { description: descriptionEvidence } : {}),
  };
  const hasStructuredFields = Boolean(
    locations.length || department || team || workplaceType ||
    employmentType || postedDate || compensationDetails || compensation,
  );
  const hasMetadata = Boolean(title || company || description || hasStructuredFields);

  return {
    outcome: !hasMetadata ? 'unsupported' : title && company ? 'ready' : 'partial',
    source: primary.source === 'job-posting' || fallback.source === 'job-posting' || hasStructuredFields
      ? 'job-posting'
      : fallback.source !== 'none' ? fallback.source : primary.source,
    title,
    company,
    description,
    locations,
    department,
    team,
    workplaceType,
    employmentType,
    postedDate,
    compensationDetails,
    compensation,
    fieldEvidence,
  };
}

function emptyFailure(outcome: CapturePreviewFailure): OpportunityCapturePreview {
  return {
    ...EMPTY_CAPTURE_STRUCTURED_FIELDS,
    outcome,
    source: 'none',
    title: '',
    company: '',
    description: '',
    compensation: '',
    fieldEvidence: {},
  };
}

function isLinkedInHost(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
}

function isExpiredJobBoardRedirect(requestedUrl: URL, finalUrl: string): boolean {
  try {
    const final = new URL(finalUrl);
    const requestedSegments = requestedUrl.pathname.split('/').filter(Boolean);
    const finalSegments = final.pathname.split('/').filter(Boolean);
    const requestedJobIndex = requestedSegments.findIndex((segment) => segment.toLowerCase() === 'jobs');
    const hasJobId = requestedJobIndex >= 0 && Boolean(requestedSegments[requestedJobIndex + 1]);
    const finalHasJobId = finalSegments.some((segment, index) =>
      segment.toLowerCase() === 'jobs' && Boolean(finalSegments[index + 1]),
    );
    return hasJobId &&
      !finalHasJobId &&
      final.hostname.toLowerCase() === requestedUrl.hostname.toLowerCase() &&
      final.searchParams.get('error') === 'true';
  } catch {
    return false;
  }
}

/**
 * BambooHR's documented API requires authentication. Its public careers pages
 * expose same-origin list and detail JSON routes. The list verifies that the
 * requested numeric posting ID is currently published; the detail response
 * must then identify the exact original career URL before any fields are used.
 */
function parseBambooHrPostingId(inputUrl: URL): string | null {
  if (!/^[a-z0-9-]+\.bamboohr\.com$/iu.test(inputUrl.hostname)) return null;
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (
    segments.length !== 2 ||
    segments[0]?.toLowerCase() !== 'careers'
  ) return null;
  const postingId = decodePathSegment(segments[1] ?? '');
  return postingId && /^\d{1,20}$/u.test(postingId) ? postingId : null;
}

async function previewBambooHr(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const postingId = parseBambooHrPostingId(inputUrl);
  if (!postingId) return null;

  const listUrl = new URL('/careers/list', inputUrl.origin);
  const listPayload = readRecord(await fetchJson(listUrl.toString()));
  if (!Array.isArray(listPayload.result)) return null;

  const listing = listPayload.result
    .filter(isRecord)
    .find((candidate) => readString(candidate.id) === postingId);
  if (!listing) return null;

  const detailUrl = new URL(
    '/careers/' + encodeURIComponent(postingId) + '/detail',
    inputUrl.origin,
  );
  const detailPayload = readRecord(await fetchJson(detailUrl.toString()));
  const detailResult = readRecord(detailPayload.result);
  const jobOpening = readRecord(detailResult.jobOpening);
  if (!sameOriginPath(jobOpening.jobOpeningShareUrl, inputUrl)) return null;

  const status = readString(jobOpening.jobOpeningStatus);
  if (status && status.toLowerCase() !== 'open') return null;

  const title = readString(jobOpening.jobOpeningName);
  const listingTitle = readString(listing.jobOpeningName);
  if (
    !title ||
    (listingTitle && listingTitle.toLowerCase() !== title.toLowerCase())
  ) return null;

  // The public detail JSON does not expose an employer field. A BambooHR
  // hosted job page may provide its tenant's explicit og:site_name; this is
  // handled only by the exact-provider HTML parser opt-in, never from the slug.
  return createMetadata(title, '', jobOpening.description);
}

/**
 * Teamtailor's account API requires an employer-issued key. Public career sites
 * instead advertise a same-origin JSON Feed through /.well-known/api-catalog.
 * Teamtailor also documents a public RSS feed; the advertised JSON Feed is a
 * machine-readable route that carries the same public postings and JobPosting
 * data. Only follow the feed when the current tenant advertises it explicitly.
 */
function sameOriginPath(candidateUrl: unknown, expectedUrl: URL): boolean {
  const candidate = readString(candidateUrl);
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    const normalizePath = (path: string) =>
      path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    return parsed.protocol === 'https:' &&
      parsed.origin === expectedUrl.origin &&
      normalizePath(parsed.pathname) === normalizePath(expectedUrl.pathname);
  } catch {
    return false;
  }
}

interface PersonioFeedPosting {
  id: string;
  title: string;
  subcompany: string;
  office: string;
  department: string;
  recruitingCategory: string;
  employmentType: string;
  schedule: string;
  descriptions: string[];
}

function parsePersonioFeed(xml: string): PersonioFeedPosting[] {
  if (
    Buffer.byteLength(xml, 'utf8') > 2 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/iu.test(xml)
  ) throw new Error('Unsupported Personio XML feed.');

  const parser = new SaxesParser({ position: false });
  const stack: string[] = [];
  const postings: PersonioFeedPosting[] = [];
  let posting: PersonioFeedPosting | null = null;
  let postingDepth = -1;
  let field: {
    tag: string;
    target: 'id' | 'title' | 'subcompany' | 'office' | 'department' | 'recruitingCategory' | 'employmentType' | 'schedule' | 'description';
    value: string;
  } | null = null;
  let nodeCount = 0;
  let capturedCharacters = 0;
  let rootSeen = false;

  const append = (chunk: string): void => {
    if (!field || !posting) return;
    capturedCharacters += chunk.length;
    if (capturedCharacters > 1_000_000 || field.value.length + chunk.length > 160_000) {
      throw parser.makeError('Personio feed extraction limit exceeded.');
    }
    field.value += chunk;
  };

  const finishField = (): void => {
    if (!field || !posting) return;
    const value = field.value.trim();
    if (field.target === 'id') posting.id = value.slice(0, 32);
    else if (field.target === 'title') posting.title = value.slice(0, 500);
    else if (field.target === 'subcompany') posting.subcompany = value.slice(0, 500);
    else if (field.target === 'office') posting.office = value.slice(0, 500);
    else if (field.target === 'department') posting.department = value.slice(0, 500);
    else if (field.target === 'recruitingCategory') posting.recruitingCategory = value.slice(0, 500);
    else if (field.target === 'employmentType') posting.employmentType = value.slice(0, 100);
    else if (field.target === 'schedule') posting.schedule = value.slice(0, 100);
    else if (value) posting.descriptions.push(value);
    field = null;
  };

  parser.on('opentag', (tag) => {
    nodeCount += 1;
    if (nodeCount > 30_000) throw parser.makeError('Personio feed node limit exceeded.');

    const name = tag.name.toLowerCase();
    if (!rootSeen) {
      rootSeen = true;
      if (name !== 'workzag-jobs') throw parser.makeError('Unexpected Personio feed root.');
    }

    if (name === 'position' && posting === null) {
      posting = {
        id: '',
        title: '',
        subcompany: '',
        office: '',
        department: '',
        recruitingCategory: '',
        employmentType: '',
        schedule: '',
        descriptions: [],
      };
      postingDepth = stack.length;
    } else if (posting && stack.length === postingDepth + 1) {
      const targets = new Set([
        'id',
        'name',
        'subcompany',
        'office',
        'department',
        'recruitingcategory',
        'employmenttype',
        'schedule',
      ]);
      if (targets.has(name)) {
        const target = name === 'name'
          ? 'title'
          : name === 'recruitingcategory'
            ? 'recruitingCategory'
            : name === 'employmenttype'
              ? 'employmentType'
              : name as 'id' | 'subcompany' | 'office' | 'department' | 'schedule';
        field = { tag: name, target, value: '' };
      }
    } else if (
      posting &&
      name === 'value' &&
      stack.at(-1) === 'jobdescription'
    ) {
      field = { tag: name, target: 'description', value: '' };
    }

    stack.push(name);
  });

  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('doctype', () => {
    throw parser.makeError('Personio feed document types are not supported.');
  });
  parser.on('closetag', (tag) => {
    const name = tag.name.toLowerCase();
    if (stack.at(-1) !== name) throw parser.makeError('Malformed Personio feed structure.');

    if (field?.tag === name) finishField();

    if (name === 'position' && posting && stack.length === postingDepth + 1) {
      if (postings.length >= 10_000) {
        throw parser.makeError('Personio feed posting limit exceeded.');
      }
      postings.push(posting);
      posting = null;
      postingDepth = -1;
    }

    stack.pop();
  });

  parser.write(xml).close();
  if (!rootSeen || posting !== null || stack.length !== 0) {
    throw new Error('Incomplete Personio XML feed.');
  }
  return postings;
}

function parsePersonioPostingId(inputUrl: URL): string | null {
  if (!/^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/iu.test(inputUrl.hostname)) return null;
  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== 'job') return null;
  const id = decodePathSegment(segments[1] ?? '');
  return id && /^\d{1,20}$/u.test(id) ? id : null;
}

async function previewPersonio(
  inputUrl: URL,
  fetchXml: CaptureXmlFetcher,
): Promise<CaptureMetadata | null> {
  const postingId = parsePersonioPostingId(inputUrl);
  if (!postingId) return null;

  const requestedLanguage = (inputUrl.searchParams.get('language') ?? 'en').toLowerCase();
  const supportedLanguages = new Set(['de', 'en', 'fr', 'es', 'nl', 'it', 'pt']);
  const language = supportedLanguages.has(requestedLanguage) ? requestedLanguage : 'en';
  const feedUrl = new URL('/xml', inputUrl.origin);
  feedUrl.searchParams.set('language', language);

  const postings = parsePersonioFeed(await fetchXml(feedUrl.toString()));
  const matches = postings.filter((candidate) => candidate.id === postingId);
  if (matches.length !== 1) return null;

  const matched = matches[0];
  if (!matched?.title) return null;
  const description = matched.descriptions.join(' ');
  const metadata = createMetadata(
    matched.title,
    matched.subcompany,
    description,
    'job-posting',
    {
      structuredFields: {
        locations: normalizeLocationValues([matched.office]),
        department: matched.department,
        team: matched.recruitingCategory,
        employmentType: normalizeEmploymentType(matched.schedule) ||
          normalizeEmploymentType(matched.employmentType),
      },
      evidenceSource: 'provider-api',
      evidenceConfidence: 'high',
      evidenceLabel: 'Personio XML Jobs Feed',
    },
  );
  if (!metadata) return null;

  // Some tenants omit descriptions from the selected-language feed. Keep
  // the provider result partial so the exact job page can supply its sections.
  return metadata.description
    ? metadata
    : { ...metadata, outcome: 'partial' };
}

async function previewTeamtailor(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  if (!inputUrl.hostname.toLowerCase().endsWith('.teamtailor.com')) return null;

  const segments = inputUrl.pathname.split('/').filter(Boolean);
  const jobsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'jobs');
  if (
    jobsIndex < 0 ||
    jobsIndex !== segments.length - 2 ||
    !decodePathSegment(segments[jobsIndex + 1] ?? '')
  ) return null;

  const jobsPage = new URL('/jobs', inputUrl.origin);
  const catalogUrl = new URL('/.well-known/api-catalog', inputUrl.origin);
  const catalog = readRecord(await fetchJson(catalogUrl.toString()));
  if (!Array.isArray(catalog.linkset)) return null;

  const jobLinkSet = catalog.linkset
    .filter(isRecord)
    .find((entry) => sameOriginPath(entry.anchor, jobsPage));
  if (!jobLinkSet || !Array.isArray(jobLinkSet['service-desc'])) return null;

  const advertisedFeed = jobLinkSet['service-desc']
    .filter(isRecord)
    .find((entry) => readString(entry.type).toLowerCase() === 'application/feed+json');
  const feedHref = readString(advertisedFeed?.href);
  if (!feedHref) return null;

  const feedUrl = new URL(feedHref, inputUrl.origin);
  const expectedFeedUrl = new URL('/jobs.json', inputUrl.origin);
  if (
    feedUrl.origin !== inputUrl.origin ||
    feedUrl.href !== expectedFeedUrl.href
  ) return null;

  const feed = readRecord(await fetchJson(feedUrl.toString()));
  if (
    !sameOriginPath(feed.home_page_url, jobsPage) ||
    !sameOriginPath(feed.feed_url, expectedFeedUrl) ||
    !Array.isArray(feed.items)
  ) return null;

  // Teamtailor's documented public feeds default to 100 items. Quick Capture
  // inspects one page only; it never follows pagination or crawls the board.
  const posting = feed.items
    .slice(0, 100)
    .filter(isRecord)
    .find((item) => sameOriginPath(item.url, inputUrl));
  if (!posting) return null;

  const jobPosting = readRecord(posting._jobposting);
  const rawType = jobPosting['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  const isJobPosting = types.some((type) =>
    typeof type === 'string' &&
    (type === 'JobPosting' || type.endsWith('/JobPosting')),
  );
  if (!isJobPosting) return null;

  const hiringOrganization = readRecord(jobPosting.hiringOrganization);
  return createMetadata(
    jobPosting.title || posting.title,
    hiringOrganization.name,
    jobPosting.description || posting.content_html,
    'job-posting',
    {
      structuredFields: extractStructuredJobPostingFields(jobPosting),
      evidenceSource: 'job-posting-jsonld',
      evidenceConfidence: 'high',
      evidenceLabel: 'Teamtailor embedded Schema.org JobPosting',
    },
  );
}

/**
 * Breezy's documented v3 API is account-token based. Its public careers portal
 * also exposes an undocumented, unauthenticated /json listing feed. That feed
 * carries exact posting URLs, titles and the portal's explicit company name,
 * but not descriptions. Keep it best-effort: the bounded HTML/JobPosting parser
 * still fetches the exact page and supplies any available description.
 */
async function previewBreezy(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const host = inputUrl.hostname.toLowerCase();
  if (!host.endsWith('.breezy.hr')) return null;

  const segments = inputUrl.pathname.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0]?.toLowerCase() !== 'p') return null;

  const friendlyId = decodePathSegment(segments[1] ?? '');
  if (!friendlyId || !/^[a-z0-9-]{6,160}$/iu.test(friendlyId)) return null;
  const id = friendlyId.split('-', 1)[0] ?? '';
  if (!/^[a-f0-9]{6,32}$/iu.test(id)) return null;

  const feedUrl = new URL('/json', inputUrl.origin);
  const payload = await fetchJson(feedUrl.toString());
  if (!Array.isArray(payload)) return null;

  const posting = payload
    .filter(isRecord)
    .find((candidate) =>
      readString(candidate.id).toLowerCase() === id.toLowerCase() &&
      readString(candidate.friendly_id) === friendlyId &&
      sameOriginPath(candidate.url, inputUrl),
    );
  if (!posting) return null;

  const company = readRecord(posting.company);
  const metadata = createMetadata(posting.name, company.name, '');
  // The public feed does not contain the body. Force the normal same-page
  // parser to run even when title and employer are both present.
  return metadata ? { ...metadata, outcome: 'partial' } : null;
}

interface RipplingPostingRoute {
  slug: string;
  postingId: string;
  canonicalUrl: URL;
}

/**
 * Rippling's hosted public career pages use an anonymous ATS detail endpoint.
 * This is observed public-board behavior rather than a published third-party
 * contract, so the adapter accepts only the exact tenant slug, UUID and
 * canonical posting URL returned by the detail record. The endpoint is called
 * once for the submitted job only; it never enumerates or crawls the board.
 */
function parseRipplingPostingRoute(inputUrl: URL): RipplingPostingRoute | null {
  if (inputUrl.hostname.toLowerCase() !== 'ats.rippling.com') return null;

  const segments = inputUrl.pathname.split('/').filter(Boolean);
  const localePrefix = segments.length === 4 &&
    /^[a-z]{2}-[a-z]{2}$/iu.test(segments[0] ?? '');
  const offset = localePrefix ? 1 : 0;
  if (
    segments.length - offset !== 3 ||
    segments[offset + 1] !== 'jobs'
  ) return null;

  const slug = decodePathSegment(segments[offset] ?? '');
  const postingId = decodePathSegment(segments[offset + 2] ?? '');
  if (
    !slug ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/iu.test(slug) ||
    !postingId ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(postingId)
  ) return null;

  return {
    slug,
    postingId,
    canonicalUrl: new URL(
      '/' + encodeURIComponent(slug) + '/jobs/' + encodeURIComponent(postingId),
      'https://ats.rippling.com',
    ),
  };
}

async function previewRippling(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
): Promise<CaptureMetadata | null> {
  const route = parseRipplingPostingRoute(inputUrl);
  if (!route) return null;

  const endpoint = new URL(
    '/platform/api/ats/v1/board/' + encodeURIComponent(route.slug) +
      '/jobs/' + encodeURIComponent(route.postingId),
    'https://api.rippling.com',
  );
  const payload = readRecord(await fetchJson(endpoint.toString()));
  const board = readRecord(payload.board);
  const description = readRecord(payload.description);

  if (
    readString(payload.uuid).toLowerCase() !== route.postingId.toLowerCase() ||
    readString(board.slug) !== route.slug ||
    !sameOriginPath(payload.url, route.canonicalUrl)
  ) return null;

  const primaryCompany = readString(payload.companyName);
  const boardCompany = readString(board.companyName);
  if (
    primaryCompany &&
    boardCompany &&
    primaryCompany.toLowerCase() !== boardCompany.toLowerCase()
  ) return null;

  const metadata = createMetadata(
    payload.name,
    primaryCompany || boardCompany,
    description.role,
  );
  if (!metadata) return null;

  // Some boards omit the role body. In that case, keep provider identity but
  // allow the existing exact-page parser to supply any available description.
  return metadata.description
    ? metadata
    : { ...metadata, outcome: 'partial' };
}

function previewKnownJobBoard(
  inputUrl: URL,
  fetchJson: CaptureJsonFetcher,
  fetchXml: CaptureXmlFetcher,
): Promise<CaptureMetadata | null> {
  if (inputUrl.protocol !== 'https:') return Promise.resolve(null);
  if (parsePersonioPostingId(inputUrl)) return previewPersonio(inputUrl, fetchXml);
  if (parseRipplingPostingRoute(inputUrl)) return previewRippling(inputUrl, fetchJson);
  const host = inputUrl.hostname.toLowerCase();
  if (host === 'job-boards.greenhouse.io' || host === 'boards.greenhouse.io') {
    return previewGreenhouse(inputUrl, fetchJson);
  }
  if (host === 'jobs.ashbyhq.com') return previewAshby(inputUrl, fetchJson);
  if (host === 'apply.workable.com') return previewWorkable(inputUrl, fetchJson);
  if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') {
    return previewLever(inputUrl, fetchJson);
  }
  if (host.endsWith('.bamboohr.com')) return previewBambooHr(inputUrl, fetchJson);
  if (host.endsWith('.breezy.hr')) return previewBreezy(inputUrl, fetchJson);
  if (host.endsWith('.teamtailor.com')) return previewTeamtailor(inputUrl, fetchJson);
  if (host === 'jobs.smartrecruiters.com') return previewSmartRecruiters(inputUrl, fetchJson);
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/u.test(host)) {
    return previewWorkday(inputUrl, fetchJson);
  }
  return Promise.resolve(null);
}

/**
 * Dependency-injected entry point for adapter regression tests. Every adapter
 * uses the shared JSON transport in production, which performs URL validation,
 * public DNS checks, pinned connections, bounded bodies and no ambient cookies.
 */
export async function previewOpportunityUrlWithDependencies(
  input: string,
  dependencies: OpportunityCaptureDependencies = {},
): Promise<OpportunityCapturePreview> {
  const fetchJson = dependencies.fetchJson ?? fetchPublicCaptureJson;
  const fetchHtml = dependencies.fetchHtml ?? fetchPublicCapturePage;
  const fetchXml = dependencies.fetchXml ?? fetchPublicCaptureXml;

  try {
    const safeTarget = parseCaptureTarget(input);
    const url = safeTarget.url;

    // LinkedIn explicitly prohibits automated scraping/copying. Preserve the
    // user-supplied link, but never fetch LinkedIn hosts from this service.
    if (isLinkedInHost(url)) return emptyFailure('unsupported');

    // Vendor-native JSON often contains richer fields than the HTML shell.
    // A complete exact match can return immediately. For partial provider
    // results, parse the public page too and fill only missing fields.
    let adapted: CaptureMetadata | null = null;
    try {
      adapted = await previewKnownJobBoard(url, fetchJson, fetchXml);
      if (adapted?.outcome === 'ready') return adapted;
    } catch {
      // A public ATS endpoint may be unavailable or have changed. Do not
      // expose its response or error; attempt the ordinary public HTML page.
    }

    const page = await fetchHtml(url.toString());
    if (isExpiredJobBoardRedirect(url, page.finalUrl)) {
      return adapted ?? emptyFailure('not-found');
    }
    const allowBambooHrSiteName = Boolean(
      parseBambooHrPostingId(url) && sameOriginPath(page.finalUrl, url),
    );
    const allowPersonioTitleCompany = Boolean(
      parsePersonioPostingId(url) && sameOriginPath(page.finalUrl, url),
    );
    const parsed = parseCaptureMetadata(page.html, input, page.finalUrl, {
      allowOpenGraphSiteNameAsCompany: allowBambooHrSiteName,
      allowPersonioOpenGraphTitleAsCompany: allowPersonioTitleCompany,
    });
    return adapted ? mergeIncompleteCaptureMetadata(adapted, parsed) : parsed;
  } catch (error) {
    const outcome: CapturePreviewFailure = error instanceof CaptureFetchError
      ? error.reason
      : 'unavailable';

    return emptyFailure(outcome);
  }
}

/**
 * Fetches and parses one public page through the SSRF-safe HTTP client, with
 * narrowly scoped vendor adapters for major public job-board platforms.
 */
export async function previewOpportunityUrl(
  url: string,
): Promise<OpportunityCapturePreview> {
  return previewOpportunityUrlWithDependencies(url);
}

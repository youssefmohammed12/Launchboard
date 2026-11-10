import type {
  FormErrors,
  Opportunity,
  OpportunityFormData,
  OpportunityStatus,
  OpportunityType,
  Priority,
  WorkplaceType,
} from '../types/opportunity';
import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  WORKPLACE_TYPES,
  isValidUrl,
  normalizeTagList,
} from '@launchboard/domain';
import { activeOpportunities, isArchived } from './archive';
import { daysUntil, isValidISODate } from './dates';

export { MAX_TAG_LENGTH, MAX_TAGS, isValidUrl, normalizeTagList } from '@launchboard/domain';

/** Removes only UTM campaign parameters while retaining meaningful query data. */
export function stripUtmParameters(value: string): string {
  const input = value.trim();
  if (!input) return '';

  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return input;
    for (const name of [...url.searchParams.keys()]) {
      if (name.toLowerCase().startsWith('utm_')) url.searchParams.delete(name);
    }
    return url.toString();
  } catch {
    // Validation reports malformed URLs separately; never destroy the user's input.
    return input;
  }
}

export interface NormalizedWorkplaceDetails {
  locations: string[];
  workplaceType: WorkplaceType | '';
  employmentType: string;
}

function workplaceMode(value: string): WorkplaceType | '' {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
  return WORKPLACE_TYPES.find((mode) =>
    mode.toLowerCase().replace(/[\s_-]+/gu, '') === normalized
  ) ?? '';
}

/**
 * Keeps workplace mode separate from employer contract type and physical
 * locations. This is an edit/save-time cleanup; stored records are not rewritten
 * merely by reading them.
 */
export function normalizeWorkplaceDetails(
  input: Pick<OpportunityFormData, 'locations' | 'workplaceType' | 'employmentType'>,
): NormalizedWorkplaceDetails {
  const employmentParts = input.employmentType
    .split(/[,;|]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const employmentMode = employmentParts
    .map(workplaceMode)
    .find(Boolean) ?? '';

  const locations: string[] = [];
  let locationMode: WorkplaceType | '' = '';
  for (const raw of input.locations) {
    const value = raw.trim().replace(/\s+/gu, ' ');
    if (!value) continue;
    const modeAndPlace = /^(Remote|Hybrid|On[\s-]?site)(?:\s*(?:\(([^)]+)\)|[-,|:]\s*(.+)))?$/iu.exec(value);
    const mode = workplaceMode(modeAndPlace?.[1] ?? value);
    if (mode) {
      locationMode ||= mode;
      const place = (modeAndPlace?.[2] ?? modeAndPlace?.[3] ?? '').trim();
      if (place) locations.push(place);
      continue;
    }
    locations.push(value);
  }

  return {
    locations: [...new Set(locations)],
    workplaceType: input.workplaceType || employmentMode || locationMode,
    employmentType: employmentParts.filter((part) => !workplaceMode(part)).join(', '),
  };
}


export interface Stats {
  total: number;
  applied: number;
  interviews: number;
  offers: number;
}

const SENT: readonly OpportunityStatus[] = ['Applied', 'Interview', 'Offer'];

/**
 * Dashboard statistics describe the active working portfolio, so archived
 * opportunities are excluded here rather than in each presentation component.
 * Applications Sent counts Applied, Interview and Offer.
 */
export function computeStats(items: Opportunity[]): Stats {
  const active = activeOpportunities(items);
  return {
    total: active.length,
    applied: active.filter((o) => SENT.includes(o.status)).length,
    interviews: active.filter((o) => o.status === 'Interview').length,
    offers: active.filter((o) => o.status === 'Offer').length,
  };
}

export interface Filters {
  query: string;
  type: OpportunityType | 'All';
  status: OpportunityStatus | 'All';
  priority: Priority | 'All';
  /** Empty string means all tags, avoiding a collision with a user tag named "All". */
  tag: string;
  sort: 'asc' | 'desc';
}

/** Records without a deadline always sort last. */
function byDeadline(a: Opportunity, b: Opportunity, dir: 'asc' | 'desc'): number {
  if (!a.deadline && !b.deadline) return 0;
  if (!a.deadline) return 1;
  if (!b.deadline) return -1;
  return dir === 'asc' ? a.deadline.localeCompare(b.deadline) : b.deadline.localeCompare(a.deadline);
}

export function applyFilters(items: Opportunity[], f: Filters): Opportunity[] {
  const q = f.query.trim().toLowerCase();
  const tag = f.tag.toLowerCase();
  return items
    .filter((o) => !q || o.title.toLowerCase().includes(q) || o.company.toLowerCase().includes(q))
    .filter((o) => f.type === 'All' || o.type === f.type)
    .filter((o) => f.status === 'All' || o.status === f.status)
    .filter((o) => f.priority === 'All' || o.priority === f.priority)
    .filter((o) => !tag || o.tags.some((t) => t.toLowerCase() === tag))
    .sort((a, b) => byDeadline(a, b, f.sort));
}

export type BulkDeleteTargetFailure =
  | 'empty'
  | 'duplicate'
  | 'missing'
  | 'ambiguous'
  | 'mode';

export type BulkDeleteTargets =
  | { ok: true; targets: Opportunity[] }
  | { ok: false; reason: BulkDeleteTargetFailure };

/**
 * Resolves the exact records a confirmed bulk delete may remove.
 *
 * The request must identify a unique set of records that all still exist in
 * the archive mode the user confirmed. Anything else - an empty or duplicated
 * request, a vanished record, a record that moved to the other archive mode, or
 * a collection whose duplicate IDs make the target ambiguous - is refused so a
 * batch can never silently delete only part of what was confirmed.
 */
export function resolveBulkDeleteTargets(
  items: readonly Opportunity[],
  ids: readonly string[],
  archiveView: 'active' | 'archived',
): BulkDeleteTargets {
  if (ids.length === 0) return { ok: false, reason: 'empty' };

  const unique = new Set(ids);
  if (unique.size !== ids.length) return { ok: false, reason: 'duplicate' };

  const matches = items.filter((item) => unique.has(item.id));
  if (matches.length === 0) return { ok: false, reason: 'missing' };

  // Two stored records sharing one requested ID would both be removed by an
  // ID-based delete, which is not what the confirmed row represents.
  const matchedIds = new Set(matches.map((item) => item.id));
  if (matchedIds.size !== matches.length) return { ok: false, reason: 'ambiguous' };
  if (matches.length !== unique.size) return { ok: false, reason: 'missing' };

  const wantArchived = archiveView === 'archived';
  if (matches.some((item) => isArchived(item) !== wantArchived)) {
    return { ok: false, reason: 'mode' };
  }

  return { ok: true, targets: matches };
}

/** Repairs tags from localStorage, including the per-opportunity count cap. */
export function normalizeStoredTags(value: unknown): string[] {
  const tags = Array.isArray(value) ? normalizeTagList(value) : [];
  return tags.slice(0, MAX_TAGS);
}

export interface TagParseResult {
  tags: string[];
  error: string | null;
}

/**
 * Parses the form's comma-separated tag input. Oversized and excess tags are
 * reported as errors rather than being silently truncated.
 */
export function parseTagInput(input: string): TagParseResult {
  const raw = input
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (raw.some((tag) => tag.length > MAX_TAG_LENGTH)) {
    return { tags: [], error: `Each tag must be ${MAX_TAG_LENGTH} characters or fewer.` };
  }
  const tags = normalizeTagList(raw);
  if (tags.length > MAX_TAGS) {
    return { tags, error: `Add at most ${MAX_TAGS} tags.` };
  }
  return { tags, error: null };
}

/** Unique tags across all opportunities, sorted for stable filter options. */
export function collectTags(items: Opportunity[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.sort((a, b) => a.localeCompare(b));
}

/** Active workspace deadlines; archived records never reach this view. */
export function activeDeadlines(items: Opportunity[]): Opportunity[] {
  return activeOpportunities(items)
    .filter((o) => o.deadline && o.status !== 'Rejected' && o.status !== 'Offer')
    .sort((a, b) => byDeadline(a, b, 'asc'));
}

function followUpGroup(days: number): number {
  if (days < 0) return 0;
  if (days === 0) return 1;
  return 2;
}

/**
 * Active opportunities with follow-up dates, ordered by urgency: most recently
 * overdue first, then today, then the nearest upcoming. Invalid dates,
 * archived records and records without a follow-up are ignored.
 */
export function followUpItems(items: Opportunity[]): Opportunity[] {
  return activeOpportunities(items)
    .filter((o) => o.followUpDate && isValidISODate(o.followUpDate))
    .sort((a, b) => {
      const aDays = daysUntil(a.followUpDate) as number;
      const bDays = daysUntil(b.followUpDate) as number;
      const aGroup = followUpGroup(aDays);
      const bGroup = followUpGroup(bDays);
      if (aGroup !== bGroup) return aGroup - bGroup;
      if (aGroup === 0) return bDays - aDays;
      return aDays - bDays;
    });
}

export const emptyForm: OpportunityFormData = {
  title: '',
  company: '',
  type: '',
  status: 'Saved',
  priority: 'Medium',
  tags: [],
  url: '',
  deadline: '',
  followUpDate: '',
  locations: [],
  department: '',
  team: '',
  workplaceType: '',
  employmentType: '',
  postedDate: '',
  compensationDetails: null,
  compensation: '',
  description: '',
  notes: '',
};

export function validate(data: OpportunityFormData): FormErrors {
  const errors: FormErrors = {};
  if (!data.title.trim()) errors.title = 'Title is required.';
  if (!data.company.trim()) errors.company = 'Company or client is required.';
  if (!data.type) errors.type = 'Choose an opportunity type.';
  if (data.url.trim() && !isValidUrl(data.url.trim())) {
    errors.url = 'Enter a valid URL starting with http:// or https://.';
  }
  if (data.deadline.trim() && !isValidISODate(data.deadline.trim())) {
    errors.deadline = 'Enter a valid deadline.';
  }
  if (data.followUpDate.trim() && !isValidISODate(data.followUpDate.trim())) {
    errors.followUpDate = 'Enter a valid follow-up date.';
  }
  return errors;
}

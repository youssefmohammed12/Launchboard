import type { Opportunity } from '../types/opportunity';
import { isArchived } from './archive';

/**
 * Global search across the current opportunity collection.
 *
 * This is a read-only, in-memory search over the already-normalized records.
 * It never mutates the collection, never persists results, and deliberately
 * uses simple substring matching rather than fuzzy matching or an index.
 */

export const GLOBAL_SEARCH_LIMIT = 20;

export type GlobalSearchCategory =
  | 'opportunity'
  | 'interview'
  | 'contact'
  | 'material'
  | 'activity';

export interface GlobalSearchResult {
  /** Stable identity derived from the category, parent and child record IDs. */
  key: string;
  category: GlobalSearchCategory;
  /** Primary text for the result, for example the opportunity title. */
  label: string;
  opportunityId: string;
  opportunityTitle: string;
  company: string;
  archived: boolean;
  /** The matched interview/contact/material/activity ID, or null for the root. */
  childId: string | null;
  /** Secondary context: company, category detail and the matched field/value. */
  context: string;
}

export interface GlobalSearchOptions {
  query: string;
  /** Archived records are excluded unless this is explicitly true. */
  includeArchived?: boolean;
  /** Defaults to GLOBAL_SEARCH_LIMIT. */
  limit?: number;
}

export interface GlobalSearchResponse {
  results: GlobalSearchResult[];
  /** Number of matches before the limit was applied. */
  total: number;
  /** True when more matches exist than the returned results. */
  truncated: boolean;
}

interface FieldMatch {
  field: string;
  value: string;
}

interface RootMatch extends FieldMatch {
  /** 0 exact title/company, 1 title/company prefix, 2 any other field. */
  tier: 0 | 1 | 2;
}

const CATEGORY_ORDER: Record<GlobalSearchCategory, number> = {
  opportunity: 0,
  interview: 1,
  contact: 2,
  material: 3,
  activity: 4,
};

const ROOT_FIELDS: { field: string; values: (item: Opportunity) => string[] }[] = [
  { field: 'Description', values: (item) => [item.description] },
  { field: 'Notes', values: (item) => [item.notes] },
  { field: 'Tags', values: (item) => item.tags },
  { field: 'Type', values: (item) => [item.type] },
  { field: 'Status', values: (item) => [item.status] },
  { field: 'Priority', values: (item) => [item.priority] },
  { field: 'Compensation', values: (item) => [item.compensation] },
  { field: 'Application link', values: (item) => [item.url] },
];

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Collapses whitespace and caps a matched value for a compact context line. */
function snippet(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > 72 ? `${collapsed.slice(0, 69)}…` : collapsed;
}

function contextLine(parts: (string | false | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function matchField(field: string, value: string, query: string): FieldMatch | null {
  if (!value) return null;
  return value.toLowerCase().includes(query) ? { field, value } : null;
}

/** Matches the first field that contains the query, in a stable field order. */
function firstFieldMatch(
  fields: { field: string; value: string }[],
  query: string,
): FieldMatch | null {
  for (const { field, value } of fields) {
    const match = matchField(field, value, query);
    if (match) return match;
  }
  return null;
}

function matchRoot(item: Opportunity, query: string): RootMatch | null {
  const title = item.title.trim();
  const company = item.company.trim();
  const titleLower = title.toLowerCase();
  const companyLower = company.toLowerCase();

  if (titleLower === query) return { tier: 0, field: 'Title', value: title };
  if (companyLower === query) return { tier: 0, field: 'Company', value: company };
  if (titleLower.startsWith(query)) return { tier: 1, field: 'Title', value: title };
  if (companyLower.startsWith(query)) return { tier: 1, field: 'Company', value: company };

  const titleSubstring = matchField('Title', title, query);
  if (titleSubstring) return { tier: 2, ...titleSubstring };
  const companySubstring = matchField('Company', company, query);
  if (companySubstring) return { tier: 2, ...companySubstring };

  for (const { field, values } of ROOT_FIELDS) {
    for (const value of values(item)) {
      const match = matchField(field, value, query);
      if (match) return { tier: 2, ...match };
    }
  }
  return null;
}

interface RankedResult {
  result: GlobalSearchResult;
  tier: number;
  itemIndex: number;
  childIndex: number;
}

function rootContext(item: Opportunity, match: RootMatch): string {
  const company = item.company.trim();
  if (match.tier < 2 || match.field === 'Title' || match.field === 'Company') {
    return contextLine([company, item.type, item.status]);
  }
  return contextLine([company, `${match.field}: “${snippet(match.value)}”`]);
}

function childContext(item: Opportunity, match: FieldMatch): string {
  return contextLine([
    item.company.trim(),
    item.title.trim(),
    `${match.field}: “${snippet(match.value)}”`,
  ]);
}

function resultKey(
  category: GlobalSearchCategory,
  opportunityId: string,
  childId: string | null,
): string {
  return `${category}:${opportunityId}:${childId ?? 'root'}`;
}

export function searchOpportunities(
  items: readonly Opportunity[],
  options: GlobalSearchOptions,
): GlobalSearchResponse {
  const query = normalizeQuery(options.query);
  if (!query) return { results: [], total: 0, truncated: false };

  const includeArchived = options.includeArchived ?? false;
  const limit = options.limit ?? GLOBAL_SEARCH_LIMIT;
  const ranked: RankedResult[] = [];
  /** Prevents two entries for the same underlying record. */
  const seen = new Set<string>();

  items.forEach((item, itemIndex) => {
    if (!includeArchived && isArchived(item)) return;

    const push = (
      category: GlobalSearchCategory,
      childId: string | null,
      label: string,
      context: string,
      tier: number,
      childIndex: number,
    ) => {
      const key = resultKey(category, item.id, childId);
      if (seen.has(key)) return;
      seen.add(key);
      ranked.push({
        result: {
          key,
          category,
          label,
          opportunityId: item.id,
          opportunityTitle: item.title,
          company: item.company,
          archived: isArchived(item),
          childId,
          context,
        },
        tier,
        itemIndex,
        childIndex,
      });
    };

    const root = matchRoot(item, query);
    if (root) {
      push(
        'opportunity',
        null,
        item.title.trim() || 'Untitled opportunity',
        rootContext(item, root),
        root.tier,
        0,
      );
    }

    item.interviews.forEach((interview, childIndex) => {
      if (!interview.id) return;
      const match = firstFieldMatch(
        [
          { field: 'Round', value: interview.round },
          { field: 'Preparation notes', value: interview.preparationNotes },
          { field: 'Notes', value: interview.notes },
          { field: 'Mode', value: interview.mode },
          { field: 'Location', value: interview.location },
          { field: 'Outcome', value: interview.outcome },
          { field: 'Status', value: interview.status },
        ],
        query,
      );
      if (!match) return;
      push(
        'interview',
        interview.id,
        interview.round || 'Interview',
        childContext(item, match),
        3,
        childIndex,
      );
    });

    item.contacts.forEach((contact, childIndex) => {
      if (!contact.id) return;
      const match = firstFieldMatch(
        [
          { field: 'Name', value: contact.name },
          { field: 'Role', value: contact.role },
          { field: 'Email', value: contact.email },
          { field: 'Phone', value: contact.phone },
          { field: 'Notes', value: contact.notes },
        ],
        query,
      );
      if (!match) return;
      push(
        'contact',
        contact.id,
        contact.name || 'Contact',
        childContext(item, match),
        3,
        childIndex,
      );
    });

    item.materials.forEach((material, childIndex) => {
      if (!material.id) return;
      const match = firstFieldMatch(
        [
          { field: 'Label', value: material.label },
          { field: 'Kind', value: material.kind },
          { field: 'Version', value: material.version },
          { field: 'Status', value: material.status },
          { field: 'Notes', value: material.notes },
        ],
        query,
      );
      if (!match) return;
      push(
        'material',
        material.id,
        material.label || 'Material',
        childContext(item, match),
        3,
        childIndex,
      );
    });

    item.activities.forEach((activity, childIndex) => {
      if (!activity.id) return;
      const match = firstFieldMatch(
        [
          { field: 'Type', value: activity.type },
          { field: 'Note', value: activity.note },
        ],
        query,
      );
      if (!match) return;
      push(
        'activity',
        activity.id,
        activity.type || 'Activity',
        childContext(item, match),
        3,
        childIndex,
      );
    });
  });

  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.itemIndex - b.itemIndex ||
      CATEGORY_ORDER[a.result.category] - CATEGORY_ORDER[b.result.category] ||
      a.childIndex - b.childIndex ||
      a.result.key.localeCompare(b.result.key),
  );

  const total = ranked.length;
  const results = ranked.slice(0, Math.max(0, limit)).map(({ result }) => result);
  return { results, total, truncated: total > results.length };
}

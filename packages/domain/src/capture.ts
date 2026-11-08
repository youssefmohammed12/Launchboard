import type { Opportunity } from './opportunity.js';

export type OpportunityDuplicateMatchReason = 'url' | 'title-company';

export interface OpportunityDuplicateCandidate {
  title: string;
  company: string;
  url: string;
}

export interface OpportunityDuplicateMatch {
  /** The original loaded record. The detector never edits or copies it. */
  opportunity: Opportunity;
  /** URL is the stronger reason and is always listed first when both match. */
  reasons: OpportunityDuplicateMatchReason[];
}

const TRACKING_PARAMETERS = new Set(['gclid', 'fbclid']);

/**
 * Produces a comparison-only URL key. The returned value must never replace
 * the URL the user entered or the URL stored on an Opportunity.
 *
 * Query parameter order and every non-tracking parameter are preserved so
 * identifiers and potentially meaningful URL semantics are not discarded.
 */
export function normalizeUrlForDuplicateComparison(value: string): string | null {
  const input = value.trim();
  if (!input) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  // Some job boards place the actual job route in the fragment. Preserve
  // only clearly route-like hash forms; ordinary anchors such as #apply are
  // presentation/navigation hints and do not identify a separate posting.
  const hasHashRoute = /^#!?\//u.test(url.hash);
  if (!hasHashRoute) url.hash = '';

  const meaningfulParameters = [...url.searchParams.entries()].filter(([name]) => {
    const normalizedName = name.toLowerCase();
    return !normalizedName.startsWith('utm_') && !TRACKING_PARAMETERS.has(normalizedName);
  });

  url.search = '';
  for (const [name, parameterValue] of meaningfulParameters) {
    url.searchParams.append(name, parameterValue);
  }

  // URL serializes scheme and hostname casing consistently and removes
  // default HTTP/HTTPS ports while preserving path case and meaningful query.
  return url.toString();
}

/**
 * Normalizes human-entered identity text without removing accents or
 * punctuation, which could otherwise create surprising false positives.
 */
export function normalizeTextForDuplicateComparison(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

/**
 * Finds exact likely duplicates in the supplied collection.
 *
 * Archived opportunities are intentionally included. A URL match is stronger
 * than a title/company match, but both reasons are retained when applicable.
 * Collection order is preserved so callers can present stable results.
 */
export function findOpportunityDuplicates(
  candidate: OpportunityDuplicateCandidate,
  opportunities: readonly Opportunity[],
): OpportunityDuplicateMatch[] {
  const candidateUrl = normalizeUrlForDuplicateComparison(candidate.url);
  const candidateTitle = normalizeTextForDuplicateComparison(candidate.title);
  const candidateCompany = normalizeTextForDuplicateComparison(candidate.company);
  const canMatchTitleAndCompany = candidateTitle.length > 0 && candidateCompany.length > 0;

  const matches: OpportunityDuplicateMatch[] = [];

  for (const opportunity of opportunities) {
    const reasons: OpportunityDuplicateMatchReason[] = [];

    if (
      candidateUrl !== null
      && normalizeUrlForDuplicateComparison(opportunity.url) === candidateUrl
    ) {
      reasons.push('url');
    }

    if (
      canMatchTitleAndCompany
      && candidateTitle === normalizeTextForDuplicateComparison(opportunity.title)
      && candidateCompany === normalizeTextForDuplicateComparison(opportunity.company)
    ) {
      reasons.push('title-company');
    }

    if (reasons.length > 0) {
      matches.push({ opportunity, reasons });
    }
  }

  return matches;
}

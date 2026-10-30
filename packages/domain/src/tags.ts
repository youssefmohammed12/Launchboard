import { MAX_TAG_LENGTH } from './limits.js';

/**
 * Normalizes tag values for display/storage: trims, drops empties and
 * non-strings, deduplicates case-insensitively (keeping the first spelling),
 * and caps each individual tag at `MAX_TAG_LENGTH` characters.
 *
 * This deliberately does not apply the per-opportunity count cap. Storage
 * recovery and form validation decide separately whether excess tags are
 * dropped or reported as an error.
 */
export function normalizeTagList(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

import { OPPORTUNITY_STATUSES, OPPORTUNITY_TYPES, PRIORITIES } from '../types/opportunity';
import { MAX_TAG_LENGTH, type Filters } from './opportunities';
import { createId } from './id';

/**
 * Saved Views are Opportunities-page preferences, not opportunity data. They
 * deliberately live under their own key so a view can never change, replace or
 * invalidate the stored opportunity collection.
 */
export const SAVED_VIEWS_KEY = 'launchboard.views.v1';
export const MAX_SAVED_VIEWS = 20;
export const MAX_SAVED_VIEW_NAME_LENGTH = 60;

export type SavedViewArchiveView = 'active' | 'archived';
export type SavedViewLayout = 'list' | 'board';

export interface SavedViewSettings {
  filters: Filters;
  archiveView: SavedViewArchiveView;
  viewMode: SavedViewLayout;
}

export interface SavedView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: SavedViewSettings;
}

export const DEFAULT_SAVED_VIEW_SETTINGS: SavedViewSettings = {
  filters: {
    query: '',
    type: 'All',
    status: 'All',
    priority: 'All',
    tag: '',
    sort: 'asc',
  },
  archiveView: 'active',
  viewMode: 'list',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Repairs stored settings instead of discarding the whole view. Unsupported
 * enum values fall back to the unfiltered/default setting, while custom search
 * text and tags are kept even when they currently match no record.
 */
export function normalizeSavedViewSettings(value: unknown): SavedViewSettings {
  const source = isRecord(value) ? value : {};
  const filters = isRecord(source.filters) ? source.filters : {};
  const tag = text(filters.tag).trim().slice(0, MAX_TAG_LENGTH);

  return {
    filters: {
      query: text(filters.query),
      type: OPPORTUNITY_TYPES.find((type) => type === filters.type) ?? 'All',
      status: OPPORTUNITY_STATUSES.find((status) => status === filters.status) ?? 'All',
      priority: PRIORITIES.find((priority) => priority === filters.priority) ?? 'All',
      tag,
      sort: filters.sort === 'desc' ? 'desc' : 'asc',
    },
    archiveView: source.archiveView === 'archived' ? 'archived' : 'active',
    viewMode: source.viewMode === 'board' ? 'board' : 'list',
  };
}

/** Returns a detached copy so UI state cannot mutate a persisted view. */
export function snapshotSavedViewSettings(settings: SavedViewSettings): SavedViewSettings {
  return normalizeSavedViewSettings(settings);
}

export function sameSavedViewSettings(
  a: SavedViewSettings,
  b: SavedViewSettings,
): boolean {
  return (
    a.filters.query === b.filters.query &&
    a.filters.type === b.filters.type &&
    a.filters.status === b.filters.status &&
    a.filters.priority === b.filters.priority &&
    a.filters.tag === b.filters.tag &&
    a.filters.sort === b.filters.sort &&
    a.archiveView === b.archiveView &&
    a.viewMode === b.viewMode
  );
}

function timestamp(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return fallback;
  return value;
}

function normalizeSavedView(value: unknown, now: string): SavedView | null {
  if (!isRecord(value)) return null;

  const id = text(value.id).trim();
  const name = text(value.name).trim().slice(0, MAX_SAVED_VIEW_NAME_LENGTH);
  if (!id || !name) return null;

  const createdAt = timestamp(value.createdAt, now);
  const updatedAt = timestamp(value.updatedAt, createdAt);

  return {
    id,
    name,
    createdAt,
    updatedAt,
    settings: normalizeSavedViewSettings(value.settings),
  };
}

/**
 * Keeps every repairable view, rejects malformed entries, keeps the first of
 * any duplicate IDs, and enforces the collection limit deterministically.
 */
export function normalizeSavedViews(
  value: unknown,
  now: string = new Date().toISOString(),
): SavedView[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const views: SavedView[] = [];
  for (const entry of value) {
    const view = normalizeSavedView(entry, now);
    if (!view || seenIds.has(view.id)) continue;
    seenIds.add(view.id);
    views.push(view);
    if (views.length >= MAX_SAVED_VIEWS) break;
  }
  return views;
}

/** A missing, unreadable or malformed value is treated as no saved views. */
export function loadSavedViews(): SavedView[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVED_VIEWS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  try {
    return normalizeSavedViews(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Writes the complete collection. Returns false when the browser refuses it. */
export function saveSavedViews(views: readonly SavedView[]): boolean {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates a user-entered name against the trimmed, case-insensitive rules.
 * `currentId` lets a rename keep its existing name (including letter casing).
 */
export function savedViewNameError(
  name: string,
  views: readonly SavedView[],
  currentId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name for this view.';
  if (trimmed.length > MAX_SAVED_VIEW_NAME_LENGTH) {
    return `Use ${MAX_SAVED_VIEW_NAME_LENGTH} characters or fewer.`;
  }

  const key = trimmed.toLowerCase();
  const duplicate = views.some(
    (view) => view.id !== currentId && view.name.trim().toLowerCase() === key,
  );
  if (duplicate) return 'A saved view with this name already exists.';
  return null;
}

export function createSavedView(
  name: string,
  settings: SavedViewSettings,
  now: string = new Date().toISOString(),
): SavedView {
  return {
    id: createId(),
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    settings: snapshotSavedViewSettings(settings),
  };
}

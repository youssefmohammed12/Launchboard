import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SAVED_VIEW_SETTINGS,
  MAX_SAVED_VIEW_NAME_LENGTH,
  MAX_SAVED_VIEWS,
  SAVED_VIEWS_KEY,
  createSavedView,
  loadSavedViews,
  normalizeSavedViewSettings,
  normalizeSavedViews,
  sameSavedViewSettings,
  saveSavedViews,
  savedViewNameError,
  snapshotSavedViewSettings,
  type SavedView,
  type SavedViewSettings,
} from './savedViews';

const NOW = '2026-05-01T12:00:00.000Z';

const settings: SavedViewSettings = {
  filters: {
    query: 'Alpha',
    type: 'Internship',
    status: 'Applied',
    priority: 'High',
    tag: 'Remote',
    sort: 'desc',
  },
  archiveView: 'archived',
  viewMode: 'board',
};

function makeView(overrides: Partial<SavedView> = {}): SavedView {
  return {
    id: 'view-1',
    name: 'Focused',
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-02T10:00:00.000Z',
    settings,
    ...overrides,
  };
}

describe('saved view normalization', () => {
  it('keeps valid entries and repairs only unsupported settings', () => {
    const views = normalizeSavedViews(
      [
        {
          id: ' v1 ',
          name: '  Focused search  ',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          settings: {
            filters: {
              query: ' Alpha ',
              type: 'Internship',
              status: 'Unsupported',
              priority: 'High',
              tag: ' Remote ',
              sort: 'desc',
            },
            archiveView: 'archived',
            viewMode: 'board',
          },
        },
        {
          id: 'v2',
          name: 'Empty query',
          settings: {
            filters: {
              query: 'nothing-matches-this',
              type: 'Unsupported',
              status: 'Unsupported',
              priority: 'Unsupported',
              tag: 42,
              sort: 'sideways',
            },
            archiveView: 'somewhere',
            viewMode: 'grid',
          },
        },
      ],
      NOW,
    );

    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ id: 'v1', name: 'Focused search' });
    expect(views[0].settings).toEqual({
      filters: {
        query: ' Alpha ',
        type: 'Internship',
        status: 'All',
        priority: 'High',
        tag: 'Remote',
        sort: 'desc',
      },
      archiveView: 'archived',
      viewMode: 'board',
    });

    // A query that matches nothing is valid, not corrupt.
    expect(views[1].settings).toEqual({
      ...DEFAULT_SAVED_VIEW_SETTINGS,
      filters: {
        ...DEFAULT_SAVED_VIEW_SETTINGS.filters,
        query: 'nothing-matches-this',
      },
    });
    expect(views[1].createdAt).toBe(NOW);
    expect(views[1].updatedAt).toBe(NOW);
  });

  it('drops malformed entries, keeps the first duplicate ID, caps names and the collection', () => {
    const valid = Array.from({ length: MAX_SAVED_VIEWS + 3 }, (_, index) =>
      makeView({
        id: `view-${index}`,
        name: `${'x'.repeat(MAX_SAVED_VIEW_NAME_LENGTH + 5)}-${index}`,
      }),
    );

    const views = normalizeSavedViews(
      [
        null,
        'not a view',
        { id: '', name: 'Missing id' },
        { id: 'missing-name', name: '   ' },
        makeView({ id: 'duplicate', name: 'First duplicate' }),
        makeView({ id: 'duplicate', name: 'Second duplicate' }),
        ...valid,
      ],
      NOW,
    );

    expect(views).toHaveLength(MAX_SAVED_VIEWS);
    expect(views[0]).toMatchObject({ id: 'duplicate', name: 'First duplicate' });
    expect(views.map((view) => view.id)).not.toContain('missing-name');
    expect(views.every((view) => view.name.length <= MAX_SAVED_VIEW_NAME_LENGTH)).toBe(true);
    expect(new Set(views.map((view) => view.id)).size).toBe(views.length);
  });

  it('normalizes non-object settings to safe defaults', () => {
    expect(normalizeSavedViewSettings(null)).toEqual(DEFAULT_SAVED_VIEW_SETTINGS);
    expect(normalizeSavedViewSettings('bad')).toEqual(DEFAULT_SAVED_VIEW_SETTINGS);
  });
});

describe('saved view storage', () => {
  it('round-trips several settings under the dedicated key', () => {
    const views = [createSavedView('  Focused  ', settings, NOW)];

    expect(saveSavedViews(views)).toBe(true);
    expect(localStorage.getItem(SAVED_VIEWS_KEY)).not.toBeNull();
    expect(loadSavedViews()).toEqual([
      {
        ...views[0],
        name: 'Focused',
        settings,
      },
    ]);
  });

  it('treats missing, malformed and unreadable storage as no saved views', () => {
    expect(loadSavedViews()).toEqual([]);

    localStorage.setItem(SAVED_VIEWS_KEY, '{not-json');
    expect(loadSavedViews()).toEqual([]);

    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify({ views: [] }));
    expect(loadSavedViews()).toEqual([]);

    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([makeView(), null, { id: 'broken' }]),
    );
    expect(loadSavedViews()).toEqual([makeView()]);

    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadSavedViews()).toEqual([]);
    getItem.mockRestore();
  });

  it('reports a refused write instead of throwing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(saveSavedViews([makeView()])).toBe(false);
    setItem.mockRestore();
  });
});

describe('saved view names and snapshots', () => {
  const views = [makeView({ id: 'view-1', name: 'Focused' }), makeView({ id: 'view-2', name: 'Archived' })];

  it('trims, rejects empty and oversized names, and compares names case-insensitively', () => {
    expect(savedViewNameError('   ', views)).toBe('Enter a name for this view.');
    expect(savedViewNameError('x'.repeat(MAX_SAVED_VIEW_NAME_LENGTH + 1), views)).toBe(
      `Use ${MAX_SAVED_VIEW_NAME_LENGTH} characters or fewer.`,
    );
    expect(savedViewNameError('  focused  ', views)).toBe(
      'A saved view with this name already exists.',
    );
    expect(savedViewNameError('FOCUSED', views, 'view-1')).toBeNull();
    expect(savedViewNameError('New view', views)).toBeNull();
  });

  it('snapshots settings without sharing filter state', () => {
    const snapshot = snapshotSavedViewSettings(settings);
    expect(sameSavedViewSettings(snapshot, settings)).toBe(true);
    expect(snapshot).not.toBe(settings);
    expect(snapshot.filters).not.toBe(settings.filters);

    snapshot.filters.query = 'Changed';
    expect(snapshot.filters.query).toBe('Changed');
    expect(settings.filters.query).toBe('Alpha');
    expect(sameSavedViewSettings(snapshot, settings)).toBe(false);
  });
});

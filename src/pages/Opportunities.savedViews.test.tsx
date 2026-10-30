import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { makeOpportunity } from '../test/fixtures';
import {
  DEFAULT_SAVED_VIEW_SETTINGS,
  SAVED_VIEWS_KEY,
  createSavedView,
  saveSavedViews,
  type SavedView,
} from '../utils/savedViews';
import { Opportunities } from './Opportunities';

const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';
const OPPORTUNITIES_KEY = 'launchboard.opportunities.v1';

function makeItems() {
  return [
    makeOpportunity({
      id: 'op-1',
      title: 'Alpha Role',
      company: 'Alpha Co',
      type: 'Internship',
      status: 'Applied',
      priority: 'High',
      tags: ['Remote'],
      deadline: '2026-05-01',
    }),
    makeOpportunity({
      id: 'op-2',
      title: 'Beta Role',
      company: 'Beta Co',
      type: 'Full-time',
      status: 'Interview',
      priority: 'Low',
      tags: ['Onsite'],
      deadline: '2026-04-01',
    }),
    makeOpportunity({
      id: 'op-3',
      title: 'Gamma Role',
      company: 'Gamma Co',
      type: 'Freelance',
      status: 'Offer',
      priority: 'Medium',
      tags: ['Remote'],
      deadline: '2026-06-01',
    }),
    makeOpportunity({
      id: 'op-4',
      title: 'Archived Role',
      company: 'Old Co',
      type: 'Part-time',
      status: 'Rejected',
      priority: 'Medium',
      tags: ['Onsite'],
      deadline: '2026-03-01',
      archivedAt: ARCHIVED_AT,
    }),
  ];
}

function setup(overrides: Partial<ComponentProps<typeof Opportunities>> = {}) {
  const props: ComponentProps<typeof Opportunities> = {
    items: makeItems(),
    onAdd: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onStatusChange: vi.fn(),
    selectionResetToken: 0,
    onBulkArchive: vi.fn(),
    onBulkRestore: vi.fn(),
    onBulkStatus: vi.fn(),
    onBulkDelete: vi.fn(),
    ...overrides,
  };
  const view = render(<Opportunities {...props} />);
  return { props, ...view };
}

function savedViewsButton(): HTMLElement {
  return screen.getByRole('button', { name: /Saved views/ });
}

function openPanel(): void {
  if (savedViewsButton().getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(savedViewsButton());
  }
}

function saveCurrent(name: string): void {
  openPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save view' }));
}

function storedViews(): SavedView[] {
  const raw = localStorage.getItem(SAVED_VIEWS_KEY);
  return raw ? (JSON.parse(raw) as SavedView[]) : [];
}

function rowCheckbox(title: string): HTMLElement {
  return screen.getByRole('checkbox', { name: `Select ${title}` });
}

function toolbar(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Bulk actions' });
}

describe('Opportunities saved views', () => {
  it('saves several settings, survives a reload, restores them, and clears selection', () => {
    const { unmount } = setup();

    fireEvent.change(screen.getByLabelText('Search by title or company'), {
      target: { value: 'Alpha' },
    });
    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'Internship' },
    });
    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'Applied' },
    });
    fireEvent.change(screen.getByLabelText('Filter by priority'), {
      target: { value: 'High' },
    });
    fireEvent.change(screen.getByLabelText('Filter by tag'), {
      target: { value: 'Remote' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Deadline: earliest first/ }));

    saveCurrent('Focused');

    expect(storedViews()).toHaveLength(1);
    expect(storedViews()[0]).toMatchObject({
      name: 'Focused',
      settings: {
        filters: {
          query: 'Alpha',
          type: 'Internship',
          status: 'Applied',
          priority: 'High',
          tag: 'Remote',
          sort: 'desc',
        },
        archiveView: 'active',
        viewMode: 'list',
      },
    });

    unmount();
    setup();
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Focused' }));

    expect(screen.getByLabelText('Search by title or company')).toHaveValue('Alpha');
    expect(screen.getByLabelText('Filter by type')).toHaveValue('Internship');
    expect(screen.getByLabelText('Filter by status')).toHaveValue('Applied');
    expect(screen.getByLabelText('Filter by priority')).toHaveValue('High');
    expect(screen.getByLabelText('Filter by tag')).toHaveValue('Remote');
    expect(
      screen.getByRole('button', { name: /Deadline: latest first/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Applied “Focused”.');

    // Applying clears selection even when the current settings already match.
    fireEvent.click(rowCheckbox('Alpha Role'));
    expect(toolbar()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Focused' }));

    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
  });

  it('updates and renames without changing the stable ID or creation time', () => {
    setup();
    saveCurrent('Focused');

    const created = storedViews()[0];

    fireEvent.change(screen.getByLabelText('Search by title or company'), {
      target: { value: 'Beta' },
    });
    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'Full-time' },
    });
    fireEvent.change(screen.getByLabelText('Filter by status'), {
      target: { value: 'Interview' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));

    fireEvent.click(screen.getByRole('button', { name: 'Update Focused' }));
    expect(
      screen.getByText('Replace “Focused” with the current page settings?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Replace view' }));

    const updated = storedViews()[0];
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.settings).toEqual({
      filters: {
        query: 'Beta',
        type: 'Full-time',
        status: 'Interview',
        priority: 'All',
        tag: '',
        sort: 'asc',
      },
      archiveView: 'archived',
      viewMode: 'board',
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Updated “Focused” to the current page settings.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename Focused' }));
    fireEvent.change(screen.getByLabelText('View name'), {
      target: { value: '  Renamed view  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename view' }));

    const renamed = storedViews()[0];
    expect(renamed.id).toBe(created.id);
    expect(renamed.createdAt).toBe(created.createdAt);
    expect(renamed.name).toBe('Renamed view');
    expect(renamed.settings).toEqual(updated.settings);
  });

  it('rejects duplicate names case-insensitively when renaming', () => {
    setup();
    saveCurrent('Focused');
    saveCurrent('Archived');

    fireEvent.click(screen.getByRole('button', { name: 'Rename Archived' }));
    fireEvent.change(screen.getByLabelText('View name'), {
      target: { value: '  focused  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename view' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A saved view with this name already exists.',
    );
    expect(storedViews().map((view) => view.name)).toEqual(['Focused', 'Archived']);
  });

  it('deletes only the saved view, not opportunities or their data', () => {
    const items = makeItems();
    const rawItems = JSON.stringify(items);
    localStorage.setItem(OPPORTUNITIES_KEY, rawItems);

    const { props } = setup({ items });
    saveCurrent('Focused');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Focused' }));
    expect(
      screen.getByText('Delete “Focused”? Opportunities are not affected.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));

    expect(storedViews()).toEqual([]);
    expect(localStorage.getItem(OPPORTUNITIES_KEY)).toBe(rawItems);
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onBulkDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Deleted “Focused”. Opportunities were not changed.',
    );
  });

  it('keeps a saved view with no matching opportunities usable', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Search by title or company'), {
      target: { value: 'no-such-opportunity' },
    });
    expect(
      screen.getByText('No opportunities match your search or filters.'),
    ).toBeInTheDocument();

    saveCurrent('Empty result');
    fireEvent.change(screen.getByLabelText('Search by title or company'), {
      target: { value: 'Alpha' },
    });

    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Empty result' }));

    expect(screen.getByLabelText('Search by title or company')).toHaveValue(
      'no-such-opportunity',
    );
    expect(
      screen.getByText('No opportunities match your search or filters.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Empty result')).toBeInTheDocument();
  });

  it('does not report a successful save or delete when storage fails', () => {
    const seeded = createSavedView(
      'Focused',
      DEFAULT_SAVED_VIEW_SETTINGS,
      '2026-01-01T00:00:00.000Z',
    );
    saveSavedViews([seeded]);
    setup();
    openPanel();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
      fireEvent.change(screen.getByLabelText('View name'), {
        target: { value: 'New view' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save view' }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The view could not be saved because browser storage is unavailable. Nothing was changed.',
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(storedViews()).toEqual([seeded]);

      fireEvent.click(screen.getByRole('button', { name: 'Delete Focused' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        'The view could not be deleted because browser storage is unavailable. Nothing was changed.',
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(storedViews()).toEqual([seeded]);
      expect(screen.getByRole('button', { name: 'Delete Focused' })).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });
});

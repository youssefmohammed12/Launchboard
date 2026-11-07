import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArrowDownUp,
  Columns3,
  Eye,
  List,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  type Opportunity,
  type OpportunityStatus,
} from '../types/opportunity';
import { activeOpportunities, archivedOpportunities } from '../utils/archive';
import { applyFilters, collectTags, type Filters } from '../utils/opportunities';
import { formatDate } from '../utils/dates';
import {
  ArchivedBadge,
  DemoTag,
  FollowUpBadge,
  PriorityBadge,
  StatusBadge,
  TagList,
} from '../components/Badges';
import { OpportunityBoard } from '../components/OpportunityBoard';
import { SavedViews } from '../components/SavedViews';
import type { SavedViewSettings } from '../utils/savedViews';

interface Props {
  items: Opportunity[];
  /** The optional second argument is the control that opened the dialog. */
  onAdd: (trigger?: HTMLElement | null) => void;
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onEdit: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onDelete: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onStatusChange: (id: string, status: OpportunityStatus) => void;
  /**
   * Incremented by the app after a bulk operation commits. The selection is
   * cleared only then, so a failed write keeps it available for a retry.
   */
  selectionResetToken: number;
  onBulkArchive: (ids: string[], trigger?: HTMLElement | null) => void;
  onBulkRestore: (ids: string[], trigger?: HTMLElement | null) => void;
  onBulkStatus: (
    ids: string[],
    status: OpportunityStatus,
    trigger?: HTMLElement | null,
  ) => void;
  /**
   * The archive mode is passed explicitly so the confirmation can name it and
   * the app can refuse a batch whose records moved to the other view.
   */
  onBulkDelete: (
    ids: string[],
    archiveView: 'active' | 'archived',
    trigger?: HTMLElement | null,
  ) => void;
}

const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark';

const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text hover:border-[#c9c4b9]';

const viewToggleButtonClass =
  'inline-flex cursor-pointer items-center gap-s2 rounded-[4px] border-0 px-s3 py-1.5 text-[0.85rem] font-medium';

const selectClass =
  'w-auto rounded-control border border-border bg-surface px-s3 py-[9px] text-inherit [font:inherit] max-[640px]:w-full max-[640px]:grow max-[640px]:shrink max-[640px]:basis-full';

const iconButtonClass =
  'lb-opportunity-icon-action inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark';

const tableHeadCellClass =
  'border-b border-border bg-table-head px-s4 py-s3 text-left text-[0.78rem] uppercase tracking-[0.04em] text-muted';

const tableRowClass =
  'max-[640px]:mb-s3 max-[640px]:block max-[640px]:rounded-card max-[640px]:border max-[640px]:border-border max-[640px]:bg-surface max-[640px]:px-s4 max-[640px]:py-s2 max-[640px]:shadow-card';

const tableCellClass =
  'border-b border-border px-s4 py-s3 text-left max-[640px]:flex max-[640px]:justify-between max-[640px]:gap-s3 max-[640px]:border-b-0 max-[640px]:px-0 max-[640px]:py-s1 max-[640px]:text-right max-[640px]:before:content-[attr(data-label)] max-[640px]:before:text-left max-[640px]:before:text-[0.82rem] max-[640px]:before:text-muted';

const actionsCellClass =
  'whitespace-nowrap border-b border-border px-s4 py-s3 text-right max-[640px]:mt-s2 max-[640px]:flex max-[640px]:justify-end max-[640px]:gap-s3 max-[640px]:border-b-0 max-[640px]:border-t max-[640px]:border-border max-[640px]:px-0 max-[640px]:pt-s2 max-[640px]:pb-s1 max-[640px]:before:content-none';

const checkboxClass = 'h-4 w-4 cursor-pointer accent-[#2f7f79]';

const bulkToolbarClass =
  'mb-s4 flex flex-wrap items-center gap-s2 rounded-card border border-border bg-surface p-s3 shadow-card';

const bulkApplyButtonClass = `${primaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`;

const bulkStatusSelectClass =
  'w-auto rounded-control border border-border bg-surface px-s3 py-[9px] text-inherit [font:inherit] max-[640px]:grow';

const bulkDeleteButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-danger/40 bg-surface px-s4 py-[9px] font-medium text-danger hover:border-danger hover:bg-status-rejected';

export function Opportunities({
  items,
  onAdd,
  onOpen,
  onEdit,
  onDelete,
  onStatusChange,
  selectionResetToken,
  onBulkArchive,
  onBulkRestore,
  onBulkStatus,
  onBulkDelete,
}: Props) {
  const [filters, setFilters] = useState<Filters>({
    query: '',
    type: 'All',
    status: 'All',
    priority: 'All',
    tag: '',
    sort: 'asc',
  });
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active');
  /**
   * Selection is a set of stable opportunity IDs, never row indexes. Only IDs
   * that are still visible in the current Active/Archived view and filter are
   * eligible; stale IDs are ignored rather than acted on.
   */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [bulkStatus, setBulkStatus] = useState<OpportunityStatus | ''>('');
  const masterRef = useRef<HTMLInputElement>(null);
  // Archive selection is centralized in the archive utility and applied here
  // once; search, filters, sorting and both presentations then work on it.
  const viewItems =
    archiveView === 'active' ? activeOpportunities(items) : archivedOpportunities(items);
  const visible = applyFilters(viewItems, filters);

  const selectedVisible = visible.filter((o) => selectedIds.has(o.id));
  const selectedVisibleIds = selectedVisible.map((o) => o.id);
  const selectedCount = selectedVisible.length;
  const allVisibleSelected = visible.length > 0 && selectedCount === visible.length;
  const someVisibleSelected = selectedCount > 0 && !allVisibleSelected;
  const statusChangeCount = bulkStatus
    ? selectedVisible.filter((o) => o.status !== bulkStatus).length
    : 0;

  // The master checkbox is the only tri-state control; keep its DOM property
  // in sync because `indeterminate` has no HTML attribute.
  useEffect(() => {
    if (masterRef.current) masterRef.current.indeterminate = someVisibleSelected;
  }, [someVisibleSelected]);

  // A committed bulk operation bumps the token; a failed write does not, so
  // the selection survives for a retry.
  useEffect(() => {
    if (selectionResetToken === 0) return;
    setSelectedIds(new Set());
    setBulkStatus('');
  }, [selectionResetToken]);

  // Drop IDs whose records no longer exist at all. IDs that merely left the
  // current filter/view are already excluded by the derived selection below.
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set(
        [...previous].filter((id) => items.some((item) => item.id === id)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [items]);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkStatus('');
  };

  /**
   * Applying a view restores the page configuration and always clears
   * selection, even when the current settings already match the saved view.
   */
  const applySavedView = (settings: SavedViewSettings) => {
    setFilters({ ...settings.filters });
    setArchiveView(settings.archiveView);
    setViewMode(settings.viewMode);
    clearSelection();
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds(checked ? new Set(visible.map((o) => o.id)) : new Set());
  };

  /**
   * Changing search, filters or sorting changes the visible result set, so the
   * selection is cleared rather than silently keeping hidden records selected.
   */
  const updateFilters = (next: Filters) => {
    setFilters(next);
    clearSelection();
  };

  const changeArchiveView = (next: 'active' | 'archived') => {
    if (next === archiveView) return;
    setArchiveView(next);
    clearSelection();
  };

  const changeViewMode = (next: 'list' | 'board') => {
    if (next === viewMode) return;
    setViewMode(next);
    if (next === 'board') clearSelection();
  };
  const filtering =
    filters.query !== '' ||
    filters.type !== 'All' ||
    filters.status !== 'All' ||
    filters.priority !== 'All' ||
    filters.tag !== '';
  const tagOptions = collectTags(viewItems);
  // Keep an active tag selectable if its last record was just edited away.
  if (filters.tag && !tagOptions.includes(filters.tag)) {
    tagOptions.push(filters.tag);
    tagOptions.sort((a, b) => a.localeCompare(b));
  }
  const emptyMessage =
    viewItems.length > 0
      ? 'No opportunities match your search or filters.'
      : archiveView === 'archived'
        ? 'No archived opportunities.'
        : items.length > 0
          ? 'No active opportunities. Switch to Archived to review archived records.'
          : 'You have no opportunities yet.';
  const savedViewSettings: SavedViewSettings = { filters, archiveView, viewMode };
  const emptyState = (
    <div className="mb-s4 rounded-card border border-border bg-surface p-s5 text-center text-muted shadow-card">
      <p>{emptyMessage}</p>
      {filtering && (
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() =>
            updateFilters({ ...filters, query: '', type: 'All', status: 'All', priority: 'All', tag: '' })
          }
        >
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <>
      <header className="mb-s5 flex flex-wrap items-start justify-between gap-s4">
        <div>
          <h1>Opportunities</h1>
          <p className="text-[0.9rem] text-muted">Search, filter and manage everything you are tracking.</p>
        </div>
        <button type="button" className={primaryButtonClass} onClick={(e) => onAdd(e.currentTarget)}>
          <Plus size={16} aria-hidden /> Add Opportunity
        </button>
      </header>

      <SavedViews currentSettings={savedViewSettings} onApply={applySavedView} />

      <div className="mb-s4 flex flex-wrap items-center gap-s2">
        <span className="text-[0.85rem] font-medium text-muted">Show</span>
        <div
          className="inline-flex rounded-control border border-border bg-surface p-0.5 shadow-card"
          role="group"
          aria-label="Archive status"
        >
          <button
            type="button"
            className={`${viewToggleButtonClass} ${
              archiveView === 'active'
                ? 'bg-accent text-white'
                : 'bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark'
            }`}
            aria-pressed={archiveView === 'active'}
            onClick={() => changeArchiveView('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`${viewToggleButtonClass} ${
              archiveView === 'archived'
                ? 'bg-accent text-white'
                : 'bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark'
            }`}
            aria-pressed={archiveView === 'archived'}
            onClick={() => changeArchiveView('archived')}
          >
            Archived
          </button>
        </div>
      </div>

      <div className="mb-s4 flex flex-wrap items-center gap-s2">
        <span className="text-[0.85rem] font-medium text-muted">View</span>
        <div
          className="inline-flex rounded-control border border-border bg-surface p-0.5 shadow-card"
          role="group"
          aria-label="Opportunity view"
        >
          <button
            type="button"
            className={`${viewToggleButtonClass} ${
              viewMode === 'list'
                ? 'bg-accent text-white'
                : 'bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark'
            }`}
            aria-label="List view"
            aria-pressed={viewMode === 'list'}
            onClick={() => changeViewMode('list')}
          >
            <List size={15} aria-hidden /> List view
          </button>
          <button
            type="button"
            className={`${viewToggleButtonClass} ${
              viewMode === 'board'
                ? 'bg-accent text-white'
                : 'bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark'
            }`}
            aria-label="Board view"
            aria-pressed={viewMode === 'board'}
            onClick={() => changeViewMode('board')}
          >
            <Columns3 size={15} aria-hidden /> Board view
          </button>
        </div>
      </div>

      <div className="mb-s4 flex flex-wrap gap-s2">
        <div className="relative grow shrink basis-[220px] text-muted">
          <Search size={16} aria-hidden className="absolute left-s3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search by title or company"
            placeholder="Search title or company"
            value={filters.query}
            onChange={(e) => updateFilters({ ...filters, query: e.target.value })}
            className="w-full rounded-control border border-border bg-surface py-[9px] pr-s3 pl-9 text-inherit [font:inherit]"
          />
        </div>
        <select
          aria-label="Filter by type"
          value={filters.type}
          onChange={(e) => {
            const t = OPPORTUNITY_TYPES.find((x) => x === e.target.value);
            updateFilters({ ...filters, type: t ?? 'All' });
          }}
          className={selectClass}
        >
          <option value="All">All types</option>
          {OPPORTUNITY_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) => {
            const s = OPPORTUNITY_STATUSES.find((x) => x === e.target.value);
            updateFilters({ ...filters, status: s ?? 'All' });
          }}
          className={selectClass}
        >
          <option value="All">All statuses</option>
          {OPPORTUNITY_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          value={filters.priority}
          onChange={(e) => {
            const p = PRIORITIES.find((x) => x === e.target.value);
            updateFilters({ ...filters, priority: p ?? 'All' });
          }}
          className={selectClass}
        >
          <option value="All">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select
          aria-label="Filter by tag"
          value={filters.tag}
          onChange={(e) => updateFilters({ ...filters, tag: e.target.value })}
          className={selectClass}
        >
          <option value="">All tags</option>
          {tagOptions.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${secondaryButtonClass} max-[640px]:w-full max-[640px]:grow max-[640px]:shrink max-[640px]:basis-full`}
          onClick={() => updateFilters({ ...filters, sort: filters.sort === 'asc' ? 'desc' : 'asc' })}
        >
          <ArrowDownUp size={16} aria-hidden /> Deadline: {filters.sort === 'asc' ? 'earliest' : 'latest'} first
        </button>
      </div>

      {viewMode === 'list' && selectedCount > 0 && (
        <div className={bulkToolbarClass} role="region" aria-label="Bulk actions">
          <p className="m-0 text-[0.88rem] font-semibold" aria-live="polite">
            {selectedCount} selected
          </p>

          {archiveView === 'active' ? (
            <>
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={(e) => onBulkArchive(selectedVisibleIds, e.currentTarget)}
              >
                <Archive size={16} aria-hidden /> Archive selected
              </button>
              <select
                aria-label="New status for selected opportunities"
                value={bulkStatus}
                onChange={(e) => {
                  const next = OPPORTUNITY_STATUSES.find((s) => s === e.target.value);
                  setBulkStatus(next ?? '');
                }}
                className={bulkStatusSelectClass}
              >
                <option value="">Change status…</option>
                {OPPORTUNITY_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <button
                type="button"
                className={bulkApplyButtonClass}
                disabled={!bulkStatus || statusChangeCount === 0}
                aria-describedby={
                  bulkStatus && statusChangeCount > 0 ? undefined : 'bulk-status-hint'
                }
                onClick={(e) => {
                  if (bulkStatus) onBulkStatus(selectedVisibleIds, bulkStatus, e.currentTarget);
                }}
              >
                Apply status
              </button>
              {(!bulkStatus || statusChangeCount === 0) && (
                <span id="bulk-status-hint" className="text-[0.78rem] text-muted">
                  {!bulkStatus
                    ? 'Choose a status to enable Apply status.'
                    : 'All selected already have this status.'}
                </span>
              )}
            </>
          ) : (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={(e) => onBulkRestore(selectedVisibleIds, e.currentTarget)}
            >
              <RotateCcw size={16} aria-hidden /> Restore selected
            </button>
          )}

          <button
            type="button"
            className={bulkDeleteButtonClass}
            onClick={(e) => onBulkDelete(selectedVisibleIds, archiveView, e.currentTarget)}
          >
            <Trash2 size={16} aria-hidden /> Delete selected
          </button>

          <button type="button" className={secondaryButtonClass} onClick={clearSelection}>
            Clear selection
          </button>
        </div>
      )}

      {viewMode === 'list' ? (
        visible.length === 0 ? (
          emptyState
        ) : (
          <div className="lb-opportunity-list-wrapper overflow-x-auto rounded-card border border-border bg-surface shadow-card max-[640px]:overflow-visible max-[640px]:rounded-none max-[640px]:border-0 max-[640px]:bg-transparent max-[640px]:shadow-none">
            <table className="lb-opportunity-list-table w-full border-collapse max-[640px]:block">
              <thead className="max-[640px]:block">
                <tr className="max-[640px]:flex max-[640px]:items-center">
                  <th scope="col" className={tableHeadCellClass + ' lb-opportunity-heading-cell'}>
                    <label className="lb-opportunity-select-all-control">
                      <input
                        ref={masterRef}
                        type="checkbox"
                        className={checkboxClass}
                        aria-label="Select all visible opportunities"
                        checked={allVisibleSelected}
                        onChange={(e) => toggleAllVisible(e.target.checked)}
                      />
                      <span className="hidden max-[640px]:inline">Select all</span>
                    </label>
                    <span className="max-[640px]:hidden">Opportunity</span>
                  </th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>Company</th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>Type / Priority</th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>Status</th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>Tags</th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>Dates</th>
                  <th scope="col" className={`${tableHeadCellClass} max-[640px]:hidden`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="max-[640px]:block [&>tr:last-child>td]:border-b-0">
                {visible.map((o) => (
                  <tr
                    key={o.id}
                    className={`${tableRowClass} ${selectedIds.has(o.id) ? 'bg-accent-soft/40' : ''}`}
                  >
                    <td data-label="Opportunity" className={tableCellClass + ' lb-opportunity-title-cell'}>
                      <div className="lb-opportunity-title-content">
                        <label className="lb-opportunity-select-control">
                          <input
                            type="checkbox"
                            className={checkboxClass + ' lb-opportunity-row-checkbox'}
                            aria-label={'Select ' + o.title}
                            checked={selectedIds.has(o.id)}
                            onChange={(e) => toggleSelected(o.id, e.target.checked)}
                          />
                          <span>Select</span>
                        </label>
                        <div className="lb-opportunity-title-copy">
                          <strong>{o.title}</strong> {archiveView === 'archived' && <ArchivedBadge />}{' '}
                          {o.isDemo && <DemoTag />}
                        </div>
                      </div>
                    </td>
                    <td data-label="Company" className={tableCellClass}>{o.company}</td>
                    <td data-label="Type / Priority" className={tableCellClass}>
                      <div className="flex flex-wrap items-center gap-s1 max-[640px]:justify-end">
                        <span>{o.type}</span>
                        <PriorityBadge priority={o.priority} />
                      </div>
                    </td>
                    <td data-label="Status" className={tableCellClass}>
                      <StatusBadge status={o.status} />
                    </td>
                    <td data-label="Tags" className={tableCellClass}>
                      {o.tags.length > 0 ? (
                        <TagList tags={o.tags} limit={3} className="max-[640px]:justify-end" />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td data-label="Dates" className={tableCellClass}>
                      <div className="grid gap-s1 max-[640px]:text-right">
                        <div className="flex flex-wrap items-center gap-s1 max-[640px]:justify-end">
                          <span className="text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                            Deadline
                          </span>
                          <span>{formatDate(o.deadline)}</span>
                        </div>
                        {o.followUpDate && (
                          <div className="flex flex-wrap items-center gap-s1 max-[640px]:justify-end">
                            <span className="text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                              Follow-up
                            </span>
                            <span>{formatDate(o.followUpDate)}</span>
                            <FollowUpBadge date={o.followUpDate} />
                          </div>
                        )}
                      </div>
                    </td>
                    <td data-label="Actions" className={actionsCellClass}>
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={`View ${o.title}`}
                        onClick={(e) => onOpen(o, e.currentTarget)}
                      >
                        <Eye size={16} />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={`Edit ${o.title}`}
                        onClick={(e) => onEdit(o, e.currentTarget)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className={iconButtonClass}
                        aria-label={`Delete ${o.title}`}
                        onClick={(e) => onDelete(o, e.currentTarget)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {visible.length === 0 && emptyState}
          <OpportunityBoard
            items={visible}
            filtering={filtering}
            onOpen={onOpen}
            onEdit={onEdit}
            onDelete={onDelete}
            onStatusChange={onStatusChange}
          />
        </>
      )}
    </>
  );
}

import { useEffect, useState, type DragEvent } from 'react';
import { BellRing, CalendarDays, Eye, GripVertical, Pencil, Trash2 } from 'lucide-react';
import {
  OPPORTUNITY_STATUSES,
  type Opportunity,
  type OpportunityStatus,
} from '../types/opportunity';
import { isArchived } from '../utils/archive';
import { formatDate } from '../utils/dates';
import {
  ArchivedBadge,
  DeadlineBadge,
  DemoTag,
  FollowUpBadge,
  PriorityBadge,
  StatusBadge,
  TagList,
  TypeBadge,
} from './Badges';

interface Props {
  /** Already filtered and sorted by the Opportunities page. */
  items: Opportunity[];
  filtering: boolean;
  /** The optional second argument is the control that opened the dialog. */
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onEdit: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onDelete: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onStatusChange: (id: string, status: OpportunityStatus) => void;
}

const statusDotClass: Record<OpportunityStatus, string> = {
  Saved: 'bg-muted',
  Applied: 'bg-status-applied-text',
  Interview: 'bg-warn',
  Offer: 'bg-accent',
  Rejected: 'bg-danger',
};

const iconButtonClass =
  'inline-grid h-[30px] w-[30px] cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-accent-soft hover:text-accent-dark';

const selectClass =
  'min-w-0 flex-1 rounded-control border border-border bg-surface px-s2 py-1 text-[0.82rem] text-inherit [font:inherit]';

export function OpportunityBoard({
  items,
  filtering,
  onOpen,
  onEdit,
  onDelete,
  onStatusChange,
}: Props) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<OpportunityStatus | null>(null);
  /** Restores keyboard focus to the moved card's selector when it changes columns. */
  const [focusAfterMove, setFocusAfterMove] = useState<string | null>(null);
  const [selectedMobileStatus, setSelectedMobileStatus] = useState<OpportunityStatus>(
    () => OPPORTUNITY_STATUSES.find((status) => items.some((item) => item.status === status))
      ?? OPPORTUNITY_STATUSES[0],
  );

  useEffect(() => {
    if (!focusAfterMove) return;
    const select = document.getElementById(`board-status-${focusAfterMove}`);
    if (select) select.focus();
    else document.getElementById('main-content')?.focus();
    setFocusAfterMove(null);
  }, [items, focusAfterMove]);

  const moveStatus = (id: string, status: OpportunityStatus) => {
    const item = items.find((o) => o.id === id);
    if (!item || item.status === status) return;
    onStatusChange(id, status);
  };

  const changeFromSelect = (item: Opportunity, status: OpportunityStatus) => {
    if (item.status === status) return;
    moveStatus(item.id, status);
    setFocusAfterMove(item.id);
  };

  const startDrag = (event: DragEvent<HTMLLIElement>, item: Opportunity) => {
    // Let the card's buttons, links, and status selector keep their own behavior.
    if ((event.target as HTMLElement).closest('button, select, label, a, input')) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('text/plain', item.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(item.id);
  };

  const dropOnColumn = (event: DragEvent<HTMLElement>, status: OpportunityStatus) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggingId;
    setDraggingId(null);
    setDragOverStatus(null);
    if (id && items.some((o) => o.id === id)) moveStatus(id, status);
  };

  return (
    <>
      <p className="lb-board-instructions mb-s3 text-[0.85rem] text-muted">
        Use each card’s status selector to move an opportunity. Drag and drop is available on larger screens.
      </p>
      <div className="lb-board-mobile-selector" role="group" aria-label="Filter board by status">
        {OPPORTUNITY_STATUSES.map((status) => {
          const count = items.filter((item) => item.status === status).length;
          return (
            <button
              key={status}
              type="button"
              className="lb-board-mobile-selector-button"
              aria-label={status + ': ' + count + ' ' + (count === 1 ? 'opportunity' : 'opportunities')}
              aria-pressed={selectedMobileStatus === status}
              onClick={() => setSelectedMobileStatus(status)}
            >
              <span>{status}</span>
              <strong aria-hidden="true">{count}</strong>
            </button>
          );
        })}
      </div>
      <div
        className="lb-board-columns grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-s3"
        role="group"
        aria-label="Opportunity status columns"
        data-selected-status={selectedMobileStatus}
      >
        {OPPORTUNITY_STATUSES.map((status) => {
          const columnItems = items.filter((o) => o.status === status);
          const headingId = `board-column-${status}`;
          const isDropTarget = dragOverStatus === status;

          return (
            <section
              key={status}
              aria-labelledby={headingId}
              data-board-status={status}
              className={`flex min-h-[150px] flex-col rounded-card border bg-table-head ${
                isDropTarget ? 'border-accent ring-2 ring-accent/25' : 'border-border'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                if (!draggingId) return;
                event.dataTransfer.dropEffect = 'move';
                setDragOverStatus(status);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragOverStatus((current) => (current === status ? null : current));
                }
              }}
              onDrop={(event) => dropOnColumn(event, status)}
            >
              <div className="flex items-center justify-between gap-s2 border-b border-border px-s3 py-s3">
                <h2 id={headingId} className="m-0 flex min-w-0 items-center gap-s2 text-[0.92rem]">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-pill ${statusDotClass[status]}`}
                    aria-hidden
                  />
                  <span className="truncate">{status}</span>
                </h2>
                <span
                  className="shrink-0 rounded-pill border border-border bg-surface px-s2 py-0.5 text-[0.78rem] font-semibold text-muted"
                  aria-label={`${columnItems.length} ${
                    columnItems.length === 1 ? 'opportunity' : 'opportunities'
                  }`}
                >
                  {columnItems.length}
                </span>
              </div>

              {columnItems.length === 0 ? (
                <p className="m-s3 rounded-control border border-dashed border-border px-s3 py-s4 text-center text-[0.82rem] text-muted">
                  {filtering ? 'No matching opportunities.' : 'No opportunities in this status.'}
                </p>
              ) : (
                <ul className="flex flex-1 flex-col gap-s3 p-s3">
                  {columnItems.map((o) => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={(event) => startDrag(event, o)}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setDragOverStatus(null);
                      }}
                      className={`cursor-grab rounded-card border border-border bg-surface p-s3 shadow-card active:cursor-grabbing ${
                        draggingId === o.id ? 'opacity-60' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-s2">
                        <div className="min-w-0">
                          <p className="m-0 font-semibold leading-snug [overflow-wrap:anywhere]">
                            {o.title}
                          </p>
                          <p className="m-0 text-[0.85rem] text-muted [overflow-wrap:anywhere]">
                            {o.company}
                          </p>
                        </div>
                        <GripVertical
                          size={14}
                          aria-hidden
                          className="shrink-0 text-muted/70"
                        />
                      </div>

                      <div className="mt-s2 flex flex-wrap items-center gap-s2">
                        <PriorityBadge priority={o.priority} />
                        <StatusBadge status={o.status} />
                        <TypeBadge type={o.type} />
                        {isArchived(o) && <ArchivedBadge />}
                        {o.isDemo && <DemoTag />}
                      </div>

                      <TagList tags={o.tags} limit={2} className="mt-s2" />

                      {o.deadline && (
                        <p className="m-0 mt-s2 flex flex-wrap items-center gap-s2 text-[0.82rem] text-muted">
                          <CalendarDays size={14} aria-hidden />
                          <span>{formatDate(o.deadline)}</span>
                          {o.status !== 'Rejected' && o.status !== 'Offer' && (
                            <DeadlineBadge deadline={o.deadline} />
                          )}
                        </p>
                      )}

                      {o.followUpDate && (
                        <p className="m-0 mt-s2 flex flex-wrap items-center gap-s2 text-[0.82rem] text-muted">
                          <BellRing size={14} aria-hidden />
                          <span>Follow-up {formatDate(o.followUpDate)}</span>
                          <FollowUpBadge date={o.followUpDate} />
                        </p>
                      )}

                      <div className="mt-s3 grid gap-s2 border-t border-border pt-s3">
                        <div className="flex items-center gap-s2">
                          <label
                            htmlFor={`board-status-${o.id}`}
                            className="text-[0.78rem] font-medium text-muted"
                          >
                            Status
                          </label>
                          <select
                            id={`board-status-${o.id}`}
                            aria-label={`Change status for ${o.title}`}
                            value={o.status}
                            onChange={(event) => {
                              const next = OPPORTUNITY_STATUSES.find(
                                (s) => s === event.target.value,
                              );
                              if (next) changeFromSelect(o, next);
                            }}
                            draggable={false}
                            className={selectClass}
                          >
                            {OPPORTUNITY_STATUSES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex justify-end gap-s1">
                          <button
                            type="button"
                            draggable={false}
                            className={iconButtonClass}
                            aria-label={`View ${o.title}`}
                            onClick={(e) => onOpen(o, e.currentTarget)}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            draggable={false}
                            className={iconButtonClass}
                            aria-label={`Edit ${o.title}`}
                            onClick={(e) => onEdit(o, e.currentTarget)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            draggable={false}
                            className={iconButtonClass}
                            aria-label={`Delete ${o.title}`}
                            onClick={(e) => onDelete(o, e.currentTarget)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

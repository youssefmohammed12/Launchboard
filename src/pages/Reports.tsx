import type { ReactNode } from 'react';
import {
  Activity,
  Briefcase,
  CalendarCheck,
  FileJson,
  FileSpreadsheet,
  Flag,
  History,
  LoaderCircle,
  MessagesSquare,
  Upload,
} from 'lucide-react';
import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  SYSTEM_ACTIVITY_TYPE,
  type ActivityEntry,
  type Opportunity,
  type OpportunityStatus,
  type Priority,
} from '../types/opportunity';
import { activeOpportunities } from '../utils/archive';
import { formatDate } from '../utils/dates';
import { downloadCsv, downloadJsonBackup } from '../utils/exports';
import { PriorityBadge, StatusBadge, TypeBadge } from '../components/Badges';

interface Props {
  items: Opportunity[];
  /** The optional second argument is the control that opened the dialog. */
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  /** Opens the JSON restore dialog; the button is passed for focus restoration. */
  onRestoreBackup: (trigger?: HTMLElement | null) => void;
}

const IN_PROGRESS_STATUSES: readonly OpportunityStatus[] = ['Saved', 'Applied', 'Interview'];

const statusBarClass: Record<OpportunityStatus, string> = {
  Saved: 'bg-badge-text',
  Applied: 'bg-status-applied-text',
  Interview: 'bg-warn',
  Offer: 'bg-accent',
  Rejected: 'bg-danger',
};

const priorityBarClass: Record<Priority, string> = {
  Low: 'bg-badge-text',
  Medium: 'bg-warn',
  High: 'bg-danger',
};

const exportButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 whitespace-nowrap rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text shadow-card hover:border-[#c9c4b9] hover:text-accent-dark';

function proportion(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100;
}

function proportionLabel(count: number, total: number): string {
  const value = proportion(count, total);
  return count > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`;
}

/** Missing or invalid priorities are treated as Medium, matching storage repair. */
function normalizedPriority(priority: Priority): Priority {
  return PRIORITIES.find((value) => value === priority) ?? 'Medium';
}

interface RecentEntry {
  opportunity: Opportunity;
  activity: ActivityEntry;
  sequence: number;
}

/**
 * Flattens activity across opportunities. There is no global activity
 * timestamp, so the later opportunity/activity position in the append-only
 * store is used as the closest available "most recently added" tie-breaker.
 */
function recentActivity(items: Opportunity[], limit = 8): RecentEntry[] {
  const entries: RecentEntry[] = [];
  let sequence = 0;
  for (const opportunity of items) {
    for (const activity of opportunity.activities) {
      entries.push({ opportunity, activity, sequence });
      sequence += 1;
    }
  }
  return entries
    .sort(
      (a, b) =>
        b.activity.date.localeCompare(a.activity.date) || b.sequence - a.sequence,
    )
    .slice(0, limit);
}

interface BreakdownRowProps {
  label: ReactNode;
  count: number;
  total: number;
  barClass: string;
}

function BreakdownRow({ label, count, total, barClass }: BreakdownRowProps) {
  const percent = proportion(count, total);
  return (
    <li className="grid gap-s2">
      <div className="flex flex-wrap items-center justify-between gap-x-s3 gap-y-s1">
        <span className="min-w-0">{label}</span>
        <span className="text-[0.9rem] text-muted">
          <span className="font-semibold text-text">{count}</span>
          <span aria-hidden="true"> · </span>
          {proportionLabel(count, total)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-table-head" aria-hidden="true">
        <div className={`h-full rounded-pill ${barClass}`} style={{ width: `${percent}%` }} />
      </div>
    </li>
  );
}

function EmptySection({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-control border border-dashed border-border p-s4 text-center text-[0.88rem] text-muted">
      {children}
    </p>
  );
}

export function Reports({ items, onOpen, onRestoreBackup }: Props) {
  // Reports summarise the active working portfolio. Exports still receive the
  // complete collection so archived records are never silently omitted.
  const active = activeOpportunities(items);
  const total = active.length;
  const cards = [
    {
      label: 'Total Opportunities',
      value: total,
      hint: 'Active records only',
      icon: Briefcase,
    },
    {
      label: 'In Progress',
      value: active.filter((o) => IN_PROGRESS_STATUSES.includes(o.status)).length,
      hint: 'Saved, Applied or Interview',
      icon: LoaderCircle,
    },
    {
      label: 'In Interviews',
      value: active.filter((o) => o.status === 'Interview').length,
      hint: 'Current status',
      icon: MessagesSquare,
    },
    {
      label: 'Offers',
      value: active.filter((o) => o.status === 'Offer').length,
      hint: 'Current status',
      icon: CalendarCheck,
    },
    {
      label: 'High Priority',
      value: active.filter((o) => normalizedPriority(o.priority) === 'High').length,
      hint: 'Priority set to High',
      icon: Flag,
    },
  ];

  const statusCounts = OPPORTUNITY_STATUSES.map((status) => ({
    status,
    count: active.filter((o) => o.status === status).length,
  }));
  const typeCounts = OPPORTUNITY_TYPES.map((type) => ({
    type,
    count: active.filter((o) => o.type === type).length,
  }));
  const priorityCounts = PRIORITIES.map((priority) => ({
    priority,
    count: active.filter((o) => normalizedPriority(o.priority) === priority).length,
  }));
  const recent = recentActivity(active);

  return (
    <>
      <header className="mb-s5 flex flex-wrap items-start justify-between gap-s4">
        <div className="min-w-0 max-w-[620px]">
          <h1>Reports</h1>
          <p className="mb-s1 text-[0.9rem] text-muted">
            A snapshot of your active opportunities and recent activity. Archived records are
            excluded from these totals.
          </p>
          <p className="m-0 text-[0.8rem] text-muted">
            CSV is intended for spreadsheets and tabular analysis. JSON backup preserves the
            complete opportunity records, nested activity history, interviews, contacts,
            application materials and valid contact links, and can be restored here. Both
            exports include archived records; CSV keeps its existing columns, so use JSON to
            inspect archive state.
          </p>
          <p className="m-0 mt-s1 text-[0.78rem] text-muted">
            Files are generated and read locally in your browser and are never uploaded.
          </p>
        </div>
        <div className="flex flex-wrap gap-s2" role="group" aria-label="Export and restore data">
          <button
            type="button"
            className={exportButtonClass}
            onClick={() => downloadCsv(items)}
          >
            <FileSpreadsheet size={16} aria-hidden className="text-accent" />
            Export CSV
          </button>
          <button
            type="button"
            className={exportButtonClass}
            onClick={() => downloadJsonBackup(items)}
          >
            <FileJson size={16} aria-hidden className="text-accent" />
            Download JSON Backup
          </button>
          <button
            type="button"
            className={exportButtonClass}
            onClick={(event) => onRestoreBackup(event.currentTarget)}
          >
            <Upload size={16} aria-hidden className="text-accent" />
            Restore JSON Backup
          </button>
        </div>
      </header>

      <section
        className="mb-s5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-s4"
        aria-label="Summary"
      >
        {cards.map(({ label, value, hint, icon: Icon }) => (
          <div
            className="rounded-card border border-border bg-surface p-s4 text-accent-dark shadow-card"
            key={label}
          >
            <Icon size={18} aria-hidden className="inline align-baseline" />
            <p className="m-0 text-[2rem] font-bold leading-[1.2] text-text">{value}</p>
            <p className="m-0 text-[0.85rem] font-medium text-text">{label}</p>
            <p className="m-0 mt-s1 text-[0.75rem] leading-snug text-muted">{hint}</p>
          </div>
        ))}
      </section>

      <section
        className="mb-s4 rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
        aria-labelledby="status-breakdown-h"
      >
        <h2 id="status-breakdown-h">Status breakdown</h2>
        {total === 0 ? (
          <EmptySection>
            No opportunities yet. Status totals will appear once you add a record.
          </EmptySection>
        ) : (
          <ul className="m-0 grid list-none gap-s3 p-0">
            {statusCounts.map(({ status, count }) => (
              <BreakdownRow
                key={status}
                label={<StatusBadge status={status} />}
                count={count}
                total={total}
                barClass={statusBarClass[status]}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="mb-s4 grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-s4">
        <section
          className="rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
          aria-labelledby="type-breakdown-h"
        >
          <h2 id="type-breakdown-h">Opportunity types</h2>
          {total === 0 ? (
            <EmptySection>
              No opportunities yet. Type distribution will appear once you add a record.
            </EmptySection>
          ) : (
            <ul className="m-0 grid list-none gap-s3 p-0">
              {typeCounts.map(({ type, count }) => (
                <BreakdownRow
                  key={type}
                  label={<TypeBadge type={type} />}
                  count={count}
                  total={total}
                  barClass="bg-accent"
                />
              ))}
            </ul>
          )}
        </section>

        <section
          className="rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
          aria-labelledby="priority-breakdown-h"
        >
          <h2 id="priority-breakdown-h">Priority distribution</h2>
          {total === 0 ? (
            <EmptySection>
              No opportunities yet. Priority levels will appear once you add a record.
            </EmptySection>
          ) : (
            <ul className="m-0 grid list-none gap-s3 p-0">
              {priorityCounts.map(({ priority, count }) => (
                <BreakdownRow
                  key={priority}
                  label={<PriorityBadge priority={priority} />}
                  count={count}
                  total={total}
                  barClass={priorityBarClass[priority]}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section
        className="rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
        aria-labelledby="recent-activity-h"
      >
        <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s2">
          <h2 id="recent-activity-h" className="m-0">
            Recent activity
          </h2>
          {recent.length > 0 && (
            <span className="text-[0.8rem] text-muted">
              Latest {recent.length} {recent.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
        {recent.length === 0 ? (
          <EmptySection>
            No activity yet. Log an update or change an opportunity status to start the history.
          </EmptySection>
        ) : (
          <ul className="m-0 grid list-none gap-s2 p-0">
            {recent.map(({ opportunity, activity }) => {
              const isSystem = activity.type === SYSTEM_ACTIVITY_TYPE;
              return (
                <li key={`${opportunity.id}:${activity.id}`}>
                  <button
                    type="button"
                    className={`group flex w-full cursor-pointer items-start gap-s3 rounded-control border p-s3 text-left text-inherit transition-colors [font:inherit] hover:border-[#c9c4b9] ${
                      isSystem
                        ? 'border-accent bg-accent-soft/40 hover:bg-accent-soft/70'
                        : 'border-border bg-surface hover:bg-table-head'
                    }`}
                    onClick={(event) => onOpen(opportunity, event.currentTarget)}
                  >
                    <span
                      className={`mt-0.5 inline-grid h-8 w-8 shrink-0 place-items-center rounded-pill ${
                        isSystem ? 'bg-surface text-accent-dark' : 'bg-accent-soft text-accent-dark'
                      }`}
                      aria-hidden="true"
                    >
                      {isSystem ? <History size={15} /> : <Activity size={15} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-s2">
                        <span className="font-semibold text-[0.9rem] group-hover:text-accent-dark">
                          {activity.type}
                        </span>
                        {isSystem && (
                          <span className="rounded-pill bg-surface px-s2 py-0.5 text-[0.72rem] font-semibold text-accent-dark">
                            Automatic
                          </span>
                        )}
                        <span className="text-[0.78rem] text-muted">
                          {formatDate(activity.date)}
                        </span>
                      </span>
                      <span className="mt-s1 block text-[0.88rem] [overflow-wrap:anywhere]">
                        <span className="font-medium">{opportunity.title}</span>
                        <span className="text-muted"> · {opportunity.company}</span>
                      </span>
                      {activity.note && (
                        <span className="mt-s1 block whitespace-pre-wrap text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                          {activity.note}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

import type { Opportunity } from '../types/opportunity';
import { activeDeadlines } from '../utils/opportunities';
import { daysUntil, formatDate } from '../utils/dates';
import { DeadlineBadge, StatusBadge } from '../components/Badges';

interface Props {
  items: Opportunity[];
  /** The optional second argument is the control that opened the dialog. */
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
}

export function Deadlines({ items, onOpen }: Props) {
  const list = activeDeadlines(items);
  // Only records with a parsable deadline reach this page; daysUntil returns
  // null for anything that is not a YYYY-MM-DD calendar date.
  const dated = list.filter((o) => daysUntil(o.deadline) !== null);
  const groups = [
    { title: 'Overdue', rows: dated.filter((o) => (daysUntil(o.deadline) ?? 0) < 0) },
    { title: 'Due today', rows: dated.filter((o) => daysUntil(o.deadline) === 0) },
    { title: 'Upcoming', rows: dated.filter((o) => (daysUntil(o.deadline) ?? 0) > 0) },
  ];
  const groupsWithRows = groups.filter((g) => g.rows.length > 0);

  return (
    <>
      <header className="mb-s5 flex flex-wrap items-start justify-between gap-s4">
        <div>
          <h1>Deadlines</h1>
          <p className="text-[0.9rem] text-muted">
            Active opportunities with a deadline, nearest first. Archived records, offers and
            rejections are hidden.
          </p>
        </div>
      </header>
      {dated.length === 0 ? (
        <div className="mb-s4 rounded-card border border-border bg-surface p-s5 text-center text-muted shadow-card">
          <p>No active deadlines.</p>
        </div>
      ) : (
        groupsWithRows.map((g) => (
          <section
            className="mb-s4 rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
            key={g.title}
            aria-labelledby={`g-${g.title}`}
          >
            <h2 id={`g-${g.title}`}>
              {g.title} <span className="text-[0.9rem] text-muted">({g.rows.length})</span>
            </h2>
            <ul className="divide-y divide-border">
              {g.rows.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="list-btn group flex w-full cursor-pointer items-center justify-between gap-s3 border-0 bg-transparent px-0 py-s3 text-left text-inherit [font:inherit]"
                    onClick={(e) => onOpen(o, e.currentTarget)}
                  >
                    <span className="min-w-0 break-words">
                      <strong className="group-hover:text-accent-dark">{o.title}</strong>
                      <br />
                      <span className="text-[0.9rem] text-muted">
                        {o.company} · {formatDate(o.deadline)}
                      </span>
                    </span>
                    <span className="flex flex-wrap justify-end gap-s2">
                      <StatusBadge status={o.status} />
                      <DeadlineBadge deadline={o.deadline} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

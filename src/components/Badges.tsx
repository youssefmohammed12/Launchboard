import { ArrowDown, ArrowUp, Minus, type LucideIcon } from 'lucide-react';
import { deadlineLabel, followUpLabel, type DeadlineState } from '../utils/dates';
import type { OpportunityStatus, OpportunityType, Priority } from '../types/opportunity';

const badgeBaseClass = 'inline-block whitespace-nowrap rounded-pill px-[10px] py-[2px] text-[0.78rem]';

const statusClass: Record<OpportunityStatus, string> = {
  Saved: 'bg-badge font-semibold text-badge-text',
  Applied: 'bg-status-applied font-semibold text-status-applied-text',
  Interview: 'bg-status-interview font-semibold text-warn',
  Offer: 'bg-accent-soft font-semibold text-accent-dark',
  Rejected: 'bg-status-rejected font-semibold text-danger',
};

const urgencyClass: Record<DeadlineState, string> = {
  overdue: 'bg-status-rejected font-semibold text-danger',
  today: 'bg-status-interview font-semibold text-warn',
  upcoming: 'bg-accent-soft font-semibold text-accent-dark',
};

const priorityBaseClass =
  'inline-flex items-center gap-s1 whitespace-nowrap rounded-pill px-[10px] py-[2px] text-[0.78rem] font-semibold';

const priorityClass: Record<Priority, string> = {
  Low: 'bg-badge text-badge-text',
  Medium: 'bg-status-interview text-warn',
  High: 'bg-status-rejected text-danger',
};

const priorityIcon: Record<Priority, LucideIcon> = {
  Low: ArrowDown,
  Medium: Minus,
  High: ArrowUp,
};

const tagClass =
  'inline-block max-w-full truncate rounded-pill border border-border bg-table-head px-[8px] py-[1px] text-[0.75rem] text-muted';

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  return <span className={`${badgeBaseClass} ${statusClass[status]}`}>{status}</span>;
}

export function TypeBadge({ type }: { type: OpportunityType }) {
  return (
    <span className={`${badgeBaseClass} border border-border bg-table-head font-medium text-muted`}>
      {type}
    </span>
  );
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  const label = deadlineLabel(deadline);
  if (!label) return null;
  return <span className={`${badgeBaseClass} ${urgencyClass[label.state]}`}>{label.text}</span>;
}

export function FollowUpBadge({ date }: { date: string }) {
  const label = followUpLabel(date);
  if (!label) return null;
  return (
    <span className={`${badgeBaseClass} ${urgencyClass[label.state]}`}>
      <span className="sr-only">Follow-up: </span>
      {label.text}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const Icon = priorityIcon[priority];
  return (
    <span className={`${priorityBaseClass} ${priorityClass[priority]}`}>
      <Icon size={12} aria-hidden />
      {priority}
    </span>
  );
}

export function TagBadge({ tag }: { tag: string }) {
  return (
    <span className={tagClass} title={tag}>
      {tag}
    </span>
  );
}

export function TagList({
  tags,
  limit,
  className = '',
}: {
  tags: string[];
  limit?: number;
  className?: string;
}) {
  if (tags.length === 0) return null;
  const shown = typeof limit === 'number' ? tags.slice(0, limit) : tags;
  const remaining = tags.length - shown.length;
  const remainingTags = tags.slice(shown.length);

  return (
    <div className={`flex flex-wrap items-center gap-s1 ${className}`.trim()}>
      {shown.map((tag) => (
        <TagBadge key={tag} tag={tag} />
      ))}
      {remaining > 0 && (
        <span
          className={tagClass}
          title={remainingTags.join(', ')}
          aria-label={`${remaining} more ${remaining === 1 ? 'tag' : 'tags'}: ${remainingTags.join(', ')}`}
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}

export function DemoTag() {
  return (
    <span className={`${badgeBaseClass} border border-dashed border-muted bg-transparent font-medium text-muted`}>
      Demo
    </span>
  );
}

/** Archive state is separate from application status. */
export function ArchivedBadge() {
  return (
    <span className={`${badgeBaseClass} border border-border bg-table-head font-semibold text-muted`}>
      Archived
    </span>
  );
}

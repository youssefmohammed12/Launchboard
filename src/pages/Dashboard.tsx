import { useState } from 'react';
import {
  ArrowRight,
  BellRing,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Clock,
  ClipboardCheck,
  ListTodo,
  MessagesSquare,
  Plus,
  Send,
  type LucideIcon,
} from 'lucide-react';
import type { Opportunity } from '../types/opportunity';
import { activeOpportunities } from '../utils/archive';
import { computeStats } from '../utils/opportunities';
import {
  DASHBOARD_RANGE_DAYS,
  deriveCalendarEvents,
  eventTypeLabel,
  nextDaysEvents,
  type CalendarEvent,
  type CalendarEventType,
} from '../utils/calendar';
import { addDaysToISODate, daysBetweenISODates, formatDate, toISODate } from '../utils/dates';
import { DemoTag, StatusBadge } from '../components/Badges';
import { groupOpportunityTasks, type TaskWithOpportunity } from '@launchboard/domain';

interface Props {
  items: Opportunity[];
  /** The optional second argument is the control that opened the dialog. */
  onAdd: (trigger?: HTMLElement | null) => void;
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  /** Opens the selected task in the Action Center. */
  onOpenTask: (opportunityId: string, taskId: string, trigger?: HTMLElement | null) => void;
  /** Opens the full Action Center. */
  onOpenActionCenter: () => void;
  /** Navigates to the Calendar view for the full schedule. */
  onOpenCalendar: () => void;
}

const MAX_VISIBLE_EVENTS = 5;

const eventVisuals: Record<CalendarEventType, { icon: LucideIcon; badgeClass: string }> = {
  deadline: { icon: CalendarClock, badgeClass: 'bg-status-interview text-warn' },
  'follow-up': { icon: BellRing, badgeClass: 'bg-accent-soft text-accent-dark' },
  task: { icon: ListTodo, badgeClass: 'bg-status-applied text-status-applied-text' },
  interview: {
    icon: MessagesSquare,
    badgeClass: 'bg-status-applied text-status-applied-text',
  },
};

function EventTypeBadge({ type }: { type: CalendarEventType }) {
  const { icon: Icon, badgeClass } = eventVisuals[type];
  return (
    <span
      className={`inline-flex items-center gap-s1 whitespace-nowrap rounded-pill px-[8px] py-[2px] text-[0.74rem] font-semibold ${badgeClass}`}
    >
      <Icon size={11} aria-hidden />
      {eventTypeLabel(type)}
    </span>
  );
}

/** Explicit wording so today/tomorrow never depends on color or date arithmetic alone. */
function relativeDayLabel(date: string, today: string): 'Today' | 'Tomorrow' | null {
  const days = daysBetweenISODates(today, date);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return null;
}

function eventActionLabel(event: CalendarEvent): string {
  if (event.type === 'task') {
    return `Open task ${event.taskTitle} for ${event.opportunityTitle} on ${formatDate(event.date)}`;
  }
  if (event.type === 'interview') {
    const time = event.time ? ` at ${event.time}` : '';
    return `Open ${event.opportunityTitle} for ${event.label} interview (${event.interviewStatus}) on ${formatDate(event.date)}${time}`;
  }
  return `Open ${event.opportunityTitle} for ${eventTypeLabel(event.type).toLowerCase()} on ${formatDate(event.date)}`;
}

interface EventCardProps {
  event: CalendarEvent;
  opportunity: Opportunity;
  today: string;
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
}

function EventCard({ event, opportunity, today, onOpen }: EventCardProps) {
  const relative = relativeDayLabel(event.date, today);

  return (
    <li className="min-w-0">
      <button
        type="button"
        className="group w-full min-w-0 cursor-pointer rounded-control border border-border bg-surface p-s3 text-left text-inherit [font:inherit] hover:border-accent hover:bg-accent-soft/20"
        aria-label={eventActionLabel(event)}
        onClick={(clickEvent) => onOpen(opportunity, clickEvent.currentTarget)}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-s2">
          <EventTypeBadge type={event.type} />
          <span className="inline-flex items-center gap-s1 text-[0.8rem] text-muted">
            <CalendarClock size={12} aria-hidden /> {formatDate(event.date)}
          </span>
          {relative && (
            <span
              className={`inline-block whitespace-nowrap rounded-pill px-[8px] py-[2px] text-[0.72rem] font-semibold ${
                relative === 'Today'
                  ? 'bg-status-interview text-warn'
                  : 'bg-accent-soft text-accent-dark'
              }`}
            >
              {relative}
            </span>
          )}
          {event.type === 'interview' && event.time && (
            <span className="inline-flex items-center gap-s1 text-[0.8rem] text-muted">
              <Clock size={12} aria-hidden /> {event.time}
            </span>
          )}
          {event.type === 'interview' && (
            <span className="rounded-pill border border-border bg-table-head px-[8px] py-[2px] text-[0.72rem] text-muted">
              {event.interviewMode}
            </span>
          )}
        </span>
        <span className="mt-s2 block break-words text-[0.95rem] font-semibold text-text group-hover:text-accent-dark">
          {event.opportunityTitle}
        </span>
        <span className="block break-words text-[0.84rem] text-muted">
          {event.opportunityCompany}
        </span>
        {event.type === 'interview' && (
          <span className="mt-s1 block break-words text-[0.82rem] text-muted">
            Round: {event.label}
          </span>
        )}
        <span className="mt-s2 flex flex-wrap items-center justify-between gap-s2">
          <span className="inline-flex items-center gap-s1 text-[0.82rem] font-semibold text-accent-dark">
            View opportunity <ArrowRight size={13} aria-hidden />
          </span>
          <StatusBadge status={event.opportunityStatus} />
        </span>
      </button>
    </li>
  );
}

export function Dashboard({ items, onAdd, onOpen, onOpenTask, onOpenActionCenter, onOpenCalendar }: Props) {
  const [today] = useState(() => toISODate(new Date()));
  // The Dashboard describes the active working portfolio. Archived records
  // remain available in the Opportunities Archived view and in exports.
  const active = activeOpportunities(items);
  const stats = computeStats(active);
  const cards = [
    { label: 'Total Opportunities', value: stats.total, icon: Briefcase },
    { label: 'Applications Sent', value: stats.applied, icon: Send },
    { label: 'Interviews', value: stats.interviews, icon: MessagesSquare },
    { label: 'Offers', value: stats.offers, icon: CalendarCheck },
  ];
  // New records are appended, so reversing gives newest first.
  const recent = [...active].reverse().slice(0, 5);

  const taskItems: TaskWithOpportunity[] = active.flatMap((opportunity) =>
    opportunity.tasks.map((task) => ({
      task,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      opportunityCompany: opportunity.company,
    })),
  );
  const taskGroups = groupOpportunityTasks(taskItems, today);
  const focusTasks = [...taskGroups.overdue, ...taskGroups.today];
  const visibleFocusTasks = focusTasks.slice(0, MAX_VISIBLE_EVENTS);

  // Keep existing opportunity date events in their own seven-day summary.
  // Task due dates have a separate Today focus and a distinct Calendar type.
  const allEvents = deriveCalendarEvents(active);
  const rangeEvents = nextDaysEvents(allEvents.filter((event) => event.type !== 'task'), today);
  const visibleEvents = rangeEvents.slice(0, MAX_VISIBLE_EVENTS);
  const hiddenCount = rangeEvents.length - visibleEvents.length;
  const upcomingEnd = addDaysToISODate(today, DASHBOARD_RANGE_DAYS - 1) ?? today;
  const opportunitiesById = new Map(active.map((item) => [item.id, item]));

  return (
    <>
      <header className="mb-s5 flex flex-wrap items-start justify-between gap-s4">
        <div>
          <h1>Welcome back</h1>
          <p className="text-[0.9rem] text-muted">
            Here is where your active internships, jobs and freelance projects stand today.
            Archived opportunities are excluded.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark"
          onClick={(e) => onAdd(e.currentTarget)}
        >
          <Plus size={16} aria-hidden /> Add Opportunity
        </button>
      </header>

      <section
        className="mb-s5 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-s4"
        aria-label="Summary"
      >
        {cards.map(({ label, value, icon: Icon }) => (
          <div
            className="rounded-card border border-border bg-surface p-s4 text-accent-dark shadow-card"
            key={label}
          >
            <Icon size={18} aria-hidden className="inline align-baseline" />
            <p className="m-0 text-[2rem] font-bold leading-[1.2] text-text">{value}</p>
            <p className="m-0 text-[0.9rem] text-muted">{label}</p>
          </div>
        ))}
      </section>

      <section className="mb-s4 min-w-0 rounded-card border border-border bg-surface p-s4 shadow-card" aria-labelledby="today-focus-heading">
        <div className="mb-s3 flex flex-wrap items-start justify-between gap-s2">
          <div className="min-w-0">
            <h2 id="today-focus-heading" className="m-0 inline-flex items-center gap-s2">
              <ClipboardCheck size={17} aria-hidden /> Today's Focus
            </h2>
            <p className="mt-s1 mb-0 text-[0.82rem] text-muted">
              Overdue and due-today tasks across active opportunities.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s3 text-[0.82rem] font-medium text-text hover:border-accent"
            onClick={onOpenActionCenter}
          >
            View all actions <ArrowRight size={14} aria-hidden />
          </button>
        </div>

        {focusTasks.length === 0 ? (
          <div className="rounded-control border border-dashed border-border bg-table-head/50 p-s3 text-center">
            <p className="m-0 font-semibold text-text">Nothing overdue or due today.</p>
            <p className="mt-s1 mb-0 text-[0.82rem] text-muted">
              Your next steps are clear for now. Upcoming and unscheduled tasks remain in the Action Center.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-s2 flex flex-wrap items-center gap-s2 text-[0.76rem] font-semibold text-muted">
              <span>{taskGroups.overdue.length} overdue</span>
              <span aria-hidden>·</span>
              <span>{taskGroups.today.length} due today</span>
              <span className="ml-auto">{focusTasks.length} tasks</span>
            </div>
            <ul className="m-0 grid list-none gap-s2 p-0" aria-label="Overdue and due-today tasks">
              {visibleFocusTasks.map((entry) => (
                <FocusTaskCard
                  key={`${entry.opportunityId}:${entry.task.id}`}
                  entry={entry}
                  today={today}
                  onOpenTask={onOpenTask}
                />
              ))}
            </ul>
            {focusTasks.length > visibleFocusTasks.length && (
              <p className="mt-s2 mb-0 text-right text-[0.78rem] text-muted">
                {focusTasks.length - visibleFocusTasks.length} more in the Action Center.
              </p>
            )}
          </>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start gap-s4 max-[1000px]:grid-cols-1">
        <section
          className="min-w-0 rounded-card border border-border bg-surface p-s4 shadow-card"
          aria-labelledby="next-days-h"
        >
          <div className="mb-s3 flex flex-wrap items-start justify-between gap-s2">
            <div className="min-w-0 flex-1">
              <h2 id="next-days-h" className="m-0 inline-flex items-center gap-s2">
                <CalendarDays size={17} aria-hidden /> Next 7 Days
              </h2>
              <p className="mt-s1 mb-0 text-[0.82rem] text-muted">
                Today through {formatDate(upcomingEnd)} · {DASHBOARD_RANGE_DAYS} calendar days
                including today. Past-due items stay in the Calendar.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s3 py-[6px] text-[0.82rem] font-medium text-text hover:border-accent"
              onClick={onOpenCalendar}
            >
              <CalendarDays size={15} aria-hidden /> View calendar
            </button>
          </div>

          {rangeEvents.length === 0 ? (
            <div className="rounded-control border border-dashed border-border bg-table-head/50 p-s4 text-center">
              <p className="m-0 font-semibold text-text">Nothing scheduled in the next 7 days.</p>
              <p className="mt-s1 mb-0 text-[0.85rem] text-muted">
                Deadlines, follow-ups and scheduled interviews appear here automatically.
              </p>
              <button
                type="button"
                className="mt-s3 inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[7px] text-[0.85rem] font-medium text-white hover:bg-accent-dark"
                onClick={onOpenCalendar}
              >
                <CalendarDays size={15} aria-hidden /> Open Calendar
              </button>
            </div>
          ) : (
            <>
              <ul
                className="m-0 grid list-none grid-cols-1 gap-s2 p-0"
                aria-label="Events in the next 7 days"
              >
                {visibleEvents.map((event) => {
                  const opportunity = opportunitiesById.get(event.opportunityId);
                  return opportunity ? (
                    <EventCard
                      key={event.id}
                      event={event}
                      opportunity={opportunity}
                      today={today}
                      onOpen={onOpen}
                    />
                  ) : null;
                })}
              </ul>
              <div className="mt-s3 flex flex-wrap items-center justify-between gap-s2 border-t border-border pt-s3">
                <p className="m-0 text-[0.8rem] text-muted">
                  {hiddenCount > 0
                    ? `Showing ${visibleEvents.length} of ${rangeEvents.length} events.`
                    : `Showing all ${rangeEvents.length} ${
                        rangeEvents.length === 1 ? 'event' : 'events'
                      }.`}
                </p>
                {hiddenCount > 0 && (
                  <span className="text-[0.8rem] text-muted">
                    {hiddenCount} more in the Calendar.
                  </span>
                )}
              </div>
            </>
          )}
        </section>

        <section
          className="min-w-0 rounded-card border border-border bg-surface px-s5 py-s4 shadow-card"
          aria-labelledby="recent-h"
        >
          <h2 id="recent-h">Recent opportunities</h2>
          {recent.length === 0 ? (
            <p className="p-s5 text-center text-muted">
              No opportunities yet. Add your first one to get started.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className="list-btn group flex w-full cursor-pointer items-center justify-between gap-s3 border-0 bg-transparent px-0 py-s3 text-left text-inherit [font:inherit]"
                    onClick={(e) => onOpen(o, e.currentTarget)}
                  >
                    <span className="min-w-0">
                      <strong className="break-words group-hover:text-accent-dark">{o.title}</strong>{' '}
                      {o.isDemo && <DemoTag />}
                      <br />
                      <span className="break-words text-[0.9rem] text-muted">{o.company}</span>
                    </span>
                    <StatusBadge status={o.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

interface FocusTaskCardProps {
  entry: TaskWithOpportunity;
  today: string;
  onOpenTask: Props['onOpenTask'];
}

function FocusTaskCard({ entry, today, onOpenTask }: FocusTaskCardProps) {
  const overdueBy = daysBetweenISODates(entry.task.dueDate, today) ?? 0;
  const timing = overdueBy > 0 ? `Overdue by ${overdueBy} day${overdueBy === 1 ? '' : 's'}` : 'Due today';
  const priorityClass = entry.task.priority === 'High'
    ? 'border-danger/25 bg-danger/5 text-danger'
    : entry.task.priority === 'Low'
      ? 'border-border bg-table-head text-muted'
      : 'border-status-interview/25 bg-status-interview/10 text-warn';

  return (
    <li className="min-w-0">
      <button
        type="button"
        className="group flex min-h-11 w-full min-w-0 cursor-pointer flex-wrap items-center justify-between gap-s2 rounded-control border border-border bg-surface p-s3 text-left text-inherit [font:inherit] hover:border-accent hover:bg-accent-soft/20"
        aria-label={`Open task ${entry.task.title} for ${entry.opportunityTitle}`}
        onClick={(event) => onOpenTask(entry.opportunityId, entry.task.id, event.currentTarget)}
      >
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[0.92rem] font-semibold text-text group-hover:text-accent-dark">{entry.task.title}</span>
          <span className="mt-s1 block break-words text-[0.8rem] text-muted">{entry.opportunityTitle} · {entry.opportunityCompany}</span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-s1">
          <span className={`rounded-pill border px-s2 py-[3px] text-[0.7rem] font-semibold ${priorityClass}`}>{entry.task.priority}</span>
          <span className={`rounded-pill px-s2 py-[3px] text-[0.7rem] font-semibold ${overdueBy > 0 ? 'bg-status-rejected text-danger' : 'bg-status-interview text-warn'}`}>{timing}</span>
          <ArrowRight size={14} className="text-accent-dark" aria-hidden />
        </span>
      </button>
    </li>
  );
}

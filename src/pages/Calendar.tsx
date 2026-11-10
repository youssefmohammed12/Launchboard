import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ListTodo,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessagesSquare,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  InterviewStatus,
  Opportunity,
} from '../types/opportunity';
import {
  UPCOMING_RANGE_DAYS,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  calendarEventTiming,
  dayOfWeek,
  deriveCalendarEvents,
  endOfMonth,
  eventTypeLabel,
  eventsInRange,
  eventsOnDate,
  filterCalendarEvents,
  formatLongDate,
  formatMonthLabel,
  groupEventsByDate,
  isSameMonth,
  monthGridDates,
  overdueEvents,
  shiftMonth,
  startOfMonth,
  upcomingEvents,
  type CalendarEvent,
  type CalendarEventFilter,
  type CalendarEventTimingState,
  type CalendarEventType,
} from '../utils/calendar';
import { activeOpportunities } from '../utils/archive';
import { addDaysToISODate, formatDate, toISODate } from '../utils/dates';
import { StatusBadge } from '../components/Badges';

interface Props {
  items: Opportunity[];
  /** The optional second argument is the control that opened the dialog. */
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  /** Opens the selected task in the Action Center rather than the opportunity editor. */
  onOpenTask?: (opportunityId: string, taskId: string, trigger?: HTMLElement | null) => void;
}

const FILTERS: { value: CalendarEventFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'deadline', label: 'Deadlines' },
  { value: 'follow-up', label: 'Follow-ups' },
  { value: 'task', label: 'Tasks' },
  { value: 'interview', label: 'Interviews' },
];

const eventVisuals: Record<CalendarEventType, { icon: LucideIcon; badgeClass: string; cellClass: string }> = {
  deadline: {
    icon: CalendarClock,
    badgeClass: 'bg-status-interview text-warn',
    cellClass: 'bg-status-interview text-warn',
  },
  'follow-up': {
    icon: BellRing,
    badgeClass: 'bg-accent-soft text-accent-dark',
    cellClass: 'bg-accent-soft text-accent-dark',
  },
  task: {
    icon: ListTodo,
    badgeClass: 'bg-status-applied text-status-applied-text',
    cellClass: 'bg-status-applied text-status-applied-text',
  },
  interview: {
    icon: MessagesSquare,
    badgeClass: 'bg-status-applied text-status-applied-text',
    cellClass: 'bg-status-applied text-status-applied-text',
  },
};

const timingClass: Record<CalendarEventTimingState, string> = {
  overdue: 'bg-status-rejected text-danger',
  today: 'bg-status-interview text-warn',
  upcoming: 'bg-accent-soft text-accent-dark',
};

const interviewStatusClass: Record<InterviewStatus, string> = {
  Scheduled: 'bg-status-interview text-warn',
  Completed: 'bg-accent-soft text-accent-dark',
  Cancelled: 'bg-badge text-badge-text',
};

const filterButtonClass =
  'min-h-11 cursor-pointer rounded-control border px-s3 text-[0.82rem] font-medium';
const emptyStateClass =
  'm-0 rounded-control border border-dashed border-border bg-table-head/50 p-s4 text-center text-[0.85rem] text-muted';

function EventIcon({ event, size = 12 }: { event: CalendarEvent; size?: number }) {
  if (event.type === 'interview') {
    if (event.interviewStatus === 'Completed') {
      return <CheckCircle2 size={size} aria-hidden />;
    }
    if (event.interviewStatus === 'Cancelled') {
      return <XCircle size={size} aria-hidden />;
    }
  }
  const Icon = eventVisuals[event.type].icon;
  return <Icon size={size} aria-hidden />;
}

function EventTypeBadge({ event }: { event: CalendarEvent }) {
  const visual = eventVisuals[event.type];
  return (
    <span
      className={`inline-flex items-center gap-s1 whitespace-nowrap rounded-pill px-[8px] py-[2px] text-[0.74rem] font-semibold ${visual.badgeClass}`}
    >
      <EventIcon event={event} size={11} />
      {eventTypeLabel(event.type)}
    </span>
  );
}

function InterviewStatusBadge({ status }: { status: InterviewStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill px-[8px] py-[2px] text-[0.72rem] font-semibold ${interviewStatusClass[status]}`}
    >
      {status}
    </span>
  );
}

function cellEventLabel(event: CalendarEvent): string {
  if (event.type === 'deadline') return 'Deadline · ' + event.opportunityTitle;
  if (event.type === 'follow-up') return 'Follow-up · ' + event.opportunityTitle;
  if (event.type === 'task') return event.taskTitle + ' · ' + event.opportunityTitle;
  return event.label + ' · ' + event.opportunityTitle;
}

function eventCountSummary(events: CalendarEvent[]): string {
  const counts = new Map<CalendarEventType, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }
  return (['deadline', 'follow-up', 'task', 'interview'] as const)
    .filter((type) => counts.has(type))
    .map((type) => {
      const count = counts.get(type) ?? 0;
      return `${count} ${eventTypeLabel(type).toLowerCase()}${count === 1 ? '' : 's'}`;
    })
    .join(', ');
}

function eventStatusSummary(events: CalendarEvent[]): string {
  return events
    .map((event) => {
      if (event.type === 'interview') return `${event.label}: ${event.interviewStatus} interview`;
      if (event.type === 'task') return `${event.taskTitle} task for ${event.opportunityTitle}`;
      return eventTypeLabel(event.type).toLowerCase();
    })
    .join(', ');
}

function dateAccessibleName(
  date: string,
  events: CalendarEvent[],
  today: string,
  selectedDate: string,
): string {
  const parts = [formatLongDate(date)];
  if (date === today) parts.push('Today');
  if (date === selectedDate) parts.push('Selected');
  if (events.length === 0) {
    parts.push('No events');
  } else {
    parts.push(`${eventCountSummary(events)}: ${eventStatusSummary(events)}`);
  }
  return parts.join('. ');
}

function eventActionLabel(event: CalendarEvent): string {
  if (event.type === 'task') {
    return `Open task ${event.taskTitle} for ${event.opportunityTitle} on ${formatDate(event.date)}`;
  }
  if (event.type === 'interview') {
    return `Open ${event.opportunityTitle} for ${event.label} interview (${event.interviewStatus}) on ${formatDate(event.date)}`;
  }
  return `Open ${event.opportunityTitle} for ${eventTypeLabel(event.type).toLowerCase()} on ${formatDate(event.date)}`;
}

interface EventCardProps {
  event: CalendarEvent;
  opportunity: Opportunity | undefined;
  today: string;
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onOpenTask?: (opportunityId: string, taskId: string, trigger?: HTMLElement | null) => void;
}

function EventCard({ event, opportunity, today, onOpen, onOpenTask }: EventCardProps) {
  if (!opportunity) return null;
  const timing = calendarEventTiming(event, today);

  const open = (clickEvent: MouseEvent<HTMLButtonElement>) => {
    if (event.type === 'task' && onOpenTask) {
      onOpenTask(event.opportunityId, event.taskId, clickEvent.currentTarget);
      return;
    }
    onOpen(opportunity, clickEvent.currentTarget);
  };

  return (
    <button
      type="button"
      className="w-full cursor-pointer rounded-control border border-border bg-surface p-s3 text-left text-inherit [font:inherit] hover:border-accent hover:bg-accent-soft/20"
      aria-label={eventActionLabel(event)}
      onClick={open}
    >
      <span className="flex min-w-0 flex-wrap items-center gap-s2">
        <EventTypeBadge event={event} />
        <span className="inline-flex items-center gap-s1 text-[0.8rem] text-muted">
          <CalendarClock size={12} aria-hidden /> {formatDate(event.date)}
        </span>
        {event.type === 'interview' && event.time && (
          <span className="inline-flex items-center gap-s1 text-[0.8rem] text-muted">
            <Clock size={12} aria-hidden /> {event.time}
          </span>
        )}
        {event.type === 'task' && (
          <span className="rounded-pill border border-border bg-table-head px-[8px] py-[2px] text-[0.72rem] font-semibold text-muted">
            {event.taskPriority} priority
          </span>
        )}
        {event.type === 'interview' && (
          <>
            <InterviewStatusBadge status={event.interviewStatus} />
            <span className="rounded-pill border border-border bg-table-head px-[8px] py-[2px] text-[0.72rem] text-muted">
              {event.interviewMode}
            </span>
          </>
        )}
        {timing && (
          <span
            className={`inline-block whitespace-nowrap rounded-pill px-[8px] py-[2px] text-[0.72rem] font-semibold ${timingClass[timing.state]}`}
          >
            {timing.text}
          </span>
        )}
      </span>
      <span className="mt-s2 block break-words text-[0.95rem] font-semibold text-text">
        {event.opportunityTitle}
      </span>
      <span className="block break-words text-[0.84rem] text-muted">
        {event.opportunityCompany}
      </span>
      {event.type === 'task' && (
        <span className="mt-s1 block break-words text-[0.82rem] text-muted">
          Task: {event.taskTitle}
        </span>
      )}
      {event.type === 'interview' && (
        <span className="mt-s1 block break-words text-[0.82rem] text-muted">
          Round: {event.label}
        </span>
      )}
      <span className="mt-s2 flex flex-wrap items-center justify-between gap-s2">
        <span className="inline-flex items-center gap-s1 text-[0.82rem] font-semibold text-accent-dark">
          {event.type === 'task' ? 'Open task actions' : 'View opportunity'} <ArrowRight size={13} aria-hidden />
        </span>
        <StatusBadge status={event.opportunityStatus} />
      </span>
    </button>
  );
}

export function Calendar({ items, onOpen, onOpenTask }: Props) {
  const [today] = useState(() => toISODate(new Date()));
  const [monthStart, setMonthStart] = useState(() => startOfMonth(today) ?? today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [focusedDate, setFocusedDate] = useState(today);
  const [filter, setFilter] = useState<CalendarEventFilter>('all');
  const dateRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);

  // Archived opportunities do not generate calendar events or openable cards.
  const active = useMemo(() => activeOpportunities(items), [items]);
  const opportunitiesById = useMemo(
    () => new Map(active.map((item) => [item.id, item])),
    [active],
  );
  const allEvents = useMemo(() => deriveCalendarEvents(active), [active]);
  const visibleEvents = useMemo(
    () => filterCalendarEvents(allEvents, filter),
    [allEvents, filter],
  );
  const eventsByDate = useMemo(() => groupEventsByDate(visibleEvents), [visibleEvents]);
  const monthDates = useMemo(() => monthGridDates(monthStart), [monthStart]);
  const monthEnd = endOfMonth(monthStart) ?? monthStart;
  const monthEvents = eventsInRange(visibleEvents, monthStart, monthEnd);
  const selectedEvents = eventsOnDate(visibleEvents, selectedDate);
  const overdue = overdueEvents(visibleEvents, today);
  const upcoming = upcomingEvents(visibleEvents, today);
  const upcomingEnd = addDaysToISODate(today, UPCOMING_RANGE_DAYS - 1) ?? today;
  const tabbableDate = monthDates.includes(focusedDate) ? focusedDate : monthDates[0] ?? today;
  const monthLabel = formatMonthLabel(monthStart);

  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    const button = dateRefs.current.get(target);
    if (button) {
      button.focus();
      pendingFocusRef.current = null;
    }
  }, [focusedDate, monthStart, monthDates]);

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setFocusedDate(date);
    const targetMonth = startOfMonth(date);
    if (targetMonth && targetMonth !== monthStart) setMonthStart(targetMonth);
  };

  const moveFocus = (date: string, days: number) => {
    const next = addDaysToISODate(date, days);
    if (!next) return;
    setFocusedDate(next);
    pendingFocusRef.current = next;
    const targetMonth = startOfMonth(next);
    if (targetMonth && targetMonth !== monthStart) setMonthStart(targetMonth);
  };

  const handleDateKeyDown = (
    keyEvent: ReactKeyboardEvent<HTMLButtonElement>,
    date: string,
  ) => {
    let days: number;
    if (keyEvent.key === 'ArrowLeft') days = -1;
    else if (keyEvent.key === 'ArrowRight') days = 1;
    else if (keyEvent.key === 'ArrowUp') days = -7;
    else if (keyEvent.key === 'ArrowDown') days = 7;
    else if (keyEvent.key === 'Home') days = -(dayOfWeek(date) ?? 0);
    else if (keyEvent.key === 'End') days = 6 - (dayOfWeek(date) ?? 0);
    else return;

    keyEvent.preventDefault();
    moveFocus(date, days);
  };

  const navigateMonth = (offset: number) => {
    const next = shiftMonth(monthStart, offset);
    if (!next) return;
    setMonthStart(next);
    setFocusedDate(
      isSameMonth(selectedDate, next)
        ? selectedDate
        : isSameMonth(today, next)
          ? today
          : next,
    );
  };

  const goToToday = () => {
    const currentMonth = startOfMonth(today);
    if (currentMonth) setMonthStart(currentMonth);
    setSelectedDate(today);
    setFocusedDate(today);
  };

  const selectedEmptyMessage =
    filter === 'all'
      ? 'No events on this day.'
      : 'No events on this day for the selected filter.';
  const monthEmptyMessage =
    filter === 'all'
      ? `No events in ${monthLabel}.`
      : `No events in ${monthLabel} for the selected filter.`;
  const overdueEmptyMessage =
    filter === 'deadline'
      ? 'No overdue deadlines.'
      : filter === 'follow-up'
        ? 'No overdue follow-ups.'
        : filter === 'task'
          ? 'No overdue tasks.'
          : filter === 'interview'
            ? 'No past-due Scheduled interviews.'
            : 'No overdue events.';
  const scheduledInterviewExists = visibleEvents.some(
    (event) => event.type === 'interview' && event.interviewStatus === 'Scheduled',
  );
  const upcomingEmptyMessage =
    filter === 'deadline'
      ? `No deadlines due in the next ${UPCOMING_RANGE_DAYS} days.`
      : filter === 'follow-up'
        ? `No follow-ups due in the next ${UPCOMING_RANGE_DAYS} days.`
        : filter === 'task'
          ? `No tasks due in the next ${UPCOMING_RANGE_DAYS} days.`
          : filter === 'interview'
            ? scheduledInterviewExists
              ? `No interviews scheduled in the next ${UPCOMING_RANGE_DAYS} days.`
              : 'No interviews scheduled yet.'
            : `Nothing scheduled in the next ${UPCOMING_RANGE_DAYS} days.`;

  const weeks: string[][] = [];
  for (let index = 0; index < monthDates.length; index += 7) {
    weeks.push(monthDates.slice(index, index + 7));
  }

  return (
    <>
      <header className="mb-s5">
        <h1>Calendar</h1>
        <p className="text-[0.9rem] text-muted">
          Deadlines, follow-ups, dated tasks and interview rounds in one schedule. Archived opportunities
          are excluded. Completed tasks stay in the Action Center; the month grid keeps Completed and
          Cancelled interviews for history, while Upcoming only lists Scheduled interviews.
        </p>
      </header>

      <div
        className="mb-s4 flex flex-wrap items-center gap-s2"
        role="group"
        aria-label="Filter calendar events by type"
      >
        <span className="text-[0.82rem] font-semibold text-muted">Show</span>
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`${filterButtonClass} ${
              filter === option.value
                ? 'border-accent bg-accent text-white'
                : 'border-border bg-surface text-text hover:border-accent'
            }`}
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <section
        className="mb-s4 rounded-card border border-border bg-surface p-s3 shadow-card max-[640px]:p-s2"
        aria-labelledby="calendar-month-heading"
      >
        <div className="mb-s3 flex flex-wrap items-center justify-between gap-s2">
          <h2 id="calendar-month-heading" className="m-0" aria-live="polite">
            {monthLabel}
          </h2>
          <div className="flex flex-wrap items-center gap-s1">
            <button
              type="button"
              className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-control border border-border bg-surface text-text hover:border-accent"
              aria-label="Previous month"
              onClick={() => navigateMonth(-1)}
            >
              <ChevronLeft size={17} aria-hidden />
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-control border border-border bg-surface px-s3 py-[6px] text-[0.82rem] font-medium text-text hover:border-accent"
              onClick={goToToday}
            >
              Today
            </button>
            <button
              type="button"
              className="inline-grid h-[34px] w-[34px] cursor-pointer place-items-center rounded-control border border-border bg-surface text-text hover:border-accent"
              aria-label="Next month"
              onClick={() => navigateMonth(1)}
            >
              <ChevronRight size={17} aria-hidden />
            </button>
          </div>
        </div>

        <div role="grid" aria-labelledby="calendar-month-heading">
          <div role="row" className="grid grid-cols-7 rounded-control bg-table-head">
            {WEEKDAY_SHORT.map((short, index) => (
              <div
                key={short}
                role="columnheader"
                aria-label={WEEKDAY_LONG[index]}
                className="border-b border-border px-[2px] py-s2 text-center text-[0.72rem] font-semibold uppercase tracking-[0.03em] text-muted"
              >
                {short}
              </div>
            ))}
          </div>

          {weeks.map((week) => (
            <div key={week[0]} role="row" className="grid grid-cols-7">
              {week.map((date) => {
                const dayEvents = eventsByDate.get(date) ?? [];
                const inMonth = isSameMonth(date, monthStart);
                const isToday = date === today;
                const isSelected = date === selectedDate;
                const shownEvents = dayEvents.slice(0, 2);
                const hiddenCount = dayEvents.length - shownEvents.length;

                return (
                  <div
                    key={date}
                    role="gridcell"
                    className="min-w-0 border-b border-border [&:not(:last-child)]:border-r"
                  >
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) dateRefs.current.set(date, node);
                        else dateRefs.current.delete(date);
                      }}
                      tabIndex={date === tabbableDate ? 0 : -1}
                      aria-label={dateAccessibleName(date, dayEvents, today, selectedDate)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-pressed={isSelected}
                      className={`h-full min-h-[88px] w-full cursor-pointer border-0 p-s1 text-left text-inherit [font:inherit] hover:bg-accent-soft/40 focus-visible:relative focus-visible:z-10 max-[640px]:min-h-[58px] max-[640px]:p-[3px] ${
                        isSelected
                          ? 'bg-accent-soft ring-2 ring-inset ring-accent'
                          : inMonth
                            ? 'bg-surface'
                            : 'bg-table-head/40'
                      }`}
                      onClick={() => selectDate(date)}
                      onKeyDown={(keyEvent) => handleDateKeyDown(keyEvent, date)}
                    >
                      <span className="flex items-start justify-between gap-s1">
                        <span
                          className={`inline-grid h-[22px] min-w-[22px] place-items-center rounded-pill px-[4px] text-[0.78rem] font-semibold ${
                            isToday ? 'bg-accent text-white' : inMonth ? 'text-text' : 'text-muted'
                          }`}
                        >
                          {Number(date.slice(8, 10))}
                        </span>
                        {isToday && (
                          <span className="max-[640px]:sr-only text-[0.62rem] font-semibold uppercase tracking-[0.03em] text-accent-dark">
                            Today
                          </span>
                        )}
                      </span>

                      <span className="mt-s1 grid gap-[2px]">
                        {shownEvents.map((event) => (
                          <span
                            key={event.id}
                            className={`flex min-w-0 items-center gap-[2px] rounded-[3px] px-[3px] py-[1px] text-[0.64rem] font-medium ${eventVisuals[event.type].cellClass}`}
                          >
                            <EventIcon event={event} size={9} />
                            <span className="truncate max-[640px]:sr-only">
                              {cellEventLabel(event)}
                            </span>
                          </span>
                        ))}
                        {hiddenCount > 0 && (
                          <span className="text-[0.62rem] font-medium text-muted">
                            +{hiddenCount} more
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {monthEvents.length === 0 && (
          <p className={`mt-s3 ${emptyStateClass}`} role="status">
            {monthEmptyMessage}
          </p>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-s4 max-[1000px]:grid-cols-1">
        <section
          className="min-w-0 self-start rounded-card border border-border bg-surface p-s4 shadow-card"
          aria-labelledby="selected-day-heading"
        >
          <div className="mb-s3">
            <h2 id="selected-day-heading">Selected day</h2>
            <p className="m-0 text-[0.88rem] text-muted">{formatLongDate(selectedDate)}</p>
          </div>
          {selectedEvents.length === 0 ? (
            <p className={emptyStateClass}>{selectedEmptyMessage}</p>
          ) : (
            <ul className="m-0 grid list-none gap-s2 p-0">
              {selectedEvents.map((event) => (
                <li key={event.id}>
                  <EventCard
                    event={event}
                    opportunity={opportunitiesById.get(event.opportunityId)}
                    today={today}
                    onOpen={onOpen}
                    onOpenTask={onOpenTask}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid min-w-0 gap-s4">
          <section
            className="min-w-0 rounded-card border border-border bg-surface p-s4 shadow-card"
            aria-labelledby="overdue-events-heading"
          >
            <div className="mb-s3 flex flex-wrap items-baseline justify-between gap-s2">
              <h2 id="overdue-events-heading" className="m-0">
                Overdue
              </h2>
              <span className="text-[0.78rem] font-semibold text-muted">
                {overdue.length}
              </span>
            </div>
            {overdue.length === 0 ? (
              <p className={emptyStateClass}>{overdueEmptyMessage}</p>
            ) : (
              <ul className="m-0 grid list-none gap-s2 p-0">
                {overdue.map((event) => (
                  <li key={event.id}>
                    <EventCard
                      event={event}
                      opportunity={opportunitiesById.get(event.opportunityId)}
                      today={today}
                      onOpen={onOpen}
                      onOpenTask={onOpenTask}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="min-w-0 rounded-card border border-border bg-surface p-s4 shadow-card"
            aria-labelledby="upcoming-events-heading"
          >
            <div className="mb-s3">
              <div className="flex flex-wrap items-baseline justify-between gap-s2">
                <h2 id="upcoming-events-heading" className="m-0">
                  Upcoming
                </h2>
                <span className="text-[0.78rem] font-semibold text-muted">
                  {upcoming.length}
                </span>
              </div>
              <p className="mt-s1 mb-0 text-[0.8rem] text-muted">
                Today through {formatDate(upcomingEnd)} · {UPCOMING_RANGE_DAYS} calendar days
                including today
              </p>
            </div>
            {upcoming.length === 0 ? (
              <p className={emptyStateClass}>{upcomingEmptyMessage}</p>
            ) : (
              <ul className="m-0 grid list-none gap-s2 p-0">
                {upcoming.map((event) => (
                  <li key={event.id}>
                    <EventCard
                      event={event}
                      opportunity={opportunitiesById.get(event.opportunityId)}
                      today={today}
                      onOpen={onOpen}
                      onOpenTask={onOpenTask}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

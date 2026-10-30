import {
  INTERVIEW_MODES,
  INTERVIEW_STATUSES,
  type InterviewMode,
  type InterviewStatus,
  type Opportunity,
  type OpportunityStatus,
} from '../types/opportunity';
import { isArchived } from './archive';
import {
  addDaysToISODate,
  daysBetweenISODates,
  isValidISODate,
  toISODate,
} from './dates';
import { isValidInterviewTime } from './interviews';

export const CALENDAR_EVENT_TYPES = ['deadline', 'follow-up', 'interview'] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

export const CALENDAR_EVENT_FILTERS = ['all', ...CALENDAR_EVENT_TYPES] as const;
export type CalendarEventFilter = (typeof CALENDAR_EVENT_FILTERS)[number];

/** The Upcoming section includes today and the following 13 local dates. */
export const UPCOMING_RANGE_DAYS = 14;

/** The Dashboard summary includes today and the following six local dates. */
export const DASHBOARD_RANGE_DAYS = 7;

interface CalendarEventBase {
  /** Deterministic ID derived from the source record, never a render-time random value. */
  id: string;
  type: CalendarEventType;
  opportunityId: string;
  opportunityTitle: string;
  opportunityCompany: string;
  opportunityStatus: OpportunityStatus;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
  /** Local HH:mm time for interviews, otherwise ''. */
  time: string;
  /** Deadline/follow-up label, or the interview round. */
  label: string;
}

export interface DeadlineCalendarEvent extends CalendarEventBase {
  type: 'deadline';
  time: '';
}

export interface FollowUpCalendarEvent extends CalendarEventBase {
  type: 'follow-up';
  time: '';
}

export interface InterviewCalendarEvent extends CalendarEventBase {
  type: 'interview';
  interviewId: string;
  interviewMode: InterviewMode;
  interviewStatus: InterviewStatus;
}

export type CalendarEvent =
  | DeadlineCalendarEvent
  | FollowUpCalendarEvent
  | InterviewCalendarEvent;

/** A follow-up is a planned action and stays eligible regardless of opportunity status. */
function deadlineIsEligible(status: OpportunityStatus): boolean {
  return status !== 'Offer' && status !== 'Rejected';
}

function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

const TYPE_ORDER: Record<CalendarEventType, number> = {
  deadline: 0,
  'follow-up': 1,
  interview: 2,
};

/**
 * Chronological by local date. On the same date, timed interviews come first in
 * local-time order; all untimed events follow in deadline, follow-up, interview
 * order. Remaining ties use stable text fields and the derived ID.
 */
export function compareCalendarEvents(a: CalendarEvent, b: CalendarEvent): number {
  const byDate = compareText(a.date, b.date);
  if (byDate !== 0) return byDate;

  const aTime = a.time || '99:99';
  const bTime = b.time || '99:99';
  const byTime = compareText(aTime, bTime);
  if (byTime !== 0) return byTime;

  const byType = TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  if (byType !== 0) return byType;

  return (
    compareText(a.label, b.label) ||
    compareText(a.opportunityTitle, b.opportunityTitle) ||
    compareText(a.id, b.id)
  );
}

export function sortCalendarEvents(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(compareCalendarEvents);
}

/**
 * Derives every calendar event from the authoritative opportunity collection.
 * Archived records are excluded here so every Calendar and Dashboard consumer
 * follows the same active-workspace rule. The input records and nested arrays
 * are never modified. Invalid dates and malformed interview entries are
 * skipped rather than given fallback dates.
 */
export function deriveCalendarEvents(items: readonly Opportunity[]): CalendarEvent[] {
  if (!Array.isArray(items)) return [];

  const events: CalendarEvent[] = [];
  const seenIds = new Set<string>();
  const add = (event: CalendarEvent) => {
    if (seenIds.has(event.id)) return;
    seenIds.add(event.id);
    events.push(event);
  };

  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    if (isArchived(item)) continue;

    const title = typeof item.title === 'string' ? item.title : '';
    const company = typeof item.company === 'string' ? item.company : '';

    if (
      typeof item.deadline === 'string' &&
      isValidISODate(item.deadline) &&
      deadlineIsEligible(item.status)
    ) {
      add({
        id: `deadline:${item.id}`,
        type: 'deadline',
        opportunityId: item.id,
        opportunityTitle: title,
        opportunityCompany: company,
        opportunityStatus: item.status,
        date: item.deadline,
        time: '',
        label: 'Application deadline',
      });
    }

    if (typeof item.followUpDate === 'string' && isValidISODate(item.followUpDate)) {
      add({
        id: `follow-up:${item.id}`,
        type: 'follow-up',
        opportunityId: item.id,
        opportunityTitle: title,
        opportunityCompany: company,
        opportunityStatus: item.status,
        date: item.followUpDate,
        time: '',
        label: 'Follow-up',
      });
    }

    const interviews = Array.isArray(item.interviews) ? item.interviews : [];
    for (const raw of interviews) {
      if (!raw || typeof raw !== 'object') continue;
      if (typeof raw.id !== 'string' || !raw.id) continue;
      if (typeof raw.date !== 'string' || !isValidISODate(raw.date)) continue;

      const time =
        typeof raw.time === 'string' && isValidInterviewTime(raw.time.trim())
          ? raw.time.trim()
          : '';
      const mode = INTERVIEW_MODES.find((candidate) => candidate === raw.mode) ?? 'Other';
      const status = INTERVIEW_STATUSES.find((candidate) => candidate === raw.status) ?? 'Scheduled';
      const round =
        typeof raw.round === 'string' && raw.round.trim() ? raw.round.trim() : 'Interview';

      add({
        id: `interview:${item.id}:${raw.id}`,
        type: 'interview',
        opportunityId: item.id,
        opportunityTitle: title,
        opportunityCompany: company,
        opportunityStatus: item.status,
        date: raw.date,
        time,
        label: round,
        interviewId: raw.id,
        interviewMode: mode,
        interviewStatus: status,
      });
    }
  }

  return sortCalendarEvents(events);
}

export function filterCalendarEvents(
  events: readonly CalendarEvent[],
  filter: CalendarEventFilter,
): CalendarEvent[] {
  if (filter === 'all') return sortCalendarEvents(events);
  return sortCalendarEvents(events.filter((event) => event.type === filter));
}

/** Events on one valid local date, in deterministic display order. */
export function eventsOnDate(events: readonly CalendarEvent[], date: string): CalendarEvent[] {
  if (!isValidISODate(date)) return [];
  return sortCalendarEvents(events.filter((event) => event.date === date));
}

/** Events in an inclusive local-date range. */
export function eventsInRange(
  events: readonly CalendarEvent[],
  startDate: string,
  endDate: string,
): CalendarEvent[] {
  if (!isValidISODate(startDate) || !isValidISODate(endDate) || startDate > endDate) return [];
  return sortCalendarEvents(
    events.filter((event) => event.date >= startDate && event.date <= endDate),
  );
}

function scheduledOnly(event: CalendarEvent): boolean {
  return event.type !== 'interview' || event.interviewStatus === 'Scheduled';
}

/**
 * Past eligible deadlines and follow-ups, plus Scheduled interviews whose date
 * has passed. Completed and Cancelled interviews are historical, not overdue.
 */
export function overdueEvents(
  events: readonly CalendarEvent[],
  today: string,
): CalendarEvent[] {
  if (!isValidISODate(today)) return [];
  return sortCalendarEvents(
    events.filter((event) => event.date < today && scheduledOnly(event)),
  );
}

/**
 * Eligible deadlines, follow-ups and Scheduled interviews from today through
 * today + 13 days (14 local calendar dates, including today).
 */
export function upcomingEvents(
  events: readonly CalendarEvent[],
  today: string,
  rangeDays: number = UPCOMING_RANGE_DAYS,
): CalendarEvent[] {
  if (!isValidISODate(today) || !Number.isInteger(rangeDays) || rangeDays < 1) return [];
  const endDate = addDaysToISODate(today, rangeDays - 1);
  if (!endDate) return [];
  return eventsInRange(events, today, endDate).filter(scheduledOnly);
}

/**
 * The Dashboard's focus window: eligible events from today through today + 6
 * (seven local calendar dates, including today). Past-due events stay in the
 * Calendar's Overdue section instead.
 */
export function nextDaysEvents(
  events: readonly CalendarEvent[],
  today: string,
): CalendarEvent[] {
  return upcomingEvents(events, today, DASHBOARD_RANGE_DAYS);
}

/** Groups already-derived events by local date without dropping distinctions. */
export function groupEventsByDate(
  events: readonly CalendarEvent[],
): Map<string, CalendarEvent[]> {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of sortCalendarEvents(events)) {
    const group = groups.get(event.date);
    if (group) group.push(event);
    else groups.set(event.date, [event]);
  }
  return groups;
}

export type CalendarEventTimingState = 'overdue' | 'today' | 'upcoming';

export interface CalendarEventTiming {
  state: CalendarEventTimingState;
  text: string;
}

/**
 * Display wording for an event relative to a supplied local "today".
 * Completed and Cancelled interviews have no due/overdue wording; their status
 * badge is the relevant state instead.
 */
export function calendarEventTiming(
  event: CalendarEvent,
  today: string,
): CalendarEventTiming | null {
  const days = daysBetweenISODates(today, event.date);
  if (days === null) return null;
  if (event.type === 'interview' && event.interviewStatus !== 'Scheduled') return null;

  const count = Math.abs(days);
  const daysText = `${count} day${count === 1 ? '' : 's'}`;

  if (days < 0) {
    if (event.type === 'deadline') {
      return { state: 'overdue', text: `Deadline overdue by ${daysText}` };
    }
    if (event.type === 'follow-up') {
      return { state: 'overdue', text: `Follow-up overdue by ${daysText}` };
    }
    return {
      state: 'overdue',
      text: `Interview date passed ${daysText} ago; still Scheduled`,
    };
  }

  if (days === 0) {
    if (event.type === 'deadline') return { state: 'today', text: 'Due today' };
    if (event.type === 'follow-up') return { state: 'today', text: 'Follow-up due today' };
    return { state: 'today', text: 'Interview scheduled today' };
  }

  if (event.type === 'deadline') return { state: 'upcoming', text: `Due in ${daysText}` };
  if (event.type === 'follow-up') {
    return { state: 'upcoming', text: `Follow-up in ${daysText}` };
  }
  return { state: 'upcoming', text: `Interview in ${daysText}` };
}

export function eventTypeLabel(type: CalendarEventType): string {
  if (type === 'deadline') return 'Deadline';
  if (type === 'follow-up') return 'Follow-up';
  return 'Interview';
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function dateParts(iso: string): { y: number; m: number; d: number } | null {
  if (!isValidISODate(iso)) return null;
  return {
    y: Number(iso.slice(0, 4)),
    m: Number(iso.slice(5, 7)),
    d: Number(iso.slice(8, 10)),
  };
}

/** Sunday-based weekday index for a local calendar date. */
export function dayOfWeek(iso: string): number | null {
  const parts = dateParts(iso);
  if (!parts) return null;
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d)).getUTCDay();
}

export function startOfMonth(iso: string): string | null {
  const parts = dateParts(iso);
  if (!parts) return null;
  return toISODate(new Date(parts.y, parts.m - 1, 1));
}

export function endOfMonth(iso: string): string | null {
  const parts = dateParts(iso);
  if (!parts) return null;
  return toISODate(new Date(parts.y, parts.m, 0));
}

export function shiftMonth(iso: string, months: number): string | null {
  const parts = dateParts(iso);
  if (!parts || !Number.isInteger(months)) return null;
  return toISODate(new Date(parts.y, parts.m - 1 + months, 1));
}

export function isSameMonth(a: string, b: string): boolean {
  const aMonth = startOfMonth(a);
  const bMonth = startOfMonth(b);
  return aMonth !== null && aMonth === bMonth;
}

/** A fixed six-week, Sunday-first grid covering the supplied month. */
export function monthGridDates(monthIso: string): string[] {
  const first = startOfMonth(monthIso);
  if (!first) return [];
  const weekday = dayOfWeek(first);
  const gridStart = weekday === null ? null : addDaysToISODate(first, -weekday);
  if (!gridStart) return [];

  return Array.from({ length: 42 }, (_, index) => addDaysToISODate(gridStart, index))
    .filter((date): date is string => date !== null);
}

export function formatMonthLabel(iso: string): string {
  const parts = dateParts(iso);
  if (!parts) return '—';
  return new Date(parts.y, parts.m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function formatLongDate(iso: string): string {
  const parts = dateParts(iso);
  if (!parts) return '—';
  return new Date(parts.y, parts.m - 1, parts.d).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

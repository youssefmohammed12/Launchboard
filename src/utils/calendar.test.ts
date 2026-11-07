import { describe, expect, it } from 'vitest';
import { makeInterview, makeOpportunity } from '../test/fixtures';
import type { Opportunity } from '../types/opportunity';
import {
  DASHBOARD_RANGE_DAYS,
  UPCOMING_RANGE_DAYS,
  calendarEventTiming,
  deriveCalendarEvents,
  eventsInRange,
  eventsOnDate,
  filterCalendarEvents,
  groupEventsByDate,
  monthGridDates,
  nextDaysEvents,
  overdueEvents,
  upcomingEvents,
} from './calendar';

const TODAY = '2026-01-15';

function allTypesOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return makeOpportunity({
    id: 'op-1',
    title: 'Frontend Intern',
    company: 'Northwind Labs',
    status: 'Applied',
    deadline: '2026-01-20',
    followUpDate: '2026-01-18',
    interviews: [
      makeInterview({
        id: 'round-1',
        round: 'Recruiter Screen',
        date: '2026-01-19',
        time: '10:30',
        mode: 'Video',
        status: 'Scheduled',
      }),
      makeInterview({
        id: 'round-2',
        round: 'Technical Interview',
        date: '2026-01-19',
        time: '09:00',
        mode: 'In person',
        status: 'Completed',
      }),
    ],
    ...overrides,
  });
}

describe('deriveCalendarEvents', () => {
  it('creates one deadline event for an eligible opportunity', () => {
    const events = deriveCalendarEvents([allTypesOpportunity()]);
    const deadlines = events.filter((event) => event.type === 'deadline');

    expect(deadlines).toHaveLength(1);
    expect(deadlines[0]).toMatchObject({
      id: 'deadline:op-1',
      type: 'deadline',
      opportunityId: 'op-1',
      opportunityTitle: 'Frontend Intern',
      opportunityCompany: 'Northwind Labs',
      opportunityStatus: 'Applied',
      date: '2026-01-20',
      time: '',
      label: 'Application deadline',
    });
  });

  it('does not derive events for archived opportunities', () => {
    const events = deriveCalendarEvents([
      allTypesOpportunity({ id: 'active' }),
      allTypesOpportunity({
        id: 'archived',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ]);

    expect(events.every((event) => event.opportunityId === 'active')).toBe(true);
    expect(events).toHaveLength(4);
  });

  it('keeps Offer and Rejected deadline eligibility consistent with the Deadlines page', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'applied', status: 'Applied', deadline: '2026-01-20' }),
      makeOpportunity({ id: 'interview', status: 'Interview', deadline: '2026-01-21' }),
      makeOpportunity({ id: 'saved', status: 'Saved', deadline: '2026-01-22' }),
      makeOpportunity({ id: 'offer', status: 'Offer', deadline: '2026-01-23' }),
      makeOpportunity({ id: 'rejected', status: 'Rejected', deadline: '2026-01-24' }),
    ]);

    expect(events.map((event) => event.id)).toEqual([
      'deadline:applied',
      'deadline:interview',
      'deadline:saved',
    ]);
  });

  it('creates one follow-up event for any status and ignores invalid dates', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'offer',
        status: 'Offer',
        followUpDate: '2026-01-18',
      }),
      makeOpportunity({
        id: 'rejected',
        status: 'Rejected',
        followUpDate: '2026-01-19',
      }),
      makeOpportunity({ id: 'invalid', followUpDate: '2026-02-30' }),
      makeOpportunity({ id: 'missing', followUpDate: '' }),
    ]);

    expect(events.map((event) => event.id)).toEqual([
      'follow-up:offer',
      'follow-up:rejected',
    ]);
  });

  it('preserves interview identity, time, mode, status and parent opportunity', () => {
    const events = deriveCalendarEvents([allTypesOpportunity()]);
    const interviews = events.filter((event) => event.type === 'interview');

    expect(interviews).toHaveLength(2);
    expect(interviews.find((event) => event.interviewId === 'round-1')).toMatchObject({
      id: 'interview:op-1:round-1',
      opportunityId: 'op-1',
      interviewId: 'round-1',
      date: '2026-01-19',
      time: '10:30',
      interviewMode: 'Video',
      interviewStatus: 'Scheduled',
      label: 'Recruiter Screen',
    });
    expect(interviews.find((event) => event.interviewId === 'round-2')).toMatchObject({
      interviewStatus: 'Completed',
    });
  });

  it('does not duplicate the same source event', () => {
    const duplicateInterview = makeInterview({ id: 'round-1', date: '2026-01-19' });
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'op-1',
        deadline: '2026-01-20',
        followUpDate: '2026-01-18',
        interviews: [duplicateInterview, { ...duplicateInterview, round: 'Duplicate' }],
      }),
    ]);

    expect(events.map((event) => event.id)).toEqual([
      'follow-up:op-1',
      'interview:op-1:round-1',
      'deadline:op-1',
    ]);
  });

  it('returns stable IDs and deterministic ordering across repeated derivations', () => {
    const items = [
      allTypesOpportunity({ title: 'Same title' }),
      makeOpportunity({
        id: 'op-2',
        title: 'Same title',
        deadline: '2026-01-20',
      }),
      makeOpportunity({
        id: 'op-3',
        title: 'Same title',
        deadline: '2026-01-20',
      }),
    ];

    const first = deriveCalendarEvents(items);
    const second = deriveCalendarEvents(JSON.parse(JSON.stringify(items)) as Opportunity[]);

    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(first.map((event) => event.id)).toContain('deadline:op-1');
    expect(first.filter((event) => event.type === 'deadline').map((event) => event.id)).toEqual([
      'deadline:op-1',
      'deadline:op-2',
      'deadline:op-3',
    ]);
  });

  it('keeps genuinely different events on the same date separate', () => {
    const events = deriveCalendarEvents([allTypesOpportunity()]);
    const onDate = eventsOnDate(events, '2026-01-19');

    expect(onDate.map((event) => event.id)).toEqual([
      'interview:op-1:round-2',
      'interview:op-1:round-1',
    ]);
    expect(events.filter((event) => event.date === '2026-01-19')).toHaveLength(2);
  });

  it('handles malformed interview data safely without inventing a date', () => {
    const malformed = {
      id: 'bad-date',
      round: '',
      date: '2026-02-30',
      time: 'not-a-time',
      mode: 'Unknown',
      status: 'Unknown',
    } as unknown as Opportunity['interviews'][number];
    const validButSparse = {
      id: 'sparse',
      date: '2026-01-21',
      time: '25:00',
      mode: 'Unknown',
      status: 'Unknown',
    } as unknown as Opportunity['interviews'][number];

    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'op-1', interviews: [malformed, validButSparse] }),
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'interview',
      interviewId: 'sparse',
      date: '2026-01-21',
      time: '',
      interviewMode: 'Other',
      interviewStatus: 'Scheduled',
      label: 'Interview',
    });
  });

  it('does not mutate the source opportunities or nested arrays', () => {
    const items = [allTypesOpportunity()];
    const snapshot = JSON.parse(JSON.stringify(items)) as Opportunity[];

    deriveCalendarEvents(items);

    expect(items).toEqual(snapshot);
  });
});

describe('calendar selectors', () => {
  it('finds events on one date and in an inclusive range', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'a', deadline: '2026-01-15' }),
      makeOpportunity({ id: 'b', deadline: '2026-01-16' }),
      makeOpportunity({ id: 'c', deadline: '2026-01-17' }),
    ]);

    expect(eventsOnDate(events, '2026-01-16').map((event) => event.id)).toEqual(['deadline:b']);
    expect(
      eventsInRange(events, '2026-01-15', '2026-01-16').map((event) => event.id),
    ).toEqual(['deadline:a', 'deadline:b']);
    expect(eventsInRange(events, '2026-01-18', '2026-01-20')).toEqual([]);
    expect(eventsOnDate(events, '2026-02-30')).toEqual([]);
  });

  it('handles month and year boundaries and leap-day dates', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'dec', deadline: '2026-12-31' }),
      makeOpportunity({ id: 'jan', deadline: '2027-01-01' }),
      makeOpportunity({ id: 'leap', deadline: '2024-02-29' }),
    ]);

    expect(
      eventsInRange(events, '2026-12-31', '2027-01-01').map((event) => event.id),
    ).toEqual(['deadline:dec', 'deadline:jan']);
    expect(eventsOnDate(events, '2024-02-29').map((event) => event.id)).toEqual([
      'deadline:leap',
    ]);
    expect(monthGridDates('2024-02-01')).toContain('2024-02-29');
    expect(monthGridDates('2026-01-01')).toHaveLength(42);
  });

  it('identifies overdue events without treating Completed or Cancelled interviews as overdue', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'deadline',
        deadline: '2026-01-14',
        interviews: [
          makeInterview({
            id: 'scheduled',
            date: '2026-01-13',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'completed',
            date: '2026-01-12',
            status: 'Completed',
          }),
          makeInterview({
            id: 'cancelled',
            date: '2026-01-11',
            status: 'Cancelled',
          }),
        ],
      }),
      makeOpportunity({ id: 'follow-up', followUpDate: '2026-01-10' }),
      makeOpportunity({ id: 'today', deadline: '2026-01-15' }),
    ]);

    expect(overdueEvents(events, TODAY).map((event) => event.id)).toEqual([
      'follow-up:follow-up',
      'interview:deadline:scheduled',
      'deadline:deadline',
    ]);
  });

  it('limits Upcoming to Scheduled interviews and the inclusive 14-day range', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'deadline',
        deadline: '2026-01-15',
        interviews: [
          makeInterview({
            id: 'today',
            date: '2026-01-15',
            time: '09:00',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'end',
            date: '2026-01-28',
            time: '10:00',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'outside',
            date: '2026-01-29',
            time: '10:00',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'completed',
            date: '2026-01-20',
            status: 'Completed',
          }),
          makeInterview({
            id: 'cancelled',
            date: '2026-01-21',
            status: 'Cancelled',
          }),
        ],
      }),
      makeOpportunity({ id: 'past', deadline: '2026-01-14' }),
      makeOpportunity({ id: 'later', deadline: '2026-02-01' }),
    ]);

    const result = upcomingEvents(events, TODAY);
    expect(result.map((event) => event.id)).toEqual([
      'interview:deadline:today',
      'deadline:deadline',
      'interview:deadline:end',
    ]);
    expect(UPCOMING_RANGE_DAYS).toBe(14);
  });

  it('orders timed interviews chronologically and places untimed events after them', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'op-1',
        deadline: '2026-01-19',
        followUpDate: '2026-01-19',
        interviews: [
          makeInterview({ id: 'late', date: '2026-01-19', time: '14:00' }),
          makeInterview({ id: 'early', date: '2026-01-19', time: '08:00' }),
          makeInterview({ id: 'untimed', date: '2026-01-19', time: '' }),
        ],
      }),
    ]);

    expect(eventsOnDate(events, '2026-01-19').map((event) => event.id)).toEqual([
      'interview:op-1:early',
      'interview:op-1:late',
      'deadline:op-1',
      'follow-up:op-1',
      'interview:op-1:untimed',
    ]);
  });

  it('groups events by local date without collapsing distinct events', () => {
    const events = deriveCalendarEvents([allTypesOpportunity()]);
    const groups = groupEventsByDate(events);

    expect([...groups.keys()]).toEqual(['2026-01-18', '2026-01-19', '2026-01-20']);
    expect(groups.get('2026-01-19')).toHaveLength(2);
  });

  it('filters by event type without changing the source events', () => {
    const events = deriveCalendarEvents([allTypesOpportunity()]);
    const before = events.map((event) => event.id);

    expect(filterCalendarEvents(events, 'deadline').map((event) => event.id)).toEqual([
      'deadline:op-1',
    ]);
    expect(filterCalendarEvents(events, 'follow-up').map((event) => event.id)).toEqual([
      'follow-up:op-1',
    ]);
    expect(filterCalendarEvents(events, 'interview')).toHaveLength(2);
    expect(filterCalendarEvents(events, 'all')).toHaveLength(4);
    expect(events.map((event) => event.id)).toEqual(before);
  });
});

describe('nextDaysEvents', () => {
  it('covers today through the sixth day and excludes yesterday and the seventh day', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'yesterday', deadline: '2026-01-14' }),
      makeOpportunity({ id: 'today', deadline: '2026-01-15' }),
      makeOpportunity({ id: 'sixth', deadline: '2026-01-21' }),
      makeOpportunity({ id: 'seventh', deadline: '2026-01-22' }),
    ]);

    expect(nextDaysEvents(events, TODAY).map((event) => event.id)).toEqual([
      'deadline:today',
      'deadline:sixth',
    ]);
    expect(DASHBOARD_RANGE_DAYS).toBe(7);
  });

  it('handles month and year boundaries without shifting local date-only values', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'dec-31', deadline: '2026-12-31' }),
      makeOpportunity({ id: 'jan-06', deadline: '2027-01-06' }),
      makeOpportunity({ id: 'jan-07', deadline: '2027-01-07' }),
      makeOpportunity({ id: 'jan-08', deadline: '2027-01-08' }),
    ]);

    expect(nextDaysEvents(events, '2026-12-31').map((event) => event.id)).toEqual([
      'deadline:dec-31',
      'deadline:jan-06',
    ]);
    expect(nextDaysEvents(events, '2027-01-01').map((event) => event.id)).toEqual([
      'deadline:jan-06',
      'deadline:jan-07',
    ]);
    expect(nextDaysEvents(events, '2027-01-01').map((event) => event.id)).not.toContain(
      'deadline:jan-08',
    );
  });

  it('reuses calendar eligibility and excludes Completed or Cancelled interviews', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({ id: 'offer', status: 'Offer', deadline: '2026-01-16' }),
      makeOpportunity({
        id: 'rejected',
        status: 'Rejected',
        followUpDate: '2026-01-17',
      }),
      makeOpportunity({
        id: 'interviews',
        interviews: [
          makeInterview({ id: 'scheduled', date: '2026-01-18', status: 'Scheduled' }),
          makeInterview({ id: 'completed', date: '2026-01-19', status: 'Completed' }),
          makeInterview({ id: 'cancelled', date: '2026-01-20', status: 'Cancelled' }),
        ],
      }),
    ]);

    expect(nextDaysEvents(events, TODAY).map((event) => event.id)).toEqual([
      'follow-up:rejected',
      'interview:interviews:scheduled',
    ]);
  });

  it('does not mutate the source opportunities', () => {
    const items = [
      makeOpportunity({
        id: 'op-1',
        deadline: '2026-01-16',
        followUpDate: '2026-01-17',
        interviews: [makeInterview({ id: 'round-1', date: '2026-01-18' })],
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(items)) as Opportunity[];

    nextDaysEvents(deriveCalendarEvents(items), TODAY);

    expect(items).toEqual(snapshot);
  });
});

describe('calendarEventTiming', () => {
  it('uses distinct overdue wording and leaves non-Scheduled interviews to their status badge', () => {
    const events = deriveCalendarEvents([
      makeOpportunity({
        id: 'op-1',
        deadline: '2026-01-14',
        followUpDate: '2026-01-13',
        interviews: [
          makeInterview({ id: 'past', date: '2026-01-12', status: 'Scheduled' }),
          makeInterview({ id: 'done', date: '2026-01-12', status: 'Completed' }),
        ],
      }),
      makeOpportunity({ id: 'op-2', deadline: '2026-01-15' }),
    ]);

    const [followUp, interview, deadline, followUpToday] = [
      events.find((event) => event.id === 'follow-up:op-1')!,
      events.find((event) => event.id === 'interview:op-1:past')!,
      events.find((event) => event.id === 'deadline:op-1')!,
      events.find((event) => event.id === 'deadline:op-2')!,
    ];

    expect(calendarEventTiming(followUp, TODAY)).toEqual({
      state: 'overdue',
      text: 'Follow-up overdue by 2 days',
    });
    expect(calendarEventTiming(interview, TODAY)).toEqual({
      state: 'overdue',
      text: 'Interview date passed 3 days ago; still Scheduled',
    });
    expect(calendarEventTiming(deadline, TODAY)).toEqual({
      state: 'overdue',
      text: 'Deadline overdue by 1 day',
    });
    expect(calendarEventTiming(followUpToday, TODAY)).toEqual({
      state: 'today',
      text: 'Due today',
    });
    expect(
      calendarEventTiming(events.find((event) => event.id === 'interview:op-1:done')!, TODAY),
    ).toBeNull();
  });
});

describe('task calendar events', () => {
  it('derives only dated open tasks and keeps their identity and priority distinct', () => {
    const item = makeOpportunity({
      id: 'task-parent',
      title: 'Frontend Intern',
      company: 'Northwind',
      tasks: [
        {
          id: 'late',
          title: 'Send recruiter follow-up',
          notes: '',
          priority: 'High',
          dueDate: '2026-01-14',
          completed: false,
          completedOn: '',
        },
        {
          id: 'today',
          title: 'Tailor CV',
          notes: '',
          priority: 'Medium',
          dueDate: TODAY,
          completed: false,
          completedOn: '',
        },
        {
          id: 'future',
          title: 'Prepare portfolio',
          notes: '',
          priority: 'Low',
          dueDate: '2026-01-20',
          completed: false,
          completedOn: '',
        },
        {
          id: 'unscheduled',
          title: 'Research team',
          notes: '',
          priority: 'Medium',
          dueDate: '',
          completed: false,
          completedOn: '',
        },
        {
          id: 'completed',
          title: 'Update profile',
          notes: '',
          priority: 'Low',
          dueDate: TODAY,
          completed: true,
          completedOn: TODAY,
        },
        {
          id: 'invalid',
          title: 'Invalid due date',
          notes: '',
          priority: 'Medium',
          dueDate: '2026-02-30',
          completed: false,
          completedOn: '',
        },
      ],
    });

    const events = deriveCalendarEvents([item]);
    const taskEvents = events.filter((event) => event.type === 'task');

    expect(taskEvents).toHaveLength(3);
    expect(taskEvents.map((event) => event.id)).toEqual([
      'task:task-parent:late',
      'task:task-parent:today',
      'task:task-parent:future',
    ]);
    expect(taskEvents[0]).toMatchObject({
      type: 'task',
      opportunityId: 'task-parent',
      opportunityTitle: 'Frontend Intern',
      opportunityCompany: 'Northwind',
      date: '2026-01-14',
      taskId: 'late',
      taskTitle: 'Send recruiter follow-up',
      taskPriority: 'High',
    });
    expect(calendarEventTiming(taskEvents[0], TODAY)).toEqual({
      state: 'overdue',
      text: 'Task overdue by 1 day',
    });
    expect(calendarEventTiming(taskEvents[1], TODAY)).toEqual({
      state: 'today',
      text: 'Task due today',
    });
    expect(calendarEventTiming(taskEvents[2], TODAY)).toEqual({
      state: 'upcoming',
      text: 'Task due in 5 days',
    });
    expect(overdueEvents(events, TODAY).map((event) => event.id)).toContain('task:task-parent:late');
    expect(upcomingEvents(events, TODAY).map((event) => event.id)).toContain('task:task-parent:today');
  });

  it('adds a dedicated Tasks filter without changing deadline, follow-up or interview filtering', () => {
    const events = deriveCalendarEvents([
      allTypesOpportunity({
        tasks: [{
          id: 'action',
          title: 'Prepare work sample',
          notes: '',
          priority: 'High',
          dueDate: '2026-01-19',
          completed: false,
          completedOn: '',
        }],
      }),
    ]);

    expect(filterCalendarEvents(events, 'task').map((event) => event.id)).toEqual([
      'task:op-1:action',
    ]);
    expect(filterCalendarEvents(events, 'deadline').map((event) => event.id)).toEqual([
      'deadline:op-1',
    ]);
    expect(filterCalendarEvents(events, 'follow-up').map((event) => event.id)).toEqual([
      'follow-up:op-1',
    ]);
    expect(filterCalendarEvents(events, 'interview')).toHaveLength(2);
    expect(filterCalendarEvents(events, 'all')).toHaveLength(5);
  });

  it('excludes tasks belonging to archived opportunities and never mutates their source', () => {
    const items = [
      makeOpportunity({
        id: 'active',
        tasks: [{
          id: 'visible',
          title: 'Visible task',
          notes: '',
          priority: 'Medium',
          dueDate: '2026-01-19',
          completed: false,
          completedOn: '',
        }],
      }),
      makeOpportunity({
        id: 'archived',
        archivedAt: '2026-01-10T10:00:00.000Z',
        tasks: [{
          id: 'hidden',
          title: 'Archived task',
          notes: '',
          priority: 'High',
          dueDate: '2026-01-19',
          completed: false,
          completedOn: '',
        }],
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(items)) as Opportunity[];

    const events = deriveCalendarEvents(items);
    expect(events.filter((event) => event.type === 'task').map((event) => event.id)).toEqual([
      'task:active:visible',
    ]);
    expect(items).toEqual(snapshot);
  });
});

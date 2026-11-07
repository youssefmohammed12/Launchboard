import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeInterview, makeOpportunity } from '../test/fixtures';
import type { Opportunity } from '../types/opportunity';
import { Calendar } from './Calendar';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 15, 12, 0, 0));
});

function sectionByHeading(name: string | RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`Section for "${String(name)}" was not found`);
  return section as HTMLElement;
}

function renderCalendar(
  items: Opportunity[],
  onOpen = vi.fn(),
  onOpenTask = vi.fn(),
) {
  render(<Calendar items={items} onOpen={onOpen} onOpenTask={onOpenTask} />);
  return { onOpen, onOpenTask };
}

describe('Calendar page', () => {
  it('renders a Sunday-first month grid with a labelled today and selected date', () => {
    renderCalendar([]);

    expect(screen.getByRole('heading', { name: 'January 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((heading) => heading.textContent)).toEqual([
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
    ]);

    const today = screen.getByRole('button', { name: /January 15, 2026/ });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('aria-pressed', 'true');
    expect(today).toHaveAccessibleName(/January 15, 2026\. Today\. Selected/);
  });

  it('navigates months and returns to today', () => {
    renderCalendar([]);

    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'February 2026' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'January 2026' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByRole('heading', { name: 'December 2025' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByRole('heading', { name: 'January 2026' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /January 15, 2026/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('selects a date and shows its events in the selected-day agenda', () => {
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      deadline: '2026-01-20',
    });
    renderCalendar([item]);

    const date = screen.getByRole('button', { name: /January 20, 2026/ });
    expect(date).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(date);
    expect(date).toHaveAttribute('aria-pressed', 'true');

    const agenda = sectionByHeading('Selected day');
    expect(within(agenda).getByText(/January 20, 2026/)).toBeInTheDocument();
    expect(
      within(agenda).getByRole('button', {
        name: /Open Frontend Intern for deadline on Jan 20, 2026/,
      }),
    ).toBeInTheDocument();
    expect(within(agenda).getByText('Deadline')).toBeInTheDocument();
    expect(within(agenda).getByText('Northwind Labs')).toBeInTheDocument();
  });

  it('applies the event-type filter to the agenda, month cells, overdue and upcoming', () => {
    const items = [
      makeOpportunity({
        id: 'deadline',
        title: 'Deadline Role',
        deadline: '2026-01-15',
      }),
      makeOpportunity({
        id: 'follow-up',
        title: 'Follow-up Role',
        followUpDate: '2026-01-15',
      }),
      makeOpportunity({
        id: 'interview',
        title: 'Interview Role',
        interviews: [
          makeInterview({
            id: 'round-1',
            round: 'Technical Round',
            date: '2026-01-15',
            time: '10:00',
          }),
        ],
      }),
    ];
    renderCalendar(items);

    const agenda = sectionByHeading('Selected day');
    expect(within(agenda).getAllByRole('button')).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Interviews' }));
    expect(screen.getByRole('button', { name: 'Interviews' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(agenda).getAllByRole('button')).toHaveLength(1);
    expect(
      within(agenda).getByRole('button', {
        name: /Open Interview Role for Technical Round interview/,
      }),
    ).toBeInTheDocument();
    expect(within(agenda).queryByText('Deadline Role')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /January 15, 2026/ }),
    ).toHaveAccessibleName(/1 interview: Technical Round: Scheduled interview/);
  });

  it('separates overdue and upcoming events and excludes historical interviews from Upcoming', () => {
    const items = [
      makeOpportunity({
        id: 'overdue-deadline',
        title: 'Overdue Deadline',
        deadline: '2026-01-14',
      }),
      makeOpportunity({
        id: 'overdue-follow-up',
        title: 'Overdue Follow-up',
        followUpDate: '2026-01-13',
      }),
      makeOpportunity({
        id: 'past-interview',
        title: 'Past Interview',
        interviews: [
          makeInterview({
            id: 'past-scheduled',
            round: 'Past Scheduled',
            date: '2026-01-12',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'past-completed',
            round: 'Past Completed',
            date: '2026-01-11',
            status: 'Completed',
          }),
          makeInterview({
            id: 'past-cancelled',
            round: 'Past Cancelled',
            date: '2026-01-10',
            status: 'Cancelled',
          }),
        ],
      }),
      makeOpportunity({
        id: 'upcoming-deadline',
        title: 'Upcoming Deadline',
        deadline: '2026-01-20',
      }),
      makeOpportunity({
        id: 'upcoming-follow-up',
        title: 'Upcoming Follow-up',
        followUpDate: '2026-01-18',
      }),
      makeOpportunity({
        id: 'upcoming-interview',
        title: 'Upcoming Interview',
        interviews: [
          makeInterview({
            id: 'future-scheduled',
            round: 'Future Scheduled',
            date: '2026-01-16',
            status: 'Scheduled',
          }),
          makeInterview({
            id: 'future-completed',
            round: 'Future Completed',
            date: '2026-01-17',
            status: 'Completed',
          }),
          makeInterview({
            id: 'future-cancelled',
            round: 'Future Cancelled',
            date: '2026-01-19',
            status: 'Cancelled',
          }),
        ],
      }),
      makeOpportunity({
        id: 'beyond-range',
        title: 'Beyond Range',
        deadline: '2026-01-30',
      }),
    ];
    renderCalendar(items);

    const overdue = sectionByHeading('Overdue');
    expect(within(overdue).getAllByRole('button')).toHaveLength(3);
    expect(within(overdue).getByText('Deadline overdue by 1 day')).toBeInTheDocument();
    expect(within(overdue).getByText('Follow-up overdue by 2 days')).toBeInTheDocument();
    expect(
      within(overdue).getByText('Interview date passed 3 days ago; still Scheduled'),
    ).toBeInTheDocument();
    expect(within(overdue).queryByText('Past Completed')).not.toBeInTheDocument();
    expect(within(overdue).queryByText('Past Cancelled')).not.toBeInTheDocument();

    const upcoming = sectionByHeading('Upcoming');
    expect(within(upcoming).getAllByRole('button')).toHaveLength(3);
    expect(within(upcoming).getByText('Upcoming Deadline')).toBeInTheDocument();
    expect(within(upcoming).getByText('Upcoming Follow-up')).toBeInTheDocument();
    expect(within(upcoming).getByText('Upcoming Interview')).toBeInTheDocument();
    expect(within(upcoming).queryByText('Future Completed')).not.toBeInTheDocument();
    expect(within(upcoming).queryByText('Future Cancelled')).not.toBeInTheDocument();
    expect(within(upcoming).queryByText('Beyond Range')).not.toBeInTheDocument();
  });

  it('excludes archived opportunities from the grid, agenda, overdue and upcoming', () => {
    renderCalendar([
      makeOpportunity({
        id: 'archived',
        title: 'Archived Role',
        deadline: '2026-01-15',
        followUpDate: '2026-01-14',
        archivedAt: '2026-03-04T09:30:00.000Z',
        interviews: [
          makeInterview({
            id: 'archived-round',
            round: 'Archived Round',
            date: '2026-01-16',
            status: 'Scheduled',
          }),
        ],
      }),
    ]);

    expect(screen.getByText('No events in January 2026.')).toBeInTheDocument();
    expect(screen.getByText('No events on this day.')).toBeInTheDocument();
    expect(screen.getByText('No overdue events.')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled in the next 14 days.')).toBeInTheDocument();
    expect(screen.queryByText('Archived Role')).not.toBeInTheDocument();
  });

  it('shows specific empty states instead of treating them as errors', () => {
    renderCalendar([]);

    expect(screen.getByText('No events in January 2026.')).toBeInTheDocument();
    expect(screen.getByText('No events on this day.')).toBeInTheDocument();
    expect(screen.getByText('No overdue events.')).toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled in the next 14 days.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Interviews' }));
    expect(
      screen.getByText('No interviews scheduled yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No events in January 2026 for the selected filter.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('No events on this day for the selected filter.'),
    ).toBeInTheDocument();
  });

  it('opens the parent opportunity from an event and passes the trigger for focus restoration', () => {
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      deadline: '2026-01-15',
    });
    const { onOpen } = renderCalendar([item]);

    const eventButton = within(sectionByHeading('Selected day')).getByRole('button', {
      name: /Open Frontend Intern for deadline on Jan 15, 2026/,
    });
    fireEvent.click(eventButton);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe(item);
    expect(onOpen.mock.calls[0][1]).toBe(eventButton);
  });

  it('uses roving focus and arrow keys across month boundaries', () => {
    renderCalendar([]);

    const january31 = screen.getByRole('button', { name: /January 31, 2026/ });
    fireEvent.click(january31);
    january31.focus();
    expect(january31).toHaveFocus();

    fireEvent.keyDown(january31, { key: 'ArrowRight' });

    expect(screen.getByRole('heading', { name: 'February 2026' })).toBeInTheDocument();
    const february1 = screen.getByRole('button', { name: /February 1, 2026/ });
    expect(february1).toHaveFocus();
    expect(february1).toHaveAttribute('tabindex', '0');
  });

  it('keeps Completed and Cancelled interviews inspectable on the month grid', () => {
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      interviews: [
        makeInterview({
          id: 'completed',
          round: 'Final Round',
          date: '2026-01-15',
          status: 'Completed',
        }),
        makeInterview({
          id: 'cancelled',
          round: 'Cancelled Round',
          date: '2026-01-15',
          status: 'Cancelled',
        }),
      ],
    });
    renderCalendar([item]);

    expect(screen.getByRole('button', { name: /January 15, 2026/ })).toHaveAccessibleName(
      /Cancelled Round: Cancelled interview, Final Round: Completed interview/,
    );

    const agenda = sectionByHeading('Selected day');
    expect(within(agenda).getByText('Completed')).toBeInTheDocument();
    expect(within(agenda).getByText('Cancelled')).toBeInTheDocument();
    expect(within(agenda).queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

  it('shows dated open tasks in a distinct Tasks filter and opens the task action context', () => {
    const item = makeOpportunity({
      id: 'task-opportunity',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      tasks: [
        {
          id: 'prepare-cv',
          title: 'Tailor my CV',
          notes: '',
          priority: 'High',
          dueDate: '2026-01-15',
          completed: false,
          completedOn: '',
        },
        {
          id: 'completed',
          title: 'Completed task',
          notes: '',
          priority: 'Low',
          dueDate: '2026-01-15',
          completed: true,
          completedOn: '2026-01-15',
        },
        {
          id: 'unscheduled',
          title: 'Unscheduled task',
          notes: '',
          priority: 'Medium',
          dueDate: '',
          completed: false,
          completedOn: '',
        },
      ],
    });
    const onOpen = vi.fn();
    const onOpenTask = vi.fn();
    renderCalendar([item], onOpen, onOpenTask);

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');

    const agenda = sectionByHeading('Selected day');
    const taskButton = within(agenda).getByRole('button', {
      name: 'Open task Tailor my CV for Frontend Intern on Jan 15, 2026',
    });
    expect(within(taskButton).getByText('Task')).toBeInTheDocument();
    expect(within(taskButton).getByText('High priority')).toBeInTheDocument();
    expect(within(taskButton).getByText('Task due today')).toBeInTheDocument();
    expect(within(agenda).queryByText('Completed task')).not.toBeInTheDocument();
    expect(within(agenda).queryByText('Unscheduled task')).not.toBeInTheDocument();

    fireEvent.click(taskButton);
    expect(onOpenTask).toHaveBeenCalledWith('task-opportunity', 'prepare-cv', taskButton);
    expect(onOpen).not.toHaveBeenCalled();
  });

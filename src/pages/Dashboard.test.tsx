import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysToISODate } from '../utils/dates';
import { makeInterview, makeOpportunity } from '../test/fixtures';
import type { Opportunity } from '../types/opportunity';
import { Dashboard } from './Dashboard';

const TODAY = '2026-01-15';

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

function renderDashboard(items: Opportunity[]) {
  const onAdd = vi.fn();
  const onOpen = vi.fn();
  const onOpenTask = vi.fn();
  const onOpenActionCenter = vi.fn();
  const onOpenCalendar = vi.fn();
  render(
    <Dashboard
      items={items}
      onAdd={onAdd}
      onOpen={onOpen}
      onOpenTask={onOpenTask}
      onOpenActionCenter={onOpenActionCenter}
      onOpenCalendar={onOpenCalendar}
    />,
  );
  return { onAdd, onOpen, onOpenTask, onOpenActionCenter, onOpenCalendar };
}

function upcomingItems(): HTMLElement[] {
  return within(sectionByHeading('Next 7 Days')).getAllByRole('listitem');
}

describe('Dashboard Next 7 Days', () => {
  it('shows the inclusive range in chronological order with type, date and relative labels', () => {
    const items = [
      makeOpportunity({
        id: 'sixth',
        title: 'Sixth Day Role',
        company: 'Sixth Co',
        deadline: '2026-01-21',
      }),
      makeOpportunity({
        id: 'deadline',
        title: 'Deadline Role',
        company: 'Deadline Co',
        deadline: '2026-01-17',
      }),
      makeOpportunity({
        id: 'follow-up',
        title: 'Follow-up Role',
        company: 'Follow-up Co',
        status: 'Offer',
        followUpDate: '2026-01-16',
      }),
      makeOpportunity({
        id: 'interview',
        title: 'Interview Role',
        company: 'Interview Co',
        interviews: [
          makeInterview({
            id: 'round-1',
            round: 'Technical Round',
            date: TODAY,
            time: '10:30',
            mode: 'Video',
            status: 'Scheduled',
          }),
        ],
      }),
      makeOpportunity({ id: 'yesterday', title: 'Yesterday Role', deadline: '2026-01-14' }),
      makeOpportunity({ id: 'seventh', title: 'Seventh Day Role', deadline: '2026-01-22' }),
    ];
    renderDashboard(items);

    const rows = upcomingItems();
    expect(rows).toHaveLength(4);

    expect(within(rows[0]).getByText('Interview Role')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Interview')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Today')).toBeInTheDocument();
    expect(within(rows[0]).getByText('10:30')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Video')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Round: Technical Round')).toBeInTheDocument();

    expect(within(rows[1]).getByText('Follow-up Role')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Follow-up')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Tomorrow')).toBeInTheDocument();

    expect(within(rows[2]).getByText('Deadline Role')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Deadline')).toBeInTheDocument();

    expect(within(rows[3]).getByText('Sixth Day Role')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Jan 21, 2026')).toBeInTheDocument();

    const section = sectionByHeading('Next 7 Days');
    expect(within(section).queryByText('Yesterday Role')).not.toBeInTheDocument();
    expect(within(section).queryByText('Seventh Day Role')).not.toBeInTheDocument();
  });

  it('handles a month and year transition at the end of the inclusive range', () => {
    vi.setSystemTime(new Date(2026, 11, 28, 12, 0, 0));
    renderDashboard([
      makeOpportunity({ id: 'before', title: 'Before Range', deadline: '2026-12-27' }),
      makeOpportunity({ id: 'today', title: 'Range Starts', deadline: '2026-12-28' }),
      makeOpportunity({ id: 'end', title: 'Range Ends', deadline: '2027-01-03' }),
      makeOpportunity({ id: 'after', title: 'After Range', deadline: '2027-01-04' }),
    ]);

    const rows = upcomingItems();
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Range Starts'),
      expect.stringContaining('Range Ends'),
    ]);
    expect(screen.getByText(/Today through Jan 3, 2027/)).toBeInTheDocument();
    const section = sectionByHeading('Next 7 Days');
    expect(within(section).queryByText('Before Range')).not.toBeInTheDocument();
    expect(within(section).queryByText('After Range')).not.toBeInTheDocument();
  });

  it('applies calendar eligibility: Offer/Rejected deadlines are excluded, follow-ups are kept and only Scheduled interviews appear', () => {
    renderDashboard([
      makeOpportunity({ id: 'offer', title: 'Offer Deadline', status: 'Offer', deadline: '2026-01-16' }),
      makeOpportunity({
        id: 'rejected',
        title: 'Rejected Follow-up',
        status: 'Rejected',
        followUpDate: '2026-01-17',
      }),
      makeOpportunity({
        id: 'interviews',
        title: 'Interview History',
        interviews: [
          makeInterview({ id: 'scheduled', round: 'Scheduled Round', date: '2026-01-18' }),
          makeInterview({ id: 'completed', round: 'Completed Round', date: '2026-01-19', status: 'Completed' }),
          makeInterview({ id: 'cancelled', round: 'Cancelled Round', date: '2026-01-20', status: 'Cancelled' }),
        ],
      }),
    ]);

    const section = sectionByHeading('Next 7 Days');
    expect(within(section).getByText('Rejected Follow-up')).toBeInTheDocument();
    expect(within(section).getByText('Interview History')).toBeInTheDocument();
    expect(within(section).queryByText('Offer Deadline')).not.toBeInTheDocument();
    expect(within(section).queryByText('Completed Round')).not.toBeInTheDocument();
    expect(within(section).queryByText('Cancelled Round')).not.toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows at most five events and clearly distinguishes the visible subset from all matches', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      makeOpportunity({
        id: `op-${index}`,
        title: `Event ${index + 1}`,
        deadline: addDaysToISODate(TODAY, index) ?? TODAY,
      }),
    );
    const { onOpenCalendar } = renderDashboard(items);

    const rows = upcomingItems();
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText('Event 1')).toBeInTheDocument();
    expect(within(rows[4]).getByText('Event 5')).toBeInTheDocument();
    const summaryQueries = within(sectionByHeading('Next 7 Days'));
    expect(summaryQueries.queryByText('Event 6')).not.toBeInTheDocument();
    expect(summaryQueries.queryByText('Event 7')).not.toBeInTheDocument();

    expect(screen.getByText('Showing 5 of 7 events.')).toBeInTheDocument();
    expect(screen.getByText('2 more in the Calendar.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View calendar' }));
    expect(onOpenCalendar).toHaveBeenCalledTimes(1);
  });

  it('uses an empty state with a Calendar action when nothing falls in the range', () => {
    const { onOpenCalendar } = renderDashboard([]);

    expect(screen.getByText('Nothing scheduled in the next 7 days.')).toBeInTheDocument();
    expect(
      screen.getByText(/Today through Jan 21, 2026 · 7 calendar days including today/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open Calendar' }));
    expect(onOpenCalendar).toHaveBeenCalledTimes(1);
  });

  it('opens the associated opportunity and passes the event control for focus restoration', () => {
    const item = makeOpportunity({
      id: 'op-1',
      title: 'Frontend Intern',
      deadline: '2026-01-16',
    });
    const { onOpen } = renderDashboard([item]);

    const eventButton = screen.getByRole('button', {
      name: 'Open Frontend Intern for deadline on Jan 16, 2026',
    });
    fireEvent.click(eventButton);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith(item, eventButton);
  });

  it('excludes archived opportunities from stats, recent records and Next 7 Days', () => {
    renderDashboard([
      makeOpportunity({
        id: 'active',
        title: 'Active Role',
        status: 'Interview',
        deadline: '2026-01-16',
      }),
      makeOpportunity({
        id: 'archived',
        title: 'Archived Role',
        status: 'Offer',
        deadline: '2026-01-17',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ]);

    const totalCard = screen.getByText('Total Opportunities').closest('div');
    const offersCard = screen.getByText('Offers').closest('div');
    expect(within(totalCard as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(offersCard as HTMLElement).getByText('0')).toBeInTheDocument();

    const recentRows = within(sectionByHeading('Recent opportunities')).getAllByRole('listitem');
    expect(recentRows).toHaveLength(1);
    expect(within(recentRows[0]).getByText('Active Role')).toBeInTheDocument();
    expect(screen.queryByText('Archived Role')).not.toBeInTheDocument();

    const upcoming = sectionByHeading('Next 7 Days');
    expect(within(upcoming).getByText('Active Role')).toBeInTheDocument();
    expect(within(upcoming).queryByText('Archived Role')).not.toBeInTheDocument();
  });

  it('preserves summary statistics, recent opportunities, add and the consolidated layout', () => {
    const items = [
      makeOpportunity({ id: 'oldest', title: 'Oldest Role', status: 'Applied' }),
      makeOpportunity({ id: 'middle', title: 'Middle Role', status: 'Interview' }),
      makeOpportunity({ id: 'newest', title: 'Newest Role', status: 'Offer' }),
    ];
    const { onAdd } = renderDashboard(items);

    const totalCard = screen.getByText('Total Opportunities').closest('div');
    const sentCard = screen.getByText('Applications Sent').closest('div');
    const interviewsCard = screen.getByText('Interviews').closest('div');
    const offersCard = screen.getByText('Offers').closest('div');
    expect(within(totalCard as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(sentCard as HTMLElement).getByText('3')).toBeInTheDocument();
    expect(within(interviewsCard as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(offersCard as HTMLElement).getByText('1')).toBeInTheDocument();

    const recentRows = within(sectionByHeading('Recent opportunities')).getAllByRole('listitem');
    expect(recentRows).toHaveLength(3);
    expect(within(recentRows[0]).getByText('Newest Role')).toBeInTheDocument();
    expect(within(recentRows[2]).getByText('Oldest Role')).toBeInTheDocument();

    // The redundant deadline and follow-up panels were consolidated into one derived summary.
    expect(screen.queryByRole('heading', { name: 'Upcoming deadlines' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Follow-ups' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Opportunity' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe("Dashboard Today's Focus", () => {
  it('shows only overdue and due-today open tasks and keeps them out of Next 7 Days', () => {
    const active = makeOpportunity({
      id: 'active',
      title: 'Frontend Intern',
      tasks: [
        {
          id: 'late',
          title: 'Send a recruiter follow-up',
          notes: '',
          priority: 'High',
          dueDate: '2026-01-14',
          completed: false,
          completedOn: '',
        },
        {
          id: 'today',
          title: 'Tailor my CV',
          notes: '',
          priority: 'Medium',
          dueDate: TODAY,
          completed: false,
          completedOn: '',
        },
        {
          id: 'later',
          title: 'Prepare portfolio',
          notes: '',
          priority: 'Low',
          dueDate: '2026-01-16',
          completed: false,
          completedOn: '',
        },
        {
          id: 'unscheduled',
          title: 'Research the team',
          notes: '',
          priority: 'Medium',
          dueDate: '',
          completed: false,
          completedOn: '',
        },
        {
          id: 'completed',
          title: 'Update LinkedIn',
          notes: '',
          priority: 'Low',
          dueDate: TODAY,
          completed: true,
          completedOn: TODAY,
        },
      ],
    });
    const archived = makeOpportunity({
      id: 'archived',
      title: 'Archived Role',
      archivedAt: '2026-01-10T10:00:00.000Z',
      tasks: [{
        id: 'archived-late',
        title: 'Archived task',
        notes: '',
        priority: 'High',
        dueDate: '2026-01-13',
        completed: false,
        completedOn: '',
      }],
    });
    const { onOpenTask, onOpenActionCenter } = renderDashboard([active, archived]);

    const focus = sectionByHeading("Today's Focus");
    const rows = within(focus).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Send a recruiter follow-up')).toBeInTheDocument();
    expect(within(rows[0]).getByText('High')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Overdue by 1 day')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Tailor my CV')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Due today')).toBeInTheDocument();
    expect(within(focus).queryByText('Prepare portfolio')).not.toBeInTheDocument();
    expect(within(focus).queryByText('Research the team')).not.toBeInTheDocument();
    expect(within(focus).queryByText('Update LinkedIn')).not.toBeInTheDocument();
    expect(within(focus).queryByText('Archived task')).not.toBeInTheDocument();

    const nextDays = sectionByHeading('Next 7 Days');
    expect(within(nextDays).queryByText('Send a recruiter follow-up')).not.toBeInTheDocument();
    expect(within(nextDays).queryByText('Tailor my CV')).not.toBeInTheDocument();

    const taskButton = within(focus).getByRole('button', {
      name: 'Open task Send a recruiter follow-up for Frontend Intern',
    });
    fireEvent.click(taskButton);
    expect(onOpenTask).toHaveBeenCalledWith('active', 'late', taskButton);

    fireEvent.click(within(focus).getByRole('button', { name: 'View all actions' }));
    expect(onOpenActionCenter).toHaveBeenCalledTimes(1);
  });

  it('shows a calm empty state when no overdue or due-today work exists', () => {
    const { onOpenActionCenter } = renderDashboard([
      makeOpportunity({
        tasks: [{
          id: 'future',
          title: 'Prepare interview',
          notes: '',
          priority: 'Medium',
          dueDate: '2026-01-16',
          completed: false,
          completedOn: '',
        }],
      }),
    ]);

    const focus = sectionByHeading("Today's Focus");
    expect(within(focus).getByText('Nothing overdue or due today.')).toBeInTheDocument();
    expect(within(focus).queryByRole('listitem')).not.toBeInTheDocument();
    fireEvent.click(within(focus).getByRole('button', { name: 'View all actions' }));
    expect(onOpenActionCenter).toHaveBeenCalledTimes(1);
  });
});

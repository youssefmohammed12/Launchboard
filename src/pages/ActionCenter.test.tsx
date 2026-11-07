import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskDraft, TaskEntry } from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import { makeOpportunity } from '../test/fixtures';
import { ActionCenter } from './ActionCenter';
import { toISODate } from '../utils/dates';

function makeTask(overrides: Partial<TaskEntry> = {}): TaskEntry {
  return {
    id: 'task-1',
    title: 'Prepare application',
    notes: '',
    priority: 'Medium',
    dueDate: '',
    completed: false,
    completedOn: '',
    ...overrides,
  };
}

function renderCenter(items: Opportunity[]) {
  const handlers = {
    onOpen: vi.fn(),
    onCreate: vi.fn(async (_opportunityId: string, _draft: TaskDraft) => true),
    onUpdate: vi.fn(async (_opportunityId: string, _taskId: string, _draft: TaskDraft) => true),
    onComplete: vi.fn(async (_opportunityId: string, _taskId: string) => true),
    onReopen: vi.fn(async (_opportunityId: string, _taskId: string) => true),
    onDelete: vi.fn(async (_opportunityId: string, _taskId: string) => true),
  };
  render(<ActionCenter items={items} {...handlers} />);
  return handlers;
}

describe('ActionCenter', () => {
  it('groups active opportunity tasks and excludes archived opportunities', () => {
    const today = toISODate(new Date());
    const active = makeOpportunity({
      tasks: [
        makeTask({ id: 'late', title: 'Send follow-up', dueDate: '2020-01-01', priority: 'High' }),
        makeTask({ id: 'today', title: 'Review job description', dueDate: today }),
        makeTask({ id: 'later', title: 'Prepare portfolio', dueDate: '2999-01-01' }),
        makeTask({ id: 'open', title: 'Find a hiring manager' }),
        makeTask({
          id: 'done',
          title: 'Update CV',
          completed: true,
          completedOn: today,
        }),
      ],
    });
    const archived = makeOpportunity({
      id: 'archived',
      title: 'Archived opportunity',
      archivedAt: '2026-11-01T10:00:00.000Z',
      tasks: [makeTask({ id: 'hidden', title: 'Hidden archived task' })],
    });

    renderCenter([active, archived]);

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Due today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No due date' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed' })).toBeInTheDocument();

    for (const title of [
      'Send follow-up',
      'Review job description',
      'Prepare portfolio',
      'Find a hiring manager',
      'Update CV',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.queryByText('Hidden archived task')).not.toBeInTheDocument();
    expect(screen.getByText('Overdue', { selector: 'span' })).toBeInTheDocument();
  });

  it('completes and reopens tasks through their owning opportunity', async () => {
    const today = toISODate(new Date());
    const opportunity = makeOpportunity({
      tasks: [
        makeTask({ id: 'open-task', title: 'Send application' }),
        makeTask({
          id: 'done-task',
          title: 'Research company',
          completed: true,
          completedOn: today,
        }),
      ],
    });
    const handlers = renderCenter([opportunity]);

    fireEvent.click(screen.getByRole('button', { name: 'Mark Send application complete' }));
    await waitFor(() => expect(handlers.onComplete).toHaveBeenCalledWith('op-1', 'open-task'));

    fireEvent.click(screen.getByRole('button', { name: 'Reopen Research company' }));
    await waitFor(() => expect(handlers.onReopen).toHaveBeenCalledWith('op-1', 'done-task'));
  });

  it('opens the owning opportunity from a task row', () => {
    const opportunity = makeOpportunity({
      tasks: [makeTask({ id: 'task-link', title: 'Send the recruiter a note' })],
    });
    const handlers = renderCenter([opportunity]);

    fireEvent.click(screen.getByRole('button', { name: /Frontend Intern · Northwind Labs/ }));
    expect(handlers.onOpen).toHaveBeenCalledWith(opportunity, expect.any(HTMLButtonElement));
  });

  it('creates a task with the selected opportunity and normalized content', async () => {
    const opportunity = makeOpportunity();
    const handlers = renderCenter([opportunity]);

    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add task' });
    fireEvent.change(within(dialog).getByLabelText(/Task title/), {
      target: { value: '  Tailor my CV  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Priority'), {
      target: { value: 'High' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Due date/), {
      target: { value: '2026-11-12' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Notes/), {
      target: { value: 'Focus on the required skills' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(handlers.onCreate).toHaveBeenCalledWith('op-1', {
      title: 'Tailor my CV',
      notes: 'Focus on the required skills',
      priority: 'High',
      dueDate: '2026-11-12',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add task' })).not.toBeInTheDocument());
  });

  it('keeps the editor open and reports a blank title', () => {
    renderCenter([makeOpportunity()]);
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
    const dialog = screen.getByRole('dialog', { name: 'Add task' });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Create task' }).closest('form')!);

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a task title.');
    expect(screen.getByRole('dialog', { name: 'Add task' })).toBeInTheDocument();
  });

  it('edits a task without changing its parent and confirms deletion', async () => {
    const opportunity = makeOpportunity({
      tasks: [makeTask({ id: 'task-edit', title: 'Initial action' })],
    });
    const handlers = renderCenter([opportunity]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Initial action' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit task' });
    fireEvent.change(within(dialog).getByLabelText(/Task title/), {
      target: { value: 'Updated action' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(handlers.onUpdate).toHaveBeenCalledWith('op-1', 'task-edit', {
      title: 'Updated action',
      notes: '',
      priority: 'Medium',
      dueDate: '',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete Initial action' }));
    const confirm = screen.getByRole('dialog', { name: 'Delete task' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete task' }));
    await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledWith('op-1', 'task-edit'));
  });

  it('prevents creating more than 100 tasks for a single opportunity', () => {
    const opportunity = makeOpportunity({
      tasks: Array.from({ length: 100 }, (_, index) => makeTask({
        id: `task-${index}`,
        title: `Task ${index}`,
      })),
    });
    renderCenter([opportunity]);

    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('100-task limit');
  });

  it('shows a helpful empty state when there are no active opportunities', () => {
    renderCenter([
      makeOpportunity({
        archivedAt: '2026-11-01T10:00:00.000Z',
        tasks: [makeTask()],
      }),
    ]);

    expect(screen.getByRole('heading', { name: 'No active opportunities yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
  });
});

  it('filters by priority and can hide completed tasks, with a clear-filters recovery', () => {
    const today = toISODate(new Date());
    const opportunity = makeOpportunity({
      tasks: [
        makeTask({ id: 'high-open', title: 'High priority follow-up', priority: 'High' }),
        makeTask({
          id: 'low-done',
          title: 'Completed low priority action',
          priority: 'Low',
          completed: true,
          completedOn: today,
        }),
      ],
    });
    renderCenter([opportunity]);

    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'Low' } });
    expect(screen.getByRole('heading', { name: 'Completed low priority action' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'High priority follow-up' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Show completed tasks'));
    expect(screen.getByRole('heading', { name: 'No tasks match these filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'High priority follow-up' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Completed low priority action' })).toBeInTheDocument();
  });

  it('focuses the requested task action when opened from Dashboard or Calendar', () => {
    const opportunity = makeOpportunity({
      id: 'focus-parent',
      tasks: [makeTask({ id: 'focus-task', title: 'Review the job requirements' })],
    });
    const onTaskFocusHandled = vi.fn();
    const handlers = {
      onOpen: vi.fn(),
      onCreate: vi.fn(async (_id: string, _draft: TaskDraft) => true),
      onUpdate: vi.fn(async (_id: string, _taskId: string, _draft: TaskDraft) => true),
      onComplete: vi.fn(async (_id: string, _taskId: string) => true),
      onReopen: vi.fn(async (_id: string, _taskId: string) => true),
      onDelete: vi.fn(async (_id: string, _taskId: string) => true),
    };

    render(
      <ActionCenter
        items={[opportunity]}
        focusTaskTarget={{ opportunityId: 'focus-parent', taskId: 'focus-task' }}
        onTaskFocusHandled={onTaskFocusHandled}
        {...handlers}
      />,
    );

    expect(screen.getByRole('button', {
      name: 'Mark Review the job requirements complete',
    })).toHaveFocus();
    expect(onTaskFocusHandled).toHaveBeenCalledTimes(1);
  });

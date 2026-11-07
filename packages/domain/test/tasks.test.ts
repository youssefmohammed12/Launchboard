import { describe, expect, it } from 'vitest';
import {
  MAX_TASKS,
  MAX_TASK_ID_LENGTH,
  MAX_TASK_NOTES_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  addOpportunityTask,
  classifyTask,
  completeOpportunityTask,
  deleteOpportunityTask,
  groupOpportunityTasks,
  reopenOpportunityTask,
  normalizeTaskEntry,
  normalizeTaskList,
  updateOpportunityTask,
  validateTaskEntry,
  type TaskEntry,
} from '../src/index';

const makeTask = (overrides: Partial<TaskEntry> = {}): TaskEntry => ({
  id: 'task-1',
  title: 'Follow up with recruiter',
  notes: '',
  priority: 'Medium',
  dueDate: '2026-11-07',
  completed: false,
  completedOn: '',
  ...overrides,
});

const withOpportunity = (
  task: TaskEntry,
  opportunityTitle = 'Frontend Developer',
  opportunityId = 'opportunity-1',
) => ({
  task,
  opportunityId,
  opportunityTitle,
  opportunityCompany: 'Example Company',
});

describe('task contract limits', () => {
  it('exports bounded task collection and field limits', () => {
    expect(MAX_TASKS).toBe(100);
    expect(MAX_TASK_ID_LENGTH).toBe(128);
    expect(MAX_TASK_TITLE_LENGTH).toBe(160);
    expect(MAX_TASK_NOTES_LENGTH).toBe(1000);
  });
});

describe('task validation', () => {
  it('accepts a valid open task and a valid completed task', () => {
    expect(validateTaskEntry(makeTask())).toEqual([]);
    expect(validateTaskEntry(makeTask({
      completed: true,
      completedOn: '2026-11-07',
    }))).toEqual([]);
  });

  it('requires a nonblank title and a bounded ID', () => {
    expect(validateTaskEntry(makeTask({ title: '   ' })).map((issue) => issue.field))
      .toContain('title');
    expect(validateTaskEntry(makeTask({ id: 'x'.repeat(MAX_TASK_ID_LENGTH + 1) }))
      .map((issue) => issue.field)).toContain('id');
  });

  it('rejects overlong titles and notes', () => {
    expect(validateTaskEntry(makeTask({ title: 'x'.repeat(MAX_TASK_TITLE_LENGTH + 1) }))
      .map((issue) => issue.field)).toContain('title');
    expect(validateTaskEntry(makeTask({ notes: 'x'.repeat(MAX_TASK_NOTES_LENGTH + 1) }))
      .map((issue) => issue.field)).toContain('notes');
  });

  it('rejects invalid priorities and impossible dates', () => {
    expect(validateTaskEntry(makeTask({ priority: 'Urgent' as TaskEntry['priority'] }))
      .map((issue) => issue.field)).toContain('priority');
    expect(validateTaskEntry(makeTask({ dueDate: '2026-02-30' }))
      .map((issue) => issue.field)).toContain('dueDate');
  });

  it('requires completion date and prevents open tasks from retaining one', () => {
    expect(validateTaskEntry(makeTask({ completed: true })).map((issue) => issue.field))
      .toContain('completedOn');
    expect(validateTaskEntry(makeTask({
      completed: false,
      completedOn: '2026-11-07',
    })).map((issue) => issue.field)).toContain('completedOn');
    expect(validateTaskEntry(makeTask({
      completed: true,
      completedOn: '2026-02-30',
    })).map((issue) => issue.field)).toContain('completedOn');
  });
});

describe('task normalization', () => {
  it('normalizes an older missing task collection without reporting damage', () => {
    expect(normalizeTaskList(undefined)).toEqual({
      tasks: [],
      repaired: false,
      invalidCount: 0,
      duplicateCount: 0,
      truncatedCount: 0,
    });
  });

  it('repairs optional fields, invalid priority/date and inconsistent completion', () => {
    const result = normalizeTaskEntry({
      id: 'task-1',
      title: '  Prepare interview  ',
      priority: 'Urgent',
      dueDate: '2026-02-30',
      completed: true,
      completedOn: 'not-a-date',
      notes: '  notes  ',
    });

    expect(result).toEqual({
      task: {
        id: 'task-1',
        title: 'Prepare interview',
        notes: 'notes',
        priority: 'Medium',
        dueDate: '',
        completed: false,
        completedOn: '',
      },
      repaired: true,
      failure: null,
    });
  });

  it('drops tasks that have no usable ID or title', () => {
    expect(normalizeTaskEntry({ title: 'Task' }).failure).toBe('invalid-id');
    expect(normalizeTaskEntry({ id: 'task-1', title: '   ' }).failure).toBe('missing-title');
    expect(normalizeTaskEntry(null).failure).toBe('not-an-object');
  });

  it('keeps the first valid task ID and caps the collection', () => {
    const duplicate = makeTask({ title: 'Duplicate ID' });
    const values = [
      makeTask(),
      duplicate,
      ...Array.from({ length: MAX_TASKS + 5 }, (_, index) =>
        makeTask({ id: `task-${index + 2}` })),
    ];
    const result = normalizeTaskList(values);

    expect(result.tasks).toHaveLength(MAX_TASKS);
    expect(result.tasks[0].title).toBe('Follow up with recruiter');
    expect(result.duplicateCount).toBe(1);
    expect(result.truncatedCount).toBeGreaterThan(0);
    expect(result.repaired).toBe(true);
  });

  it('repairs a non-array task collection to an empty list', () => {
    expect(normalizeTaskList({ invalid: true })).toMatchObject({
      tasks: [],
      repaired: true,
    });
  });
});

describe('task classification', () => {
  const today = '2026-11-07';

  it('classifies overdue, today and upcoming tasks by local calendar date', () => {
    expect(classifyTask(makeTask({ dueDate: '2026-11-06' }), today)).toBe('overdue');
    expect(classifyTask(makeTask({ dueDate: today }), today)).toBe('today');
    expect(classifyTask(makeTask({ dueDate: '2026-11-08' }), today)).toBe('upcoming');
  });

  it('classifies unscheduled and completed tasks separately', () => {
    expect(classifyTask(makeTask({ dueDate: '' }), today)).toBe('unscheduled');
    expect(classifyTask(makeTask({
      completed: true,
      completedOn: today,
    }), today)).toBe('completed');
  });

  it('does not invent a group for malformed dates or an invalid today value', () => {
    expect(classifyTask(makeTask({ dueDate: '2026-02-30' }), today)).toBeNull();
    expect(classifyTask(makeTask(), '2026-02-30')).toBeNull();
    expect(classifyTask(makeTask({
      completed: true,
      completedOn: '',
    }), today)).toBeNull();
  });
});

describe('Action Center grouping and ordering', () => {
  const today = '2026-11-07';

  it('returns every group and excludes tasks whose dates cannot be classified', () => {
    const groups = groupOpportunityTasks([
      withOpportunity(makeTask({ id: 'overdue', dueDate: '2026-11-06' })),
      withOpportunity(makeTask({ id: 'today', dueDate: today })),
      withOpportunity(makeTask({ id: 'upcoming', dueDate: '2026-11-08' })),
      withOpportunity(makeTask({ id: 'unscheduled', dueDate: '' })),
      withOpportunity(makeTask({
        id: 'completed',
        completed: true,
        completedOn: today,
      })),
      withOpportunity(makeTask({ id: 'invalid', dueDate: 'yesterday' })),
    ], today);

    expect(groups.overdue.map(({ task }) => task.id)).toEqual(['overdue']);
    expect(groups.today.map(({ task }) => task.id)).toEqual(['today']);
    expect(groups.upcoming.map(({ task }) => task.id)).toEqual(['upcoming']);
    expect(groups.unscheduled.map(({ task }) => task.id)).toEqual(['unscheduled']);
    expect(groups.completed.map(({ task }) => task.id)).toEqual(['completed']);
  });

  it('sorts by date, then High/Medium/Low priority and stable text identity', () => {
    const groups = groupOpportunityTasks([
      withOpportunity(makeTask({ id: 'low', dueDate: '2026-11-10', priority: 'Low' }), 'Zebra'),
      withOpportunity(makeTask({ id: 'medium', dueDate: '2026-11-09', priority: 'Medium' }), 'Beta'),
      withOpportunity(makeTask({ id: 'high-z', dueDate: '2026-11-09', priority: 'High' }), 'Zebra'),
      withOpportunity(makeTask({ id: 'high-a', dueDate: '2026-11-09', priority: 'High' }), 'Alpha'),
    ], today);

    expect(groups.upcoming.map(({ task }) => task.id))
      .toEqual(['high-a', 'high-z', 'medium', 'low']);
  });

  it('orders completed tasks by latest completion date first', () => {
    const groups = groupOpportunityTasks([
      withOpportunity(makeTask({
        id: 'older',
        completed: true,
        completedOn: '2026-11-05',
      })),
      withOpportunity(makeTask({
        id: 'newer',
        completed: true,
        completedOn: '2026-11-06',
      })),
    ], today);

    expect(groups.completed.map(({ task }) => task.id)).toEqual(['newer', 'older']);
  });

  it('returns empty groups when the supplied current date is invalid', () => {
    expect(groupOpportunityTasks([
      withOpportunity(makeTask()),
    ], '2026-02-30')).toEqual({
      overdue: [],
      today: [],
      upcoming: [],
      unscheduled: [],
      completed: [],
    });
  });
});


describe('task operations', () => {
  const draft = {
    title: '  Prepare interview  ',
    notes: '  Review the role  ',
    priority: 'High' as const,
    dueDate: '2026-11-09',
  };

  it('creates an open task with a stable ID and normalized editable content', () => {
    const initial = [makeTask({ id: 'existing' })];
    const result = addOpportunityTask(initial, draft, 'new-task');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(true);
    expect(result.tasks).toEqual([
      initial[0],
      {
        id: 'new-task',
        title: 'Prepare interview',
        notes: 'Review the role',
        priority: 'High',
        dueDate: '2026-11-09',
        completed: false,
        completedOn: '',
      },
    ]);
    expect(initial).toHaveLength(1);
  });

  it('rejects duplicate IDs, the collection limit and invalid task fields', () => {
    expect(addOpportunityTask([makeTask()], draft, 'task-1')).toMatchObject({
      ok: false,
      reason: 'duplicate-id',
    });
    const full = Array.from({ length: MAX_TASKS }, (_, index) =>
      makeTask({ id: `task-${index}` }),
    );
    expect(addOpportunityTask(full, draft, 'one-too-many')).toMatchObject({
      ok: false,
      reason: 'limit-reached',
    });
    expect(addOpportunityTask([], { ...draft, title: '   ' }, 'bad-task')).toMatchObject({
      ok: false,
      reason: 'invalid-task',
      issues: [{ field: 'title' }],
    });
  });

  it('edits task content without changing identity or completion lifecycle', () => {
    const completed = makeTask({
      id: 'completed-task',
      completed: true,
      completedOn: '2026-11-06',
    });
    const result = updateOpportunityTask([completed], completed.id, {
      ...draft,
      title: '  Updated task  ',
      dueDate: '',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task).toEqual({
      ...completed,
      title: 'Updated task',
      notes: 'Review the role',
      priority: 'High',
      dueDate: '',
    });
    expect(result.task?.completed).toBe(true);
    expect(result.task?.completedOn).toBe('2026-11-06');
    expect(updateOpportunityTask([completed], 'missing', draft)).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('does not persist unchanged updates or repeat an already-completed operation', () => {
    const task = makeTask();
    const unchangedEdit = updateOpportunityTask([task], task.id, {
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      dueDate: task.dueDate,
    });
    const unchangedComplete = completeOpportunityTask([
      makeTask({ completed: true, completedOn: '2026-11-07' }),
    ], 'task-1', '2026-11-07');

    expect(unchangedEdit).toMatchObject({ ok: true, changed: false });
    expect(unchangedComplete).toMatchObject({ ok: true, changed: false });
  });

  it('completes with a real local date and reopens by clearing that date', () => {
    const task = makeTask();
    const completed = completeOpportunityTask([task], task.id, '2026-11-07');
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: true, completedOn: '2026-11-07' },
    });
    if (!completed.ok) return;

    const reopened = reopenOpportunityTask(completed.tasks, task.id);
    expect(reopened).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: false, completedOn: '' },
    });
    expect(completeOpportunityTask([task], task.id, '2026-02-30')).toMatchObject({
      ok: false,
      reason: 'invalid-task',
      issues: [{ field: 'completedOn' }],
    });
    expect(reopenOpportunityTask([task], 'missing')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('deletes only the requested task and preserves the remaining order', () => {
    const first = makeTask({ id: 'first' });
    const removed = makeTask({ id: 'remove' });
    const last = makeTask({ id: 'last' });
    const result = deleteOpportunityTask([first, removed, last], 'remove');

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      tasks: [first, last],
      task: removed,
    });
    expect(deleteOpportunityTask([first], 'missing')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });
});

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUpRight,
  CalendarClock,
  Check,
  Circle,
  CircleCheck,
  Clock3,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  MAX_TASKS,
  PRIORITIES,
  groupOpportunityTasks,
  type Priority,
  type TaskDraft,
  type TaskEntry,
  type TaskGroup,
  type TaskWithOpportunity,
} from '@launchboard/domain';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import type { Opportunity } from '../types/opportunity';
import { formatDate, toISODate } from '../utils/dates';

export interface TaskFocusTarget {
  opportunityId: string;
  taskId: string;
}

interface Props {
  items: Opportunity[];
  focusTaskTarget?: TaskFocusTarget | null;
  onTaskFocusHandled?: () => void;
  busy?: boolean;
  error?: string | null;
  onOpen: (item: Opportunity, trigger?: HTMLElement | null) => void;
  onCreate: (opportunityId: string, draft: TaskDraft) => Promise<boolean>;
  onUpdate: (opportunityId: string, taskId: string, draft: TaskDraft) => Promise<boolean>;
  onComplete: (opportunityId: string, taskId: string) => Promise<boolean>;
  onReopen: (opportunityId: string, taskId: string) => Promise<boolean>;
  onDelete: (opportunityId: string, taskId: string) => Promise<boolean>;
}

type EditorState =
  | { mode: 'create'; opportunityId: string }
  | { mode: 'edit'; opportunityId: string; task: TaskEntry };

const GROUP_META: Record<TaskGroup, { title: string; description: string }> = {
  overdue: { title: 'Overdue', description: 'Past-due actions that still need attention.' },
  today: { title: 'Due today', description: 'Actions to move forward today.' },
  upcoming: { title: 'Upcoming', description: 'Scheduled for the days ahead.' },
  unscheduled: { title: 'No due date', description: 'Open actions you have not scheduled yet.' },
  completed: { title: 'Completed', description: 'Recently finished actions.' },
};

const secondaryButton =
  'inline-flex min-h-11 cursor-pointer items-center justify-center gap-s1 rounded-control border border-border bg-surface px-s3 text-[0.8rem] font-semibold text-text hover:border-accent disabled:cursor-not-allowed disabled:opacity-50';

function priorityClass(priority: Priority): string {
  if (priority === 'High') return 'border-danger/25 bg-danger/5 text-danger';
  if (priority === 'Low') return 'border-border bg-table-head text-muted';
  return 'border-status-interview/25 bg-status-interview/10 text-warn';
}

function TaskEditor({
  editor,
  opportunities,
  busy,
  error,
  onClose,
  onSave,
}: {
  editor: EditorState;
  opportunities: Opportunity[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (opportunityId: string, draft: TaskDraft, taskId?: string) => Promise<boolean>;
}) {
  const initial = editor.mode === 'edit' ? editor.task : null;
  const [opportunityId, setOpportunityId] = useState(editor.opportunityId);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'Medium');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || busy) return;
    if (!title.trim()) {
      setValidationError('Enter a task title.');
      document.getElementById('task-title')?.focus();
      return;
    }
    if (title.trim().length > 160) {
      setValidationError('Task titles must be 160 characters or fewer.');
      return;
    }
    if (notes.length > 1000) {
      setValidationError('Notes must be 1,000 characters or fewer.');
      return;
    }

    setValidationError(null);
    setSaving(true);
    try {
      const ok = await onSave(opportunityId, {
        title: title.trim(),
        notes: notes.trim(),
        priority,
        dueDate,
      }, initial?.id);
      if (ok) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={initial ? 'Edit task' : 'Add task'}
      onClose={onClose}
      initialFocusId="task-title"
      closeDisabled={busy || saving}
    >
      <form className="grid gap-s4 px-s5 py-s4" onSubmit={(event) => void submit(event)}>
        {initial ? (
          <div className="rounded-control border border-border bg-table-head/60 px-s3 py-s2">
            <span className="block text-[0.72rem] font-semibold uppercase tracking-wide text-muted">Opportunity</span>
            <span className="mt-s1 block break-words text-sm font-semibold text-text">
              {opportunities.find((item) => item.id === editor.opportunityId)?.title ?? 'Opportunity'}
            </span>
          </div>
        ) : (
          <label className="grid gap-s1 text-sm font-semibold text-text" htmlFor="task-opportunity">
            Opportunity
            <select
              id="task-opportunity"
              value={opportunityId}
              onChange={(event) => setOpportunityId(event.target.value)}
              required
              disabled={saving || busy}
              className="min-h-11 rounded-control border border-border bg-surface px-s3 font-normal"
            >
              {opportunities.map((item) => (
                <option key={item.id} value={item.id} disabled={item.tasks.length >= MAX_TASKS}>
                  {item.title} · {item.company}{item.tasks.length >= MAX_TASKS ? ' (task limit reached)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="grid gap-s1 text-sm font-semibold text-text" htmlFor="task-title">
          Task title
          <input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={160}
            required
            disabled={saving || busy}
            placeholder="e.g. Tailor my CV for this role"
            className="min-h-11 rounded-control border border-border bg-surface px-s3 font-normal"
          />
          <span className="text-right text-[0.72rem] font-normal text-muted">{title.length}/160</span>
        </label>

        <div className="grid grid-cols-2 gap-s3 max-[420px]:grid-cols-1">
          <label className="grid gap-s1 text-sm font-semibold text-text" htmlFor="task-priority">
            Priority
            <select
              id="task-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              disabled={saving || busy}
              className="min-h-11 rounded-control border border-border bg-surface px-s3 font-normal"
            >
              {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="grid gap-s1 text-sm font-semibold text-text" htmlFor="task-due-date">
            Due date <span className="font-normal text-muted">(optional)</span>
            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={saving || busy}
              className="min-h-11 min-w-0 rounded-control border border-border bg-surface px-s3 font-normal"
            />
          </label>
        </div>

        <label className="grid gap-s1 text-sm font-semibold text-text" htmlFor="task-notes">
          Notes <span className="font-normal text-muted">(optional)</span>
          <textarea
            id="task-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            rows={4}
            disabled={saving || busy}
            placeholder="Add a detail or useful reminder…"
            className="min-h-24 resize-y rounded-control border border-border bg-surface p-s3 font-normal"
          />
          <span className="text-right text-[0.72rem] font-normal text-muted">{notes.length}/1,000</span>
        </label>

        {(validationError || error) && (
          <p role="alert" className="m-0 rounded-control border border-danger/25 bg-danger/5 p-s3 text-sm text-danger">
            {validationError ?? error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-s2 border-t border-border pt-s3">
          <button type="button" className={secondaryButton} onClick={onClose} disabled={saving || busy}>Cancel</button>
          <button
            type="submit"
            disabled={saving || busy || opportunities.length === 0}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving || busy ? 'Saving…' : initial ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskRow({
  item,
  completed,
  busy,
  onComplete,
  onReopen,
  onEdit,
  onDelete,
  onOpen,
  actionRef,
}: {
  item: TaskWithOpportunity;
  completed: boolean;
  busy: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onEdit: () => void;
  onDelete: (trigger: HTMLElement) => void;
  onOpen: (trigger: HTMLButtonElement) => void;
  actionRef?: (node: HTMLButtonElement | null) => void;
}) {
  const task = item.task;
  return (
    <li className="rounded-card border border-border bg-surface p-s3 shadow-card">
      <div className="flex min-w-0 items-start gap-s3">
        <span className="mt-[3px] shrink-0 text-muted" aria-hidden="true">
          {completed ? <CircleCheck size={19} className="text-accent" /> : <Circle size={19} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-s2">
            <div className="min-w-0 flex-1">
              <h3 className={`m-0 break-words text-[0.96rem] font-semibold ${completed ? 'text-muted line-through' : 'text-text'}`}>
                {task.title}
              </h3>
              <button
                type="button"
                className="mt-s1 inline-flex max-w-full cursor-pointer items-center gap-s1 break-words border-0 bg-transparent p-0 text-left text-[0.82rem] text-muted hover:text-accent-dark hover:underline"
                onClick={(event) => onOpen(event.currentTarget)}
              >
                <span className="break-words">{item.opportunityTitle} · {item.opportunityCompany}</span>
                <ArrowUpRight size={12} aria-hidden />
              </button>
            </div>
            <span className={`shrink-0 rounded-pill border px-s2 py-[3px] text-[0.7rem] font-semibold ${priorityClass(task.priority)}`}>
              {task.priority}
            </span>
          </div>

          {task.notes && <p className="mt-s2 mb-0 whitespace-pre-wrap break-words text-[0.84rem] leading-relaxed text-muted">{task.notes}</p>}

          <div className="mt-s3 flex flex-wrap items-center justify-between gap-s2 border-t border-border/70 pt-s2">
            <div className="flex min-w-0 flex-wrap items-center gap-s2 text-[0.76rem] text-muted">
              {task.dueDate && (
                <span className="inline-flex items-center gap-s1">
                  <CalendarClock size={13} aria-hidden />
                  Due {formatDate(task.dueDate)}
                </span>
              )}
              {completed && task.completedOn && (
                <span className="inline-flex items-center gap-s1">
                  <Check size={13} aria-hidden />
                  Completed {formatDate(task.completedOn)}
                </span>
              )}
              {!task.dueDate && !completed && <span>No due date</span>}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-s1">
              {!completed ? (
                <button ref={actionRef} type="button" className={secondaryButton} disabled={busy} onClick={onComplete} aria-label={`Mark ${task.title} complete`}>
                  <Check size={14} aria-hidden /> Complete
                </button>
              ) : (
                <button ref={actionRef} type="button" className={secondaryButton} disabled={busy} onClick={onReopen} aria-label={`Reopen ${task.title}`}>
                  <RotateCcw size={14} aria-hidden /> Reopen
                </button>
              )}
              <button type="button" className={secondaryButton} disabled={busy} onClick={onEdit} aria-label={`Edit ${task.title}`}>
                <Pencil size={14} aria-hidden /> Edit
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-s1 rounded-control border border-danger/25 bg-surface px-s3 text-[0.8rem] font-semibold text-danger hover:bg-danger/5 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                onClick={(event) => onDelete(event.currentTarget)}
                aria-label={`Delete ${task.title}`}
              >
                <Trash2 size={14} aria-hidden /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function ActionCenter({
  items,
  focusTaskTarget = null,
  onTaskFocusHandled,
  busy = false,
  error,
  onOpen,
  onCreate,
  onUpdate,
  onComplete,
  onReopen,
  onDelete,
}: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [localMutationBusy, setLocalMutationBusy] = useState(false);
  const localMutationLock = useRef(false);
  const actionBusy = busy || localMutationBusy;
  const [deleteTarget, setDeleteTarget] = useState<{
    item: TaskWithOpportunity;
    opener: HTMLElement | null;
  } | null>(null);
  const [today] = useState(() => toISODate(new Date()));
  const [priorityFilter, setPriorityFilter] = useState<Priority | 'All'>('All');
  const [showCompleted, setShowCompleted] = useState(true);
  const taskActionRefs = useRef(new Map<string, HTMLButtonElement>());

  const active = useMemo(
    () => items.filter((item) => !item.archivedAt),
    [items],
  );
  const activeById = useMemo(() => new Map(active.map((item) => [item.id, item])), [active]);
  const taskItems = useMemo(
    () => active.flatMap((opportunity) => opportunity.tasks.map((task) => ({
      task,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      opportunityCompany: opportunity.company,
    }))),
    [active],
  );
  const groups = useMemo(() => groupOpportunityTasks(taskItems, today), [taskItems, today]);

  useEffect(() => {
    if (!focusTaskTarget) return;
    const key = `${focusTaskTarget.opportunityId}:${focusTaskTarget.taskId}`;
    taskActionRefs.current.get(key)?.focus();
    onTaskFocusHandled?.();
  }, [focusTaskTarget, groups, onTaskFocusHandled]);
  const totalOpen = groups.overdue.length + groups.today.length + groups.upcoming.length + groups.unscheduled.length;
  const totalCompleted = groups.completed.length;
  const eligibleOpportunities = useMemo(
    () => active.filter((item) => item.tasks.length < MAX_TASKS),
    [active],
  );
  const filteredGroups = useMemo(() => {
    const matchesPriority = (entry: TaskWithOpportunity) =>
      priorityFilter === 'All' || entry.task.priority === priorityFilter;
    return {
      overdue: groups.overdue.filter(matchesPriority),
      today: groups.today.filter(matchesPriority),
      upcoming: groups.upcoming.filter(matchesPriority),
      unscheduled: groups.unscheduled.filter(matchesPriority),
      completed: showCompleted ? groups.completed.filter(matchesPriority) : [],
    } satisfies Record<TaskGroup, TaskWithOpportunity[]>;
  }, [groups, priorityFilter, showCompleted]);

  const openCreate = () => {
    if (eligibleOpportunities.length > 0) {
      setEditor({ mode: 'create', opportunityId: eligibleOpportunities[0].id });
    }
  };

  const runMutation = async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (actionBusy || localMutationLock.current) return false;
    localMutationLock.current = true;
    setLocalMutationBusy(true);
    try {
      return await operation();
    } finally {
      localMutationLock.current = false;
      setLocalMutationBusy(false);
    }
  };

  const saveTask = async (opportunityId: string, draft: TaskDraft, taskId?: string) =>
    runMutation(() => taskId
      ? onUpdate(opportunityId, taskId, draft)
      : onCreate(opportunityId, draft));

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const ok = await runMutation(() => onDelete(
      deleteTarget.item.opportunityId,
      deleteTarget.item.task.id,
    ));
    if (ok) setDeleteTarget(null);
  };

  const handleComplete = (opportunityId: string, taskId: string) =>
    void runMutation(() => onComplete(opportunityId, taskId));

  const handleReopen = (opportunityId: string, taskId: string) =>
    void runMutation(() => onReopen(opportunityId, taskId));

  const sections: TaskGroup[] = ['overdue', 'today', 'upcoming', 'unscheduled', 'completed'];
  const hasVisibleTasks = sections.some((group) => filteredGroups[group].length > 0);

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-s3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-s1 text-[0.72rem] font-bold uppercase tracking-[.11em] text-accent-dark">
            <ListChecks size={14} aria-hidden /> Your next steps
          </span>
          <h1 className="mt-s1 mb-0">Action Center</h1>
          <p className="mt-s2 mb-0 max-w-[760px] text-[0.9rem] leading-relaxed text-muted">
            Keep the small actions moving across your active opportunities. Tasks stay attached to the opportunity they belong to.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
          onClick={openCreate}
          disabled={actionBusy || eligibleOpportunities.length === 0}
        >
          <Plus size={16} aria-hidden /> Add task
        </button>
      </header>

      <section className="grid grid-cols-2 gap-s3 md:grid-cols-4" aria-label="Task summary">
        <div className="rounded-card border border-border bg-surface p-s3 shadow-card">
          <span className="inline-flex items-center gap-s1 text-[0.76rem] font-semibold text-danger"><Clock3 size={14} aria-hidden /> Overdue</span>
          <p className="mb-0 mt-s1 text-[1.7rem] font-bold tabular-nums text-text">{groups.overdue.length}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-s3 shadow-card">
          <span className="inline-flex items-center gap-s1 text-[0.76rem] font-semibold text-warn"><CalendarClock size={14} aria-hidden /> Due today</span>
          <p className="mb-0 mt-s1 text-[1.7rem] font-bold tabular-nums text-text">{groups.today.length}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-s3 shadow-card">
          <span className="inline-flex items-center gap-s1 text-[0.76rem] font-semibold text-accent-dark"><Circle size={14} aria-hidden /> Open tasks</span>
          <p className="mb-0 mt-s1 text-[1.7rem] font-bold tabular-nums text-text">{totalOpen}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-s3 shadow-card">
          <span className="inline-flex items-center gap-s1 text-[0.76rem] font-semibold text-muted"><CircleCheck size={14} aria-hidden /> Completed</span>
          <p className="mb-0 mt-s1 text-[1.7rem] font-bold tabular-nums text-text">{totalCompleted}</p>
        </div>
      </section>

      {error && <p role="alert" className="m-0 rounded-control border border-danger/25 bg-danger/5 p-s3 text-sm text-danger">{error}</p>}

      {active.length > 0 && eligibleOpportunities.length === 0 && (
        <p role="status" className="m-0 rounded-control border border-border bg-surface p-s3 text-sm text-muted">
          All active opportunities have reached the {MAX_TASKS}-task limit. You can still edit, complete or remove existing tasks.
        </p>
      )}

      {totalOpen + totalCompleted > 0 && (
        <section className="flex flex-wrap items-end justify-between gap-s3 rounded-card border border-border bg-surface p-s3 shadow-card" aria-label="Task filters">
          <label className="grid min-w-[150px] flex-1 gap-s1 text-[0.8rem] font-semibold text-text" htmlFor="action-priority-filter">
            Priority
            <select
              id="action-priority-filter"
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value as Priority | 'All')}
              className="min-h-11 rounded-control border border-border bg-surface px-s3 text-sm font-normal"
            >
              <option value="All">All priorities</option>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-s2 rounded-control border border-border px-s3 text-sm font-medium text-text">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Show completed tasks
          </label>
        </section>
      )}

      {active.length === 0 ? (
        <section className="rounded-card border border-dashed border-border bg-surface p-s5 text-center">
          <ListChecks size={28} className="mx-auto text-muted" aria-hidden />
          <h2 className="mt-s2 mb-0 text-lg">No active opportunities yet</h2>
          <p className="mx-auto mt-s2 mb-0 max-w-[480px] text-sm leading-relaxed text-muted">
            Add or restore an opportunity first. You can then attach tasks to it here.
          </p>
        </section>
      ) : totalOpen + totalCompleted === 0 ? (
        <section className="rounded-card border border-dashed border-border bg-surface p-s5 text-center">
          <ListChecks size={28} className="mx-auto text-muted" aria-hidden />
          <h2 className="mt-s2 mb-0 text-lg">Your action list is clear</h2>
          <p className="mx-auto mt-s2 mb-0 max-w-[480px] text-sm leading-relaxed text-muted">
            No tasks yet. Add a small next step to keep one of your opportunities moving.
          </p>
          <button type="button" className="mt-s3 inline-flex min-h-11 cursor-pointer items-center gap-s2 rounded-control border border-accent bg-accent px-s4 text-sm font-semibold text-white hover:bg-accent-dark" onClick={openCreate}>
            <Plus size={15} aria-hidden /> Add your first task
          </button>
        </section>
      ) : (
        <div className="grid gap-s4">
          {!hasVisibleTasks && (
            <section className="rounded-card border border-dashed border-border bg-surface p-s5 text-center">
              <h2 className="m-0 text-base font-bold text-text">No tasks match these filters</h2>
              <p className="mt-s2 mb-0 text-sm text-muted">Try another priority or show completed tasks.</p>
              <button
                type="button"
                className={secondaryButton + ' mt-s3'}
                onClick={() => { setPriorityFilter('All'); setShowCompleted(true); }}
              >
                Clear filters
              </button>
            </section>
          )}
          {sections.map((group) => {
            const entries = filteredGroups[group];
            if (entries.length === 0) return null;
            const meta = GROUP_META[group];
            return (
              <section key={group} className="grid min-w-0 gap-s2" aria-labelledby={`task-group-${group}`}>
                <div className="flex flex-wrap items-end justify-between gap-s2">
                  <div>
                    <h2 id={`task-group-${group}`} className="m-0 text-base font-bold text-text">{meta.title}</h2>
                    <p className="mt-s1 mb-0 text-[0.8rem] text-muted">{meta.description}</p>
                  </div>
                  <span className="rounded-pill border border-border bg-surface px-s2 py-[3px] text-[0.72rem] font-semibold tabular-nums text-muted">{entries.length}</span>
                </div>
                <ul className="m-0 grid list-none gap-s2 p-0">
                  {entries.map((entry) => {
                    const opportunity = activeById.get(entry.opportunityId);
                    if (!opportunity) return null;
                    return (
                      <TaskRow
                        key={`${entry.opportunityId}:${entry.task.id}`}
                        item={entry}
                        completed={group === 'completed'}
                        busy={actionBusy}
                        onComplete={() => handleComplete(entry.opportunityId, entry.task.id)}
                        onReopen={() => handleReopen(entry.opportunityId, entry.task.id)}
                        onEdit={() => setEditor({ mode: 'edit', opportunityId: entry.opportunityId, task: entry.task })}
                        onDelete={(trigger) => setDeleteTarget({ item: entry, opener: trigger })}
                        onOpen={(trigger) => onOpen(opportunity, trigger)}
                        actionRef={(node) => {
                          const key = `${entry.opportunityId}:${entry.task.id}`;
                          if (node) taskActionRefs.current.set(key, node);
                          else taskActionRefs.current.delete(key);
                        }}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {editor && (
        <TaskEditor
          editor={editor}
          opportunities={active}
          busy={actionBusy}
          error={error ?? null}
          onClose={() => setEditor(null)}
          onSave={saveTask}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete task"
          message={`Delete “${deleteTarget.item.task.title}” from ${deleteTarget.item.opportunityTitle}? This cannot be undone.`}
          confirmLabel="Delete task"
          opener={deleteTarget.opener}
          fallbackFocusId="main-content"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
          busy={actionBusy}
        />
      )}
    </>
  );
}

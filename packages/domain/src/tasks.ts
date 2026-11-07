import { PRIORITIES, type Priority, type TaskDraft, type TaskEntry } from './opportunity.js';
import {
  MAX_TASKS,
  MAX_TASK_ID_LENGTH,
  MAX_TASK_NOTES_LENGTH,
  MAX_TASK_TITLE_LENGTH,
} from './limits.js';
import { isValidISODate } from './dates.js';

export const TASK_GROUPS = [
  'overdue',
  'today',
  'upcoming',
  'unscheduled',
  'completed',
] as const;

export type TaskGroup = (typeof TASK_GROUPS)[number];

export interface TaskWithOpportunity {
  task: TaskEntry;
  opportunityId: string;
  opportunityTitle: string;
  opportunityCompany: string;
}

export interface TaskGroups {
  overdue: TaskWithOpportunity[];
  today: TaskWithOpportunity[];
  upcoming: TaskWithOpportunity[];
  unscheduled: TaskWithOpportunity[];
  completed: TaskWithOpportunity[];
}

export type TaskNormalizationFailure =
  | 'not-an-object'
  | 'invalid-id'
  | 'missing-title';

export interface NormalizedTaskEntry {
  task: TaskEntry | null;
  repaired: boolean;
  failure: TaskNormalizationFailure | null;
}

export interface NormalizedTaskList {
  tasks: TaskEntry[];
  repaired: boolean;
  invalidCount: number;
  duplicateCount: number;
  truncatedCount: number;
}

export type TaskValidationField =
  | 'id'
  | 'title'
  | 'notes'
  | 'priority'
  | 'dueDate'
  | 'completed'
  | 'completedOn';

export interface TaskValidationIssue {
  field: TaskValidationField;
  message: string;
}

const PRIORITY_RANK: Record<Priority, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' &&
    (PRIORITIES as readonly string[]).includes(value);
}

/**
 * Repairs one stored/imported task without inventing a completion date.
 * A task whose completion flag/date disagree is reopened rather than assigned
 * a fabricated date. Required identity and title fields cannot be invented.
 */
export function normalizeTaskEntry(value: unknown): NormalizedTaskEntry {
  const record = asRecord(value);
  if (!record) {
    return { task: null, repaired: false, failure: 'not-an-object' };
  }

  const id = typeof record.id === 'string' ? record.id : '';
  if (!id.trim() || id.length > MAX_TASK_ID_LENGTH) {
    return { task: null, repaired: false, failure: 'invalid-id' };
  }

  const title = limitedText(record.title, MAX_TASK_TITLE_LENGTH);
  if (!title) {
    return { task: null, repaired: false, failure: 'missing-title' };
  }

  const notes = limitedText(record.notes, MAX_TASK_NOTES_LENGTH);
  const priority = isPriority(record.priority) ? record.priority : 'Medium';
  const dueDateCandidate = typeof record.dueDate === 'string' ? record.dueDate : '';
  const dueDate = dueDateCandidate === '' || !isValidISODate(dueDateCandidate)
    ? ''
    : dueDateCandidate;

  const completionDateCandidate =
    typeof record.completedOn === 'string' ? record.completedOn : '';
  const hasValidCompletionDate =
    completionDateCandidate !== '' && isValidISODate(completionDateCandidate);
  const completed = record.completed === true && hasValidCompletionDate;
  const completedOn = completed ? completionDateCandidate : '';

  const task: TaskEntry = {
    id,
    title,
    notes,
    priority,
    dueDate,
    completed,
    completedOn,
  };

  const repaired =
    record.title !== title ||
    record.notes !== notes ||
    record.priority !== priority ||
    record.dueDate !== dueDate ||
    record.completed !== completed ||
    record.completedOn !== completedOn;

  return { task, repaired, failure: null };
}

/**
 * Normalizes a child task collection using first-valid-ID-wins semantics.
 * Missing collections are the expected legacy shape and normalize quietly to
 * an empty array. Malformed lists, children, duplicate IDs and excess entries
 * are reported as repairs so storage/import callers can describe the outcome.
 */
export function normalizeTaskList(value: unknown): NormalizedTaskList {
  if (value === undefined) {
    return {
      tasks: [],
      repaired: false,
      invalidCount: 0,
      duplicateCount: 0,
      truncatedCount: 0,
    };
  }

  if (!Array.isArray(value)) {
    return {
      tasks: [],
      repaired: true,
      invalidCount: 0,
      duplicateCount: 0,
      truncatedCount: 0,
    };
  }

  const tasks: TaskEntry[] = [];
  const seenIds = new Set<string>();
  let invalidCount = 0;
  let duplicateCount = 0;
  let truncatedCount = 0;
  let repaired = false;

  for (const raw of value) {
    if (tasks.length >= MAX_TASKS) {
      truncatedCount += 1;
      continue;
    }

    const normalized = normalizeTaskEntry(raw);
    if (!normalized.task) {
      invalidCount += 1;
      repaired = true;
      continue;
    }
    if (seenIds.has(normalized.task.id)) {
      duplicateCount += 1;
      repaired = true;
      continue;
    }

    seenIds.add(normalized.task.id);
    tasks.push(normalized.task);
    if (normalized.repaired) repaired = true;
  }

  if (invalidCount > 0 || duplicateCount > 0 || truncatedCount > 0) {
    repaired = true;
  }

  return { tasks, repaired, invalidCount, duplicateCount, truncatedCount };
}

/** Strict domain validation for normal task writes (unlike storage repair). */
export function validateTaskEntry(value: unknown): TaskValidationIssue[] {
  const record = asRecord(value);
  if (!record) {
    return [{ field: 'id', message: 'Task must be an object.' }];
  }

  const issues: TaskValidationIssue[] = [];
  const id = record.id;
  const title = record.title;
  const notes = record.notes;
  const priority = record.priority;
  const dueDate = record.dueDate;
  const completed = record.completed;
  const completedOn = record.completedOn;

  if (typeof id !== 'string' || !id.trim() || id.length > MAX_TASK_ID_LENGTH) {
    issues.push({
      field: 'id',
      message: `ID must contain 1–${MAX_TASK_ID_LENGTH} characters.`,
    });
  }
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > MAX_TASK_TITLE_LENGTH
  ) {
    issues.push({
      field: 'title',
      message: `Title is required and must be at most ${MAX_TASK_TITLE_LENGTH} characters.`,
    });
  }
  if (typeof notes !== 'string' || notes.length > MAX_TASK_NOTES_LENGTH) {
    issues.push({
      field: 'notes',
      message: `Notes must be a string of at most ${MAX_TASK_NOTES_LENGTH} characters.`,
    });
  }
  if (!isPriority(priority)) {
    issues.push({ field: 'priority', message: 'Priority must be Low, Medium or High.' });
  }
  if (
    typeof dueDate !== 'string' ||
    (dueDate !== '' && !isValidISODate(dueDate))
  ) {
    issues.push({
      field: 'dueDate',
      message: 'Due date must be empty or a real YYYY-MM-DD calendar date.',
    });
  }
  if (typeof completed !== 'boolean') {
    issues.push({ field: 'completed', message: 'Completion state must be a boolean.' });
  }
  if (
    typeof completedOn !== 'string' ||
    (completedOn !== '' && !isValidISODate(completedOn))
  ) {
    issues.push({
      field: 'completedOn',
      message: 'Completion date must be empty or a real YYYY-MM-DD calendar date.',
    });
  } else if (completed === true && completedOn === '') {
    issues.push({
      field: 'completedOn',
      message: 'A completed task must have a completion date.',
    });
  } else if (completed === false && completedOn !== '') {
    issues.push({
      field: 'completedOn',
      message: 'An open task cannot have a completion date.',
    });
  }

  return issues;
}

/** Classifies a task against an explicit local YYYY-MM-DD "today" value. */
export function classifyTask(task: TaskEntry, today: string): TaskGroup | null {
  if (!isValidISODate(today)) return null;
  if (task.completed) {
    return isValidISODate(task.completedOn) ? 'completed' : null;
  }
  if (task.dueDate === '') return 'unscheduled';
  if (!isValidISODate(task.dueDate)) return null;
  if (task.dueDate < today) return 'overdue';
  if (task.dueDate === today) return 'today';
  return 'upcoming';
}

function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePriority(a: TaskWithOpportunity, b: TaskWithOpportunity): number {
  return PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
}

function compareStableIdentity(a: TaskWithOpportunity, b: TaskWithOpportunity): number {
  return (
    compareText(a.opportunityTitle, b.opportunityTitle) ||
    compareText(a.task.title, b.task.title) ||
    compareText(a.opportunityCompany, b.opportunityCompany) ||
    compareText(a.opportunityId, b.opportunityId) ||
    compareText(a.task.id, b.task.id)
  );
}

function compareGroupedTasks(
  group: TaskGroup,
  a: TaskWithOpportunity,
  b: TaskWithOpportunity,
): number {
  if (group === 'overdue' || group === 'upcoming') {
    const byDate = compareText(a.task.dueDate, b.task.dueDate);
    if (byDate !== 0) return byDate;
    return comparePriority(a, b) || compareStableIdentity(a, b);
  }

  if (group === 'completed') {
    const byCompletionDate = compareText(b.task.completedOn, a.task.completedOn);
    if (byCompletionDate !== 0) return byCompletionDate;
  }

  return comparePriority(a, b) || compareStableIdentity(a, b);
}

/**
 * Groups task records for the Action Center. Callers provide tasks from active
 * opportunities only; archived-parent filtering remains an application rule.
 * Dated groups use ascending due-date order, then High/Medium/Low priority.
 * All comparisons are deterministic and independent of the machine locale.
 */
export function groupOpportunityTasks(
  tasks: readonly TaskWithOpportunity[],
  today: string,
): TaskGroups {
  const groups: TaskGroups = {
    overdue: [],
    today: [],
    upcoming: [],
    unscheduled: [],
    completed: [],
  };
  if (!isValidISODate(today)) return groups;

  for (const item of tasks) {
    if (!item || !item.task) continue;
    const group = classifyTask(item.task, today);
    if (group) groups[group].push(item);
  }

  for (const group of TASK_GROUPS) {
    groups[group].sort((a, b) => compareGroupedTasks(group, a, b));
  }

  return groups;
}


export type TaskOperationFailureReason =
  | 'limit-reached'
  | 'duplicate-id'
  | 'not-found'
  | 'invalid-task';

export type TaskOperationResult =
  | {
      ok: true;
      tasks: TaskEntry[];
      task: TaskEntry | null;
      changed: boolean;
    }
  | {
      ok: false;
      reason: TaskOperationFailureReason;
      issues?: TaskValidationIssue[];
    };

function normalizeTaskDraft(draft: TaskDraft): TaskDraft {
  return {
    title: typeof draft.title === 'string' ? draft.title.trim() : '',
    notes: typeof draft.notes === 'string' ? draft.notes.trim() : '',
    priority: draft.priority,
    dueDate: draft.dueDate,
  };
}

function operationFailure(
  reason: TaskOperationFailureReason,
  issues?: TaskValidationIssue[],
): TaskOperationResult {
  return { ok: false, reason, ...(issues ? { issues } : {}) };
}

function validateCandidateTask(task: TaskEntry): TaskOperationResult | null {
  const issues = validateTaskEntry(task);
  return issues.length > 0 ? operationFailure('invalid-task', issues) : null;
}

/** Adds one open task without mutating the source array. */
export function addOpportunityTask(
  tasks: readonly TaskEntry[],
  draft: TaskDraft,
  id: string,
): TaskOperationResult {
  if (tasks.length >= MAX_TASKS) return operationFailure('limit-reached');
  if (tasks.some((task) => task.id === id)) return operationFailure('duplicate-id');

  const task: TaskEntry = {
    ...normalizeTaskDraft(draft),
    id,
    completed: false,
    completedOn: '',
  };
  const invalid = validateCandidateTask(task);
  if (invalid) return invalid;

  return { ok: true, tasks: [...tasks, task], task, changed: true };
}

/** Edits task content while preserving its ID and completion lifecycle. */
export function updateOpportunityTask(
  tasks: readonly TaskEntry[],
  id: string,
  draft: TaskDraft,
): TaskOperationResult {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return operationFailure('not-found');

  const previous = tasks[index];
  const updated: TaskEntry = {
    ...previous,
    ...normalizeTaskDraft(draft),
  };
  const invalid = validateCandidateTask(updated);
  if (invalid) return invalid;

  if (
    updated.title === previous.title &&
    updated.notes === previous.notes &&
    updated.priority === previous.priority &&
    updated.dueDate === previous.dueDate
  ) {
    return { ok: true, tasks: [...tasks], task: previous, changed: false };
  }

  const next = [...tasks];
  next[index] = updated;
  return { ok: true, tasks: next, task: updated, changed: true };
}

/** Marks an open task complete with an explicit local calendar date. */
export function completeOpportunityTask(
  tasks: readonly TaskEntry[],
  id: string,
  completedOn: string,
): TaskOperationResult {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return operationFailure('not-found');

  const previous = tasks[index];
  if (previous.completed) {
    return { ok: true, tasks: [...tasks], task: previous, changed: false };
  }

  const updated: TaskEntry = { ...previous, completed: true, completedOn };
  const invalid = validateCandidateTask(updated);
  if (invalid) return invalid;

  const next = [...tasks];
  next[index] = updated;
  return { ok: true, tasks: next, task: updated, changed: true };
}

/** Reopens a completed task and always clears its completion date. */
export function reopenOpportunityTask(
  tasks: readonly TaskEntry[],
  id: string,
): TaskOperationResult {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return operationFailure('not-found');

  const previous = tasks[index];
  if (!previous.completed && previous.completedOn === '') {
    return { ok: true, tasks: [...tasks], task: previous, changed: false };
  }

  const updated: TaskEntry = { ...previous, completed: false, completedOn: '' };
  const next = [...tasks];
  next[index] = updated;
  return { ok: true, tasks: next, task: updated, changed: true };
}

/** Permanently removes one task from its owning opportunity. */
export function deleteOpportunityTask(
  tasks: readonly TaskEntry[],
  id: string,
): TaskOperationResult {
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return operationFailure('not-found');

  const task = tasks[index];
  return {
    ok: true,
    tasks: tasks.filter((entry) => entry.id !== id),
    task,
    changed: true,
  };
}

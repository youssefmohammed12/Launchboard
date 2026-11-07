import {
  type TaskEntry,
  type TaskOperationResult,
  type TaskOperationFailureReason,
} from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import type {
  HttpOpportunityRepository,
  OpportunityResource,
} from './httpOpportunityRepository';

export type TaskCollectionMutation = (
  tasks: readonly TaskEntry[],
) => TaskOperationResult;

export type TaskMutationFailureReason =
  | TaskOperationFailureReason
  | 'opportunity-not-found'
  | 'ambiguous-opportunity'
  | 'save-failed';

export type LocalTaskMutationResult =
  | {
      ok: true;
      items: Opportunity[];
      task: TaskEntry | null;
      changed: boolean;
    }
  | {
      ok: false;
      reason: TaskMutationFailureReason;
      issues?: Extract<TaskOperationResult, { ok: false }>['issues'];
    };

export type ApiTaskMutationResult =
  | {
      ok: true;
      resource: OpportunityResource;
      task: TaskEntry | null;
      changed: boolean;
    }
  | {
      ok: false;
      reason: TaskOperationFailureReason;
      issues?: Extract<TaskOperationResult, { ok: false }>['issues'];
    };

function operationFailure(result: Extract<TaskOperationResult, { ok: false }>) {
  return {
    ok: false as const,
    reason: result.reason,
    ...(result.issues ? { issues: result.issues } : {}),
  };
}

/**
 * Applies a task-list operation to one local opportunity and commits the
 * resulting full collection through the existing recovery-aware write path.
 * The callback must be the useOpportunities.commitCandidate function.
 */
export function commitLocalTaskMutation(
  items: Opportunity[],
  opportunityId: string,
  mutate: TaskCollectionMutation,
  commitCandidate: (candidate: Opportunity[]) => boolean,
): LocalTaskMutationResult {
  const matches = items.filter((item) => item.id === opportunityId);
  if (matches.length === 0) return { ok: false, reason: 'opportunity-not-found' };
  if (matches.length > 1) return { ok: false, reason: 'ambiguous-opportunity' };

  const current = matches[0];
  const result = mutate(current.tasks);
  if (!result.ok) return operationFailure(result);
  if (!result.changed) {
    return { ok: true, items, task: result.task, changed: false };
  }

  const candidate = items.map((item) =>
    item.id === opportunityId ? { ...item, tasks: result.tasks } : item,
  );
  if (!commitCandidate(candidate)) return { ok: false, reason: 'save-failed' };

  return { ok: true, items: candidate, task: result.task, changed: true };
}

/**
 * Applies a task-list operation through the authenticated API aggregate.
 * It always fetches the newest parent version before mutation. A conflict
 * between GET and PUT is allowed to surface; callers must reload and let the
 * user retry rather than silently replaying a stale task edit.
 */
export async function commitApiTaskMutation(
  repository: HttpOpportunityRepository,
  opportunityId: string,
  mutate: TaskCollectionMutation,
): Promise<ApiTaskMutationResult> {
  const current = await repository.get(opportunityId);
  const result = mutate(current.opportunity.tasks);
  if (!result.ok) return operationFailure(result);
  if (!result.changed) {
    return { ok: true, resource: current, task: result.task, changed: false };
  }

  const updated = await repository.updateTasks(
    opportunityId,
    current.version,
    current.opportunity,
    result.tasks,
  );
  return { ok: true, resource: updated, task: result.task, changed: true };
}

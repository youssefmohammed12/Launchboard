import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addOpportunityTask,
  completeOpportunityTask,
  deleteOpportunityTask,
  reopenOpportunityTask,
  updateOpportunityTask,
} from '@launchboard/domain';
import { makeOpportunity } from '../test/fixtures';
import {
  loadOpportunitiesWithRecovery,
  saveOpportunities,
} from '../utils/storage';
import {
  getCurrentUser,
  resetApiSecurityState,
} from './apiClient';
import { HttpOpportunityRepository } from './httpOpportunityRepository';
import {
  commitApiTaskMutation,
  commitLocalTaskMutation,
} from './taskOperations';

const STORAGE_KEY = 'launchboard.opportunities.v1';

const draft = {
  title: 'Prepare for interview',
  notes: 'Review the role',
  priority: 'High' as const,
  dueDate: '2026-11-09',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeResource(tasks: ReturnType<typeof loadOpportunitiesWithRecovery>['items'][number]['tasks'] = []) {
  return {
    opportunity: makeOpportunity({ id: 'op-1', tasks }),
    version: 3,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
  };
}

async function primeAuthenticatedSession() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/me') {
      return jsonResponse({
        user: { id: 'user-1', email: 'person@example.test' },
        csrfToken: 'csrf-session',
      });
    }
    throw new Error(`Unexpected request during session setup: ${String(input)}`);
  }));
  await getCurrentUser();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetApiSecurityState();
  localStorage.clear();
});

describe('local task operations', () => {
  it('creates, edits, completes, reopens and deletes tasks through the recovery-aware store', () => {
    const initial = [makeOpportunity({ id: 'op-1' })];
    expect(saveOpportunities(initial)).toBe(true);
    let items = loadOpportunitiesWithRecovery().items;
    const commitCandidate = (candidate: typeof items) => {
      const saved = saveOpportunities(candidate);
      if (saved) items = candidate;
      return saved;
    };

    const created = commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => addOpportunityTask(tasks, draft, 'task-1'),
      commitCandidate,
    );
    expect(created).toMatchObject({ ok: true, changed: true, task: { id: 'task-1' } });
    if (!created.ok) return;
    items = created.items;
    expect(loadOpportunitiesWithRecovery().items[0]?.tasks).toEqual([created.task]);

    const edited = commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => updateOpportunityTask(tasks, 'task-1', {
        ...draft,
        title: '  Prepare the interview  ',
        dueDate: '',
      }),
      commitCandidate,
    );
    expect(edited).toMatchObject({
      ok: true,
      changed: true,
      task: { id: 'task-1', title: 'Prepare the interview', dueDate: '' },
    });
    if (!edited.ok) return;
    items = edited.items;

    const completed = commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => completeOpportunityTask(tasks, 'task-1', '2026-11-07'),
      commitCandidate,
    );
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: true, completedOn: '2026-11-07' },
    });
    if (!completed.ok) return;
    items = completed.items;

    const reopened = commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => reopenOpportunityTask(tasks, 'task-1'),
      commitCandidate,
    );
    expect(reopened).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: false, completedOn: '' },
    });
    if (!reopened.ok) return;
    items = reopened.items;

    const deleted = commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => deleteOpportunityTask(tasks, 'task-1'),
      commitCandidate,
    );
    expect(deleted).toMatchObject({ ok: true, changed: true, task: { id: 'task-1' } });
    if (!deleted.ok) return;
    expect(loadOpportunitiesWithRecovery().items[0]?.tasks).toEqual([]);
  });

  it('does not write when a task mutation is invalid or the parent cannot be resolved', () => {
    const items = [makeOpportunity({ id: 'op-1' })];
    const commit = vi.fn(() => true);

    expect(commitLocalTaskMutation(items, 'missing', () => ({
      ok: false,
      reason: 'not-found',
    }), commit)).toMatchObject({ ok: false, reason: 'opportunity-not-found' });

    expect(commitLocalTaskMutation(
      items,
      'op-1',
      (tasks) => addOpportunityTask(tasks, { ...draft, title: ' ' }, 'task-1'),
      commit,
    )).toMatchObject({ ok: false, reason: 'invalid-task' });
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps local data unchanged when the storage commit fails', () => {
    const initial = [makeOpportunity({ id: 'op-1' })];
    expect(saveOpportunities(initial)).toBe(true);
    const before = localStorage.getItem(STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    const result = commitLocalTaskMutation(
      initial,
      'op-1',
      (tasks) => addOpportunityTask(tasks, draft, 'task-1'),
      saveOpportunities,
    );

    expect(result).toMatchObject({ ok: false, reason: 'save-failed' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('authenticated API task operations', () => {
  it('runs the complete task lifecycle through fresh parent reads and versioned aggregate writes', async () => {
    await primeAuthenticatedSession();
    let resource = makeResource();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (init.method === 'GET' || init.method === undefined) {
        return jsonResponse(resource);
      }
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as {
          opportunity: typeof resource.opportunity;
        };
        resource = {
          ...resource,
          opportunity: { ...resource.opportunity, ...body.opportunity },
          version: resource.version + 1,
          updatedAt: '2026-11-07T12:00:00.000Z',
        };
        return jsonResponse(resource);
      }
      throw new Error(`Unexpected API method: ${String(init.method)}`);
    }));
    const repository = new HttpOpportunityRepository();

    const created = await commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => addOpportunityTask(tasks, draft, 'task-1'),
    );
    expect(created).toMatchObject({ ok: true, changed: true, task: { id: 'task-1' } });

    const edited = await commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => updateOpportunityTask(tasks, 'task-1', {
        ...draft,
        title: 'Review interview topics',
      }),
    );
    expect(edited).toMatchObject({
      ok: true,
      changed: true,
      task: { title: 'Review interview topics' },
    });

    const completed = await commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => completeOpportunityTask(tasks, 'task-1', '2026-11-07'),
    );
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: true, completedOn: '2026-11-07' },
    });

    const reopened = await commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => reopenOpportunityTask(tasks, 'task-1'),
    );
    expect(reopened).toMatchObject({
      ok: true,
      changed: true,
      task: { completed: false, completedOn: '' },
    });

    const deleted = await commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => deleteOpportunityTask(tasks, 'task-1'),
    );
    expect(deleted).toMatchObject({ ok: true, changed: true, task: { id: 'task-1' } });
    expect(resource.opportunity.tasks).toEqual([]);

    const writes = calls.filter((call) => call.init.method === 'PUT');
    expect(writes).toHaveLength(5);
    expect(writes.map(({ init }) => new Headers(init.headers).get('If-Match')))
      .toEqual(['"3"', '"4"', '"5"', '"6"', '"7"']);
    for (const write of writes) {
      const body = JSON.parse(String(write.init.body)) as {
        opportunity: typeof resource.opportunity;
        statusActivityDate?: string;
      };
      expect(body.opportunity.tasks).toBeDefined();
      expect(body.statusActivityDate).toBeUndefined();
      expect(new Headers(write.init.headers).get('X-CSRF-Token')).toBe('csrf-session');
    }
    expect(calls.filter((call) => call.init.method === 'GET')).toHaveLength(5);
  });

  it('surfaces a stale parent version without replaying the task mutation', async () => {
    await primeAuthenticatedSession();
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push(String(init.method ?? 'GET'));
      if (init.method === 'PUT') {
        return jsonResponse({
          error: {
            code: 'STALE_VERSION',
            message: 'This opportunity changed since you loaded it.',
          },
        }, 409);
      }
      return jsonResponse(makeResource());
    }));
    const repository = new HttpOpportunityRepository();

    await expect(commitApiTaskMutation(
      repository,
      'op-1',
      (tasks) => addOpportunityTask(tasks, draft, 'task-1'),
    )).rejects.toMatchObject({ status: 409 });

    expect(calls).toEqual(['GET', 'PUT']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_ACTIVITY_TYPE } from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import { makeActivity } from '../test/fixtures';
import {
  getCurrentUser,
  resetApiSecurityState,
} from './apiClient';
import {
  HttpOpportunityRepository,
  type OpportunityResource,
} from './httpOpportunityRepository';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeResource(overrides: Partial<Opportunity> = {}): OpportunityResource {
  return {
    opportunity: {
      id: 'op-1',
      title: 'Frontend Developer',
      company: 'Northwind',
      type: 'Full-time',
      status: 'Applied',
      priority: 'Medium',
      tags: [],
      url: '',
      deadline: '',
      followUpDate: '',
      activities: [],
      interviews: [],
      contacts: [],
      materials: [],
      compensation: '',
      description: '',
      notes: '',
      ...overrides,
    },
    version: 3,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  };
}

async function primeAuthenticatedSession() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/auth/me') {
      return jsonResponse({
        user: { id: 'user-1', email: 'person@example.com' },
        csrfToken: 'csrf-session',
      });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  }));
  await getCurrentUser();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetApiSecurityState();
});

describe('HttpOpportunityRepository', () => {
  it('loads the collection with its server revision and requests the archive view', async () => {
    const payload = { revision: 14, items: [makeResource()] };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init: RequestInit = {}) =>
      jsonResponse(payload),
    );
    vi.stubGlobal('fetch', fetchMock);
    const repository = new HttpOpportunityRepository();

    await expect(repository.load('active')).resolves.toEqual(payload);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/opportunities?archived=active');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'same-origin' });
  });

  it('sends versioned update headers and omits server-managed archive metadata', async () => {
    await primeAuthenticatedSession();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      return jsonResponse(makeResource({ archivedAt: '2026-10-02T10:00:00.000Z' }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = new HttpOpportunityRepository();
    const previous = makeResource({
      activities: [
        makeActivity({
          id: 'system-old',
          type: SYSTEM_ACTIVITY_TYPE,
          note: 'Status changed from Saved to Applied.',
        }),
      ],
    }).opportunity;
    const opportunity = {
      ...previous,
      status: 'Offer' as const,
      archivedAt: '2026-10-02T10:00:00.000Z',
      isDemo: true,
      activities: [
        ...previous.activities,
        makeActivity({
          id: 'system-new',
          type: SYSTEM_ACTIVITY_TYPE,
          note: 'Status changed from Applied to Offer.',
        }),
        makeActivity({ id: 'user-note', type: 'Other', note: 'User note' }),
      ],
    };

    await repository.update('op-1', 3, previous, opportunity, '2026-11-01');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/opportunities/op-1');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('If-Match')).toBe('"3"');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-session');
    const body = JSON.parse(String(calls[0].init.body)) as {
      opportunity: Record<string, unknown>;
      statusActivityDate?: string;
    };
    expect(body.statusActivityDate).toBe('2026-11-01');
    expect(body.opportunity).not.toHaveProperty('archivedAt');
    expect(body.opportunity).not.toHaveProperty('isDemo');
    expect(body.opportunity.activities).toEqual([
      previous.activities[0],
      makeActivity({ id: 'user-note', type: 'Other', note: 'User note' }),
    ]);
  });

  it('sends bodyless DELETE with JSON content type, CSRF and If-Match', async () => {
    await primeAuthenticatedSession();
    let captured: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
      captured = init;
      return jsonResponse({
        deletionBatchId: 'batch-1',
        expiresAt: '2026-11-01T10:00:10.000Z',
        deleted: [{ id: 'op-1', version: 4 }],
      });
    }));
    const repository = new HttpOpportunityRepository();

    await repository.remove('op-1', 3);

    const headers = new Headers(captured?.headers);
    expect(captured?.method).toBe('DELETE');
    expect(captured?.body).toBeUndefined();
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('If-Match')).toBe('"3"');
    expect(headers.get('X-CSRF-Token')).toBe('csrf-session');
  });

  it('sends bulk operations using expected versions and preserves the server status-history boundary', async () => {
    await primeAuthenticatedSession();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ revision: 15, items: [makeResource()] });
    }));
    const repository = new HttpOpportunityRepository();

    await repository.bulkStatus([{ id: 'op-1', expectedVersion: 3 }], 'Offer', '2026-11-01');

    expect(calls[0].url).toBe('/api/opportunities/bulk/status');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      items: [{ id: 'op-1', expectedVersion: 3 }],
      status: 'Offer',
      statusActivityDate: '2026-11-01',
    });
    expect(new Headers(calls[0].init.headers).get('X-CSRF-Token')).toBe('csrf-session');
  });

  it('supports dry-run imports and server backup export', async () => {
    await primeAuthenticatedSession();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const backup = {
      format: 'launchboard-backup' as const,
      schemaVersion: 1,
      exportedAt: '2026-11-01T10:00:00.000Z',
      opportunities: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      if (String(input) === '/api/opportunities/import') {
        return jsonResponse({
          mode: 'merge',
          dryRun: true,
          revision: 14,
          totalRecords: 0,
          validRecords: 0,
          repairedRecords: 0,
          invalidRecords: 0,
          duplicateRecords: 0,
          added: 0,
          skippedExisting: 0,
          replaced: 0,
          finalCount: 0,
          skipped: [],
        });
      }
      return jsonResponse(backup);
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = new HttpOpportunityRepository();

    await repository.importBackup({ mode: 'merge', backup, dryRun: true });
    await expect(repository.exportBackup()).resolves.toEqual(backup);

    expect(calls.map((call) => call.url)).toEqual([
      '/api/opportunities/import',
      '/api/opportunities/export',
    ]);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      mode: 'merge',
      dryRun: true,
      backup,
    });
  });
});

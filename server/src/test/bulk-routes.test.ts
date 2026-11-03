import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import { findActiveAuthSession, touchAuthSession } from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';

vi.mock('../auth/sessionRepo.js', () => ({
  consumePreAuthSession: vi.fn(), createAuthSession: vi.fn(), createPreAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(), revokePreAuthSession: vi.fn(), findActiveAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(), touchAuthSession: vi.fn(),
}));

const userId = 'bulk-user';
const token = generateToken(32);
const secret = Buffer.alloc(32, 0x4a).toString('base64url');
const origin = 'http://127.0.0.1:5173';
const session = { session: { id: 'session-1', userId, lastSeenAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000) }, user: { id: userId, email: 'bulk@example.test' } };
const connection = {
  query: vi.fn(), beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(),
  rollback: vi.fn(), release: vi.fn(),
};
const pool = { getConnection: vi.fn() } as any;
const states = new Map<string, Record<string, unknown>>();

function headers() {
  return { Origin: origin, 'Content-Type': 'application/json',
    Cookie: `${SESSION_COOKIE_NAME}=${token}`,
    'X-CSRF-Token': deriveCsrfToken(secret, 'authenticated', token) };
}
function app() { return createApp({ dbPool: pool, logErrors: false }); }
function setHandler(handler: (sql: string, params: unknown[]) => unknown[]) {
  connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) =>
    handler(String(sql), params));
}
function defaultRow(id: string, extra: Record<string, unknown> = {}) {
  return { id: id === 'a' ? 11 : 22, user_id: userId, public_id: id, position: 0,
    title: `Role ${id}`, company: 'Acme', type: 'Internship', status: 'Applied',
    priority: 'Medium', url: '', deadline: null, follow_up_date: null, compensation: '',
    description: '', notes: '', archived_at: null, is_demo: 0, version: 1,
    created_at: '2026-10-30 10:00:00.000', updated_at: '2026-10-30 10:00:00.000',
    ...states.get(id), ...extra };
}
async function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}/api/opportunities/${path}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
}

describe('bulk opportunity API — Stage 8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    states.clear();
    vi.stubEnv('CSRF_SECRET', secret);
    vi.stubEnv('TRUSTED_ORIGINS', origin);
    connection.query.mockResolvedValue([[], []]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    connection.execute.mockResolvedValue([[], []]);
    pool.getConnection.mockResolvedValue(connection);
    vi.mocked(findActiveAuthSession).mockResolvedValue(session as any);
    vi.mocked(touchAuthSession).mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('bulk archives in deterministic ID order with one timestamp and one revision', async () => {
    setHandler((sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      if (sql.startsWith('UPDATE opportunities SET archived_at')) {
        states.set(String(params[2]), { archived_at: '2026-10-31 12:00:00.000', version: 2 });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SELECT opportunity_revision')) return [[{ opportunity_revision: 8 }], []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/archive', {
        items: [{ id: 'b', expectedVersion: 1 }, { id: 'a', expectedVersion: 1 }],
      });
      const body = await response.json() as any;
      const locks = connection.execute.mock.calls.filter(([sql]) =>
        String(sql).includes('SELECT *') && String(sql).includes('FROM opportunities') && String(sql).includes('FOR UPDATE'),
      );
      expect(response.status).toBe(200);
      expect(body.revision).toBe(8);
      expect(body.items.map((item: any) => item.opportunity.id)).toEqual(['a', 'b']);
      expect(locks.map((call) => call[1]?.[1])).toEqual(['a', 'b']);
      const updates = connection.execute.mock.calls.filter(([sql]) =>
        String(sql).startsWith('UPDATE opportunities SET archived_at'),
      );
      expect(updates).toHaveLength(2);
      expect(updates[0]?.[1]?.[0]).toBe(updates[1]?.[1]?.[0]);
      expect(connection.commit).toHaveBeenCalledOnce();
    });
  });

  it('rejects a stale item as one conflict and rolls back the entire batch', async () => {
    setHandler((sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id, { version: id === 'b' ? 9 : 1 })], []];
      }
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/archive', {
        items: [{ id: 'a', expectedVersion: 1 }, { id: 'b', expectedVersion: 2 }],
      });
      const body = await response.json() as any;
      expect(response.status).toBe(409);
      expect(body.error.code).toBe('BULK_CONFLICT');
      expect(body.error.details.failures).toEqual([
        expect.objectContaining({ id: 'b', reason: 'stale_version', currentVersion: 9 }),
      ]);
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE opportunities'),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('bulk status writes one server activity per item and increments the collection revision once', async () => {
    setHandler((sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      if (sql.includes('MAX(`position`)') && sql.includes('FROM activities')) return [[{ next_position: 0 }], []];
      if (sql.includes('SELECT opportunity_revision')) return [[{ opportunity_revision: 9 }], []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) return [[], []];
      if (sql.startsWith('SELECT')) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/status', {
        items: [{ id: 'b', expectedVersion: 1 }, { id: 'a', expectedVersion: 1 }],
        status: 'Interview', statusActivityDate: '2026-11-02',
      });
      const body = await response.json() as any;
      const activities = connection.execute.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO activities'),
      );
      expect(response.status).toBe(200);
      expect(body.revision).toBe(9);
      expect(activities).toHaveLength(2);
      expect(activities[0]?.[1]).toEqual([
        11, expect.any(String), 0, 'Status changed', '2026-11-02',
        'Status changed from Applied to Interview.',
      ]);
      expect(connection.commit).toHaveBeenCalledOnce();
    });
  });

  it('bulk deletes one archive view into one Undo batch and restores that batch before expiry', async () => {
    let batchId = '';
    const future = new Date(Date.now() + 60_000).toISOString().slice(0, 23).replace('T', ' ');
    states.set('a', { version: 1 });
    states.set('b', { version: 1 });
    setHandler((sql, params) => {
      if (sql.includes('deleted_batch_id') && sql.includes('FROM opportunities') && sql.startsWith('SELECT *')) {
        return [[defaultRow('a'), defaultRow('b')], []];
      }
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      if (sql.startsWith('UPDATE opportunities SET deleted_at=NULL')) {
        states.set(Number(params[1]) === 11 ? 'a' : 'b', { version: 3, deleted_at: null }); return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('UPDATE opportunities SET deleted_at=?')) {
        states.set(Number(params[3]) === 11 ? 'a' : 'b', { version: 2, deleted_at: params[0] }); return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('INSERT INTO opportunity_deletions')) { batchId = String(params[0]); return [{ affectedRows: 1 }, []]; }
      if (sql.includes('SELECT expires_at FROM opportunity_deletions')) return [[{ expires_at: future }], []];
      if (sql.includes('SELECT opportunity_revision')) return [[{ opportunity_revision: 10 }], []];
      if (sql.includes('SELECT expires_at,restored_at FROM opportunity_deletions')) {
        return [[{ expires_at: future, restored_at: null }], []];
      }
      if (sql.includes('deleted_batch_id') && sql.includes('FROM opportunities') && sql.startsWith('SELECT *')) {
        return [[defaultRow('a', { deleted_at: '2026-10-31 11:59:59.000', version: 2 }),
          defaultRow('b', { deleted_at: '2026-10-31 11:59:59.000', version: 2 })], []];
      }
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id, { version: 3 })], []];
      }
      if (sql.startsWith('SELECT')) return [[], []];
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const deleted = await post(baseUrl, 'bulk/delete', {
        items: [{ id: 'a', expectedVersion: 1 }, { id: 'b', expectedVersion: 1 }],
        archiveView: 'active',
      });
      const deletedBody = await deleted.json() as any;
      expect(deleted.status).toBe(200);
      expect(deletedBody.deletionBatchId).toBe(batchId);
      expect(deletedBody.deleted).toHaveLength(2);
      expect(connection.commit).toHaveBeenCalledOnce();

      const restored = await post(baseUrl, `deletions/${batchId}/restore`, {});
      const restoredBody = await restored.json() as any;
      expect(restored.status).toBe(200);
      expect(restoredBody.items).toHaveLength(2);
      expect(restoredBody.items.every((item: any) => item.version === 3)).toBe(true);
      expect(connection.commit).toHaveBeenCalledTimes(2);
    });
  });

  it('bulk restores archived records and conditionally undoes archive metadata', async () => {
    states.set('a', { archived_at: '2026-10-30 10:00:00.000', version: 1 });
    setHandler((sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        const id = String(params[1]); return [[defaultRow(id)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      if (sql.startsWith('UPDATE opportunities SET archived_at=NULL')) {
        states.set(Number(params[1]) === 11 ? 'a' : 'b', { archived_at: null, version: 2 }); return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('UPDATE opportunities SET archived_at=?')) {
        states.set(Number(params[2]) === 11 ? 'a' : 'b', { archived_at: params[0], version: 3 }); return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      if (sql.includes('SELECT opportunity_revision')) return [[{ opportunity_revision: 11 }], []];
      if (sql.startsWith('SELECT')) return [[], []];
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const restored = await post(baseUrl, 'bulk/restore', {
        items: [{ id: 'a', expectedVersion: 1 }],
      });
      expect(restored.status).toBe(200);
      const restoredBody = await restored.json() as any;
      expect(restoredBody.items[0].version).toBe(2);

      states.set('a', { archived_at: '2026-10-30 10:00:00.000', version: 2 });
      const undone = await post(baseUrl, 'bulk/undo-archive', {
        items: [{
          id: 'a',
          expectedArchivedAt: '2026-10-30T10:00:00.000Z',
          previousArchivedAt: null,
        }],
      });
      expect(undone.status).toBe(200);
      const undoneBody = await undone.json() as any;
      expect(undoneBody.items[0].version).toBe(3);
      expect(undoneBody.items[0].opportunity.archivedAt).toBeUndefined();
      expect(connection.commit).toHaveBeenCalledTimes(2);
    });
  });

  it('uses the dedicated duplicate-request error code without opening a transaction', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/archive', {
        items: [{ id: 'same', expectedVersion: 1 }, { id: 'same', expectedVersion: 2 }],
      });
      const body = await response.json() as any;
      expect(response.status).toBe(422);
      expect(body.error.code).toBe('DUPLICATE_REQUEST_ID');
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('rejects an expired deletion batch without restoring any opportunity', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT expires_at,restored_at FROM opportunity_deletions')) {
        return [[{ expires_at: '2020-01-01 00:00:00.000', restored_at: null }], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) {
        return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      }
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'deletions/expired-batch/restore', {});
      const body = await response.json() as any;
      expect(response.status).toBe(410);
      expect(body.error.code).toBe('DELETION_EXPIRED');
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).includes('deleted_batch_id') && String(sql).startsWith('SELECT *'),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
    });
  });

  it('rolls back the entire batch when a later database write fails', async () => {
    setHandler((sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        return [[defaultRow(String(params[1]))], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-10-31 12:00:00.000' }], []];
      if (sql.startsWith('UPDATE opportunities SET archived_at=?') && Number(params[2]) === 22) {
        throw Object.assign(new Error('private database detail'), { code: 'ER_LOCK_WAIT_TIMEOUT' });
      }
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/archive', {
        items: [{ id: 'a', expectedVersion: 1 }, { id: 'b', expectedVersion: 1 }],
      });
      const body = await response.json() as any;
      expect(response.status).toBe(503);
      expect(body.error.code).toBe('NOT_READY');
      expect(JSON.stringify(body)).not.toContain('private database detail');
      expect(connection.execute.mock.calls.filter(([sql]) =>
        String(sql).startsWith('UPDATE opportunities SET archived_at=?'),
      )).toHaveLength(2);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('rejects invalid bulk bodies before acquiring a database connection', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await post(baseUrl, 'bulk/archive', { items: [] });
      const body = await response.json() as any;
      expect(response.status).toBe(422);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});

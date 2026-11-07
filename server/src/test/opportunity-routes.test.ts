import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import {
  findActiveAuthSession,
  touchAuthSession,
} from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';
import { createBody, updateBody } from './helpers/fixtures.js';

vi.mock('../auth/sessionRepo.js', () => ({
  consumePreAuthSession: vi.fn(),
  createAuthSession: vi.fn(),
  createPreAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(),
  revokePreAuthSession: vi.fn(),
  findActiveAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(),
  touchAuthSession: vi.fn(),
}));

const userId = 'user-123';
const sessionToken = generateToken(32);
const csrfSecret = Buffer.alloc(32, 0x6b).toString('base64url');
const trustedOrigin = 'http://127.0.0.1:5173';
const activeSession = {
  session: {
    id: 'session-1',
    userId,
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  },
  user: { id: userId, email: 'owner@example.test' },
};

const baseRow = {
  id: 41,
  user_id: userId,
  public_id: 'opportunity-1',
  position: 0,
  title: 'Software Engineer',
  company: 'Acme',
  type: 'Internship',
  status: 'Applied',
  priority: 'High',
  url: 'https://example.test/jobs/1',
  deadline: '2026-11-15',
  follow_up_date: '',
  compensation: 'Competitive',
  description: 'Product engineering role',
  notes: '',
  archived_at: null,
  is_demo: 0,
  version: 3,
  created_at: '2026-10-30 10:00:00.000',
  updated_at: '2026-10-31 10:00:00.000',
};

const statusActivity = {
  opportunity_id: 41,
  public_id: 'activity-status-1',
  type: 'Status changed',
  date: '2026-10-30',
  note: 'Status changed from Saved to Applied.',
  position: 0,
};

const connection = {
  query: vi.fn(),
  beginTransaction: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const pool = {
  getConnection: vi.fn(),
} as any;

type ExecuteHandler = (sql: string, params: unknown[]) => Promise<unknown[]> | unknown[];

function setExecuteHandler(handler: ExecuteHandler) {
  connection.execute.mockImplementation(async (sql: string, params: unknown[] = []) =>
    handler(String(sql), params),
  );
}

function row(overrides: Record<string, unknown> = {}) {
  return { ...baseRow, ...overrides };
}

function emptyChildBody() {
  return createBody({
    id: 'opportunity-created',
    tags: [],
    activities: [],
    interviews: [],
    contacts: [],
    materials: [],
  });
}

function emptyChildUpdate(overrides: Record<string, unknown> = {}) {
  return updateBody({
    tags: [],
    activities: [],
    interviews: [],
    contacts: [],
    materials: [],
    ...overrides,
  });
}

function requestHeaders(overrides: Record<string, string> = {}) {
  return {
    Origin: trustedOrigin,
    'Content-Type': 'application/json',
    Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    'X-CSRF-Token': deriveCsrfToken(csrfSecret, 'authenticated', sessionToken),
    ...overrides,
  };
}

function app() {
  return createApp({ dbPool: pool, logErrors: false });
}

async function getCollection(baseUrl: string, query = '', headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/opportunities${query}`, {
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
      ...headers,
    },
  });
}

async function postCreate(baseUrl: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/opportunities`, {
    method: 'POST',
    headers: requestHeaders(headers),
    body: JSON.stringify(body),
  });
}

async function putUpdate(
  baseUrl: string,
  body: unknown,
  version = 3,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/opportunities/opportunity-1`, {
    method: 'PUT',
    headers: requestHeaders({ 'If-Match': `"${version}"`, ...headers }),
    body: JSON.stringify(body),
  });
}

async function deleteOne(
  baseUrl: string,
  version = 3,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/opportunities/opportunity-1`, {
    method: 'DELETE',
    headers: requestHeaders({ 'If-Match': `"${version}"`, ...headers }),
  });
}

describe('opportunity aggregate API — Stage 6', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CSRF_SECRET', csrfSecret);
    vi.stubEnv('TRUSTED_ORIGINS', trustedOrigin);

    connection.query.mockResolvedValue([[], []]);
    connection.beginTransaction.mockResolvedValue(undefined);
    connection.commit.mockResolvedValue(undefined);
    connection.rollback.mockResolvedValue(undefined);
    connection.release.mockImplementation(() => undefined);
    connection.execute.mockResolvedValue([[], []]);
    pool.getConnection.mockResolvedValue(connection);

    vi.mocked(findActiveAuthSession).mockResolvedValue(activeSession as any);
    vi.mocked(touchAuthSession).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists only the authenticated user’s records and includes revision and server metadata', async () => {
    const activity = { ...statusActivity };
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT opportunity_revision')) return [[{ opportunity_revision: 12 }], []];
      if (sql.includes('SELECT o.*')) return [[row()], []];
      if (sql.includes('FROM activities') && sql.includes('IN (')) return [[activity], []];
      if (sql.includes('FROM tasks') && sql.includes('IN (')) return [[{
        opportunity_id: 41,
        public_id: 'task-list-1',
        title: 'Submit application follow-up',
        notes: '',
        priority: 'Medium',
        due_date: '2026-11-09',
        completed: 0,
        completed_on: null,
        position: 0,
      }], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await getCollection(baseUrl, '?archived=active');
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(body.revision).toBe(12);
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        opportunity: {
          id: 'opportunity-1',
          title: 'Software Engineer',
          deadline: '2026-11-15',
          followUpDate: '',
          activities: [{
            id: 'activity-status-1',
            type: 'Status changed',
            date: '2026-10-30',
          }],
          tags: [],
          interviews: [],
          contacts: [],
          materials: [],
          tasks: [{
            id: 'task-list-1',
            title: 'Submit application follow-up',
            notes: '',
            priority: 'Medium',
            dueDate: '2026-11-09',
            completed: false,
            completedOn: '',
          }],
        },
        version: 3,
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-31T10:00:00.000Z',
      });
      const collectionSql = connection.execute.mock.calls.find(([sql]) =>
        String(sql).includes('SELECT o.*'),
      );
      expect(collectionSql?.[0]).toContain('o.user_id = ?');
      expect(collectionSql?.[0]).toContain('o.deleted_at IS NULL');
      expect(collectionSql?.[0]).toContain('o.archived_at IS NULL');
      expect(collectionSql?.[1]).toEqual([userId]);
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('returns 404 for an opportunity not owned by the authenticated user', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/opportunities/private-id`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });
      const body = await response.json() as any;

      expect(response.status).toBe(404);
      expect(body.error.code).toBe('NOT_FOUND');
      const lookup = connection.execute.mock.calls.find(([sql]) =>
        String(sql).includes('FROM opportunities'),
      );
      expect(lookup?.[0]).toContain('user_id = ?');
      expect(lookup?.[1]).toEqual([userId, 'private-id']);
    });
  });

  it('returns nested records in stored order with date-only and local-time values intact', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row()], []];
      if (sql.includes('FROM opportunity_tags')) return [[{ tag: 'Remote' }, { tag: 'React' }], []];
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) return [[statusActivity], []];
      if (sql.includes('FROM interviews')) return [[{
        public_id: 'interview-1', round: 'Recruiter Screen', date: '2026-11-02',
        time: '09:30:00', mode: 'Video', status: 'Scheduled', outcome: null,
        meeting_url: 'https://meet.example.test/room', location: '',
        preparation_notes: 'Review role', notes: '', contact_public_id: 'contact-1',
      }], []];
      if (sql.includes('FROM contacts')) return [[{
        public_id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter',
        email: 'jordan@example.test', phone: '', website: '', notes: '',
      }], []];
      if (sql.includes('FROM materials')) return [[{
        public_id: 'material-1', label: 'Resume', kind: 'Resume', url: '',
        version: 'v2', status: 'Ready', notes: '',
      }], []];
      if (sql.includes('FROM tasks')) return [[{
        public_id: 'task-1', title: 'Prepare for interview', notes: 'Review role',
        priority: 'High', due_date: '2026-11-08', completed: 0,
        completed_on: null, position: 0,
      }], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/opportunities/opportunity-1`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
      });
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.opportunity.tags).toEqual(['Remote', 'React']);
      expect(body.opportunity.interviews[0]).toMatchObject({
        id: 'interview-1', date: '2026-11-02', time: '09:30',
        contactId: 'contact-1', outcome: '',
      });
      expect(body.opportunity.contacts[0]).toMatchObject({ id: 'contact-1', name: 'Jordan Lee' });
      expect(body.opportunity.materials[0]).toMatchObject({ id: 'material-1', version: 'v2' });
      expect(body.opportunity.tasks).toEqual([{
        id: 'task-1',
        title: 'Prepare for interview',
        notes: 'Review role',
        priority: 'High',
        dueDate: '2026-11-08',
        completed: false,
        completedOn: '',
      }]);
      expect(body.opportunity.activities[0].id).toBe('activity-status-1');
    });
  });

  it('rejects an unsupported archive filter without querying the opportunity repository', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await getCollection(baseUrl, '?archived=everything');
      const body = await response.json() as any;

      expect(response.status).toBe(400);
      expect(body.error.code).toBe('BAD_REQUEST');
      expect(connection.execute).not.toHaveBeenCalled();
      expect(touchAuthSession).not.toHaveBeenCalled();
    });
  });

  it('creates an opportunity transactionally with a server-owned version and append position', async () => {
    const created = row({
      id: 99,
      public_id: 'opportunity-created',
      position: 4,
      version: 1,
      title: 'Frontend Engineer',
      status: 'Saved',
      created_at: '2026-10-31 12:00:00.000',
      updated_at: '2026-10-31 12:00:00.000',
    });
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT id FROM users')) return [[{ id: userId }], []];
      if (sql.includes('MAX(`position`)') && sql.includes('FROM opportunities')) {
        return [[{ next_position: 4 }], []];
      }
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 99 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[created], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, emptyChildBody());
      const body = await response.json() as any;

      expect(response.status).toBe(201);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toMatchObject({
        opportunity: {
          id: 'opportunity-created',
          title: 'Frontend Engineer',
          tags: [],
          activities: [],
          interviews: [],
          contacts: [],
          materials: [],
        },
        version: 1,
      });
      expect(connection.beginTransaction).toHaveBeenCalledOnce();
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      const insert = connection.execute.mock.calls.find(([sql]) =>
        String(sql).includes('INSERT INTO opportunities'),
      );
      expect(insert?.[1]).toEqual([
        userId,
        'opportunity-created',
        4,
        'Software Engineering Intern',
        'Acme',
        'Internship',
        'Applied',
        'Medium',
        'https://example.com/jobs/1',
        '2026-11-01',
        null,
        '',
        '',
        '',
      ]);
    });
  });

  it('creates tags and all nested workspace collections in one transaction', async () => {
    const created = row({ id: 99, public_id: 'nested-test', version: 1 });
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT id FROM users')) return [[{ id: userId }], []];
      if (sql.includes('MAX(`position`)') && sql.includes('FROM opportunities')) {
        return [[{ next_position: 0 }], []];
      }
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 99 }, []];
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[created], []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    const task = {
      id: 'task-1',
      title: 'Prepare for interview',
      notes: 'Review role',
      priority: 'High',
      dueDate: '2026-11-08',
      completed: false,
      completedOn: '',
    };
    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, createBody({ id: 'nested-test', tasks: [task] }));
      const body = await response.json() as any;
      const sql = connection.execute.mock.calls.map(([statement]) => String(statement));

      expect(response.status).toBe(201);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(body.opportunity.tags).toEqual([]);
      expect(sql.some((statement) => statement.includes('INSERT INTO opportunity_tags'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO contacts'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO interviews'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO materials'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO activities'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO tasks'))).toBe(true);
      const taskInsert = connection.execute.mock.calls.find(([statement]) =>
        String(statement).includes('INSERT INTO tasks'),
      );
      expect(taskInsert?.[1]).toEqual([
        99, 'task-1', 0, 'Prepare for interview', 'Review role', 'High',
        '2026-11-08', 0, null,
      ]);
      expect(sql.findIndex((statement) => statement.includes('INSERT INTO contacts')))
        .toBeLessThan(sql.findIndex((statement) => statement.includes('INSERT INTO interviews')));
    });
  });

  it('rejects an interview whose contact is not part of the same opportunity before DB access', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, createBody({ contacts: [] }));
      const body = await response.json() as any;

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields).toEqual([
        expect.objectContaining({ path: 'opportunity.interviews[0].contactId' }),
      ]);
      expect(connection.execute).not.toHaveBeenCalled();
    });
  });

  it('maps duplicate public IDs to a safe 409 and rolls back the create transaction', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT id FROM users')) return [[{ id: userId }], []];
      if (sql.includes('MAX(`position`)')) return [[{ next_position: 0 }], []];
      if (sql.includes('INSERT INTO opportunities')) {
        throw Object.assign(new Error('private duplicate key diagnostics'), {
          code: 'ER_DUP_ENTRY',
          sqlMessage: 'private SQL index detail',
        });
      }
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, emptyChildBody());
      const text = await response.text();

      expect(response.status).toBe(409);
      expect(text).toContain('DUPLICATE_ID');
      expect(text).not.toContain('private duplicate');
      expect(text).not.toContain('private SQL');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('requires If-Match on an update before opening a write transaction', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/opportunities/opportunity-1`, {
        method: 'PUT',
        headers: requestHeaders(),
        body: JSON.stringify(emptyChildUpdate()),
      });
      const body = await response.json() as any;

      expect(response.status).toBe(428);
      expect(body.error.code).toBe('PRECONDITION_REQUIRED');
      expect(connection.beginTransaction).not.toHaveBeenCalled();
    });
  });

  it('rejects a stale update without issuing any opportunity update', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row({ version: 4 })], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await putUpdate(baseUrl, emptyChildUpdate());
      const body = await response.json() as any;

      expect(response.status).toBe(409);
      expect(body.error.code).toBe('STALE_VERSION');
      expect(body.error.details).toMatchObject({
        id: 'opportunity-1',
        expectedVersion: 3,
        currentVersion: 4,
      });
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE opportunities'),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
    });
  });

  it('updates a status transactionally, appends one server-generated activity and increments version', async () => {
    let parentSelects = 0;
    const storedActivities: any[] = [];
    const updatedRow = row({ version: 4, status: 'Interview' });
    setExecuteHandler(async (sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        parentSelects += 1;
        return [[parentSelects === 1 ? row() : updatedRow], []];
      }
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) {
        return [storedActivities, []];
      }
      if (sql.includes('MAX(`position`)') && sql.includes('FROM activities')) {
        return [[{ next_position: 0 }], []];
      }
      if (sql.includes('INSERT INTO activities')) {
        storedActivities.push({
          opportunity_id: 41,
          public_id: params[1],
          position: params[2],
          type: params[3],
          date: params[4],
          note: params[5],
        });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE opportunities')) return [{ affectedRows: 1 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await putUpdate(
        baseUrl,
        {
          ...emptyChildUpdate({ status: 'Interview' }),
          statusActivityDate: '2026-11-02',
        },
      );
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.version).toBe(4);
      expect(body.opportunity.status).toBe('Interview');
      expect(body.opportunity.activities).toHaveLength(1);
      expect(body.opportunity.activities[0]).toMatchObject({
        type: 'Status changed',
        date: '2026-11-02',
        note: 'Status changed from Applied to Interview.',
      });
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(storedActivities).toHaveLength(1);
    });
  });

  it('replaces nested collections atomically while preserving immutable status history', async () => {
    let parentReads = 0;
    const currentSystemActivity = { ...statusActivity, public_id: 'system-1' };
    const nestedUpdate = updateBody({
      tags: ['Remote', 'React'],
      tasks: [{
        id: 'task-updated',
        title: 'Send follow-up',
        notes: '',
        priority: 'Medium',
        dueDate: '2026-11-10',
        completed: false,
        completedOn: '',
      }],
      activities: [
        { id: 'system-1', type: 'Status changed', date: '2026-10-30', note: 'Status changed from Saved to Applied.' },
        { id: 'user-activity-1', type: 'Recruiter contacted', date: '2026-10-31', note: 'Sent a follow-up.' },
      ],
    });
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        parentReads += 1;
        return [[parentReads === 1 ? row() : row({ version: 4 })], []];
      }
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) {
        return [[currentSystemActivity], []];
      }
      if (sql.includes('UPDATE opportunities')) return [{ affectedRows: 1 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await putUpdate(baseUrl, nestedUpdate);
      const body = await response.json() as any;
      const sql = connection.execute.mock.calls.map(([statement]) => String(statement));

      expect(response.status).toBe(200);
      expect(body.version).toBe(4);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(sql.findIndex((statement) => statement.includes('DELETE FROM interviews')))
        .toBeLessThan(sql.findIndex((statement) => statement.includes('DELETE FROM contacts')));
      expect(sql.findIndex((statement) => statement.includes('INSERT INTO contacts')))
        .toBeLessThan(sql.findIndex((statement) => statement.includes('INSERT INTO interviews')));
      expect(sql.some((statement) => statement.includes('INSERT INTO opportunity_tags'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO materials'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO activities'))).toBe(true);
      expect(sql.some((statement) => statement.includes('DELETE FROM tasks WHERE opportunity_id = ?'))).toBe(true);
      expect(sql.some((statement) => statement.includes('INSERT INTO tasks'))).toBe(true);
      const activityInsert = connection.execute.mock.calls.find(([statement]) =>
        String(statement).includes('INSERT INTO activities'),
      );
      expect(activityInsert?.[1]).toEqual([
        41, 'system-1', 0, 'Status changed', '2026-10-30',
        'Status changed from Saved to Applied.',
      ]);
    });
  });

  it('persists task create, complete, reopen and delete through successive parent versions', async () => {
    let parentVersion = 3;
    let storedTasks: Array<{
      public_id: string;
      title: string;
      notes: string;
      priority: string;
      due_date: string | null;
      completed: number;
      completed_on: string | null;
      position: number;
    }> = [];
    const systemActivityInput = {
      id: 'activity-status-1',
      type: 'Status changed',
      date: '2026-10-30',
      note: 'Status changed from Saved to Applied.',
    };

    setExecuteHandler(async (sql, params) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        return [[row({ version: parentVersion })], []];
      }
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) {
        return [[statusActivity], []];
      }
      if (sql.includes('DELETE FROM tasks WHERE opportunity_id = ?')) {
        storedTasks = [];
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM tasks') && sql.includes('WHERE opportunity_id = ?')) {
        return [storedTasks.map((task) => ({ ...task })), []];
      }
      if (sql.includes('INSERT INTO tasks')) {
        storedTasks.push({
          public_id: String(params[1]),
          position: Number(params[2]),
          title: String(params[3]),
          notes: String(params[4]),
          priority: String(params[5]),
          due_date: params[6] as string | null,
          completed: Number(params[7]),
          completed_on: params[8] as string | null,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE opportunities')) {
        parentVersion += 1;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('UPDATE users SET opportunity_revision')) {
        return [{ affectedRows: 1 }, []];
      }
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const task = {
        id: 'task-lifecycle',
        title: 'Prepare for interview',
        notes: 'Review the role',
        priority: 'High',
        dueDate: '2026-11-09',
        completed: false,
        completedOn: '',
      };

      const createdResponse = await putUpdate(baseUrl, emptyChildUpdate({
        activities: [systemActivityInput],
        tasks: [task],
      }), 3);
      const created = await createdResponse.json() as any;
      expect(createdResponse.status).toBe(200);
      expect(created.version).toBe(4);
      expect(created.opportunity.tasks).toEqual([task]);

      const completedTask = {
        ...task,
        completed: true,
        completedOn: '2026-11-07',
      };
      const completedResponse = await putUpdate(baseUrl, emptyChildUpdate({
        activities: [systemActivityInput],
        tasks: [completedTask],
      }), 4);
      const completed = await completedResponse.json() as any;
      expect(completedResponse.status).toBe(200);
      expect(completed.version).toBe(5);
      expect(completed.opportunity.tasks).toEqual([completedTask]);

      const reopenedTask = {
        ...task,
        completed: false,
        completedOn: '',
      };
      const reopenedResponse = await putUpdate(baseUrl, emptyChildUpdate({
        activities: [systemActivityInput],
        tasks: [reopenedTask],
      }), 5);
      const reopened = await reopenedResponse.json() as any;
      expect(reopenedResponse.status).toBe(200);
      expect(reopened.version).toBe(6);
      expect(reopened.opportunity.tasks).toEqual([reopenedTask]);

      const deletedResponse = await putUpdate(baseUrl, emptyChildUpdate({
        activities: [systemActivityInput],
        tasks: [],
      }), 6);
      const deleted = await deletedResponse.json() as any;
      expect(deletedResponse.status).toBe(200);
      expect(deleted.version).toBe(7);
      expect(deleted.opportunity.tasks).toEqual([]);
      expect(storedTasks).toEqual([]);
      expect(connection.commit).toHaveBeenCalledTimes(4);
      expect(connection.rollback).not.toHaveBeenCalled();
    });
  });

  it('rolls back the parent and all earlier child writes if a nested insert fails', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT id FROM users')) return [[{ id: userId }], []];
      if (sql.includes('MAX(`position`)') && sql.includes('FROM opportunities')) {
        return [[{ next_position: 0 }], []];
      }
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 99 }, []];
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row({ id: 99, public_id: 'nested-failure' })], []];
      if (sql.includes('INSERT INTO tasks')) {
        throw Object.assign(new Error('private nested insert failure'), { code: 'ER_DATA_TOO_LONG' });
      }
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, createBody({
        id: 'nested-failure',
        tasks: [{
          id: 'task-fail',
          title: 'This child insert will fail',
          notes: '',
          priority: 'Low',
          dueDate: '',
          completed: false,
          completedOn: '',
        }],
      }));
      const text = await response.text();

      expect(response.status).toBe(503);
      expect(text).not.toContain('private nested insert failure');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();
    });
  });

  it('rejects edits to server-owned status history before any parent or child write', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row()], []];
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) return [[statusActivity], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await putUpdate(baseUrl, emptyChildUpdate({
        activities: [{
          id: 'activity-status-1',
          type: 'Status changed',
          date: '2026-10-30',
          note: 'Tampered history.',
        }],
      }));
      const body = await response.json() as any;

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('SYSTEM_ACTIVITY_IMMUTABLE');
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE opportunities') ||
        String(sql).startsWith('DELETE FROM'),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
    });
  });

  it('blocks an invalid authenticated CSRF token before touching session or opportunity state', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, emptyChildBody(), {
        'X-CSRF-Token': 'incorrect-token',
      });
      const body = await response.json() as any;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(touchAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('archives an owned opportunity and increments its version and collection revision', async () => {
    let parentSelects = 0;
    const archivedRow = row({
      version: 4,
      archived_at: '2026-10-31 12:30:00.000',
    });
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) {
        parentSelects += 1;
        return [[parentSelects === 1 ? row() : archivedRow], []];
      }
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) {
        return [[], []];
      }
      if (sql.includes('UPDATE opportunities')) return [{ affectedRows: 1 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/opportunities/opportunity-1/archive`, {
        method: 'POST',
        headers: requestHeaders({ 'If-Match': '"3"' }),
      });
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body.version).toBe(4);
      expect(body.opportunity.archivedAt).toBe('2026-10-31T12:30:00.000Z');
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE users SET opportunity_revision'),
      )).toBe(true);
    });
  });

  it('requires statusActivityDate when the status changes and rolls back without writing', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row()], []];
      if (sql.includes('FROM activities') && sql.includes('WHERE opportunity_id = ?')) return [[], []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await putUpdate(
        baseUrl,
        emptyChildUpdate({ status: 'Interview' }),
      );
      const body = await response.json() as any;

      expect(response.status).toBe(422);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.fields).toEqual([
        expect.objectContaining({ path: 'statusActivityDate' }),
      ]);
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('UPDATE opportunities'),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('soft-deletes only the owned versioned record and returns a ten-second Undo batch', async () => {
    setExecuteHandler(async (sql) => {
      if (sql.includes('SELECT *') && sql.includes('FROM opportunities')) return [[row()], []];
      if (sql.includes('INSERT INTO opportunity_deletions')) return [{ affectedRows: 1 }, []];
      if (sql.includes('UPDATE opportunities')) return [{ affectedRows: 1 }, []];
      if (sql.includes('SELECT expires_at FROM opportunity_deletions')) {
        return [[{ expires_at: '2026-10-31 12:00:10.000' }], []];
      }
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await deleteOne(baseUrl, 3);
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        expiresAt: '2026-10-31T12:00:10.000Z',
        deleted: [{ id: 'opportunity-1', version: 4 }],
      });
      expect(typeof body.deletionBatchId).toBe('string');
      expect(connection.commit).toHaveBeenCalledOnce();
      const softDelete = connection.execute.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE opportunities SET deleted_at'),
      );
      expect(softDelete?.[1]).toEqual([
        body.deletionBatchId,
        41,
        userId,
      ]);
    });
  });

  it('rejects an untrusted Origin before session lookup or touching authenticated activity', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await postCreate(baseUrl, emptyChildBody(), {
        Origin: 'https://attacker.example',
      });
      const body = await response.json() as any;

      expect(response.status).toBe(403);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(findActiveAuthSession).not.toHaveBeenCalled();
      expect(touchAuthSession).not.toHaveBeenCalled();
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});

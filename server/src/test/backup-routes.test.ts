import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS } from '@launchboard/domain';
import { deriveCsrfToken } from '../auth/csrf.js';
import { SESSION_COOKIE_NAME } from '../auth/cookies.js';
import { generateToken } from '../auth/tokens.js';
import { findActiveAuthSession, touchAuthSession } from '../auth/sessionRepo.js';
import { withTestServer } from './helpers/server.js';
import { backupEnvelope, validOpportunity } from './helpers/fixtures.js';

vi.mock('../auth/sessionRepo.js', () => ({
  consumePreAuthSession: vi.fn(), createAuthSession: vi.fn(), createPreAuthSession: vi.fn(),
  findPreAuthSession: vi.fn(), revokePreAuthSession: vi.fn(), findActiveAuthSession: vi.fn(),
  revokeAuthSession: vi.fn(), touchAuthSession: vi.fn(),
}));

const userId = 'backup-user';
const token = generateToken(32);
const secret = Buffer.alloc(32, 0x4b).toString('base64url');
const origin = 'http://127.0.0.1:5173';
const session = {
  session: { id: 'session-backup', userId, lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000) },
  user: { id: userId, email: 'backup@example.test' },
};
const connection = {
  query: vi.fn(), beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(),
  rollback: vi.fn(), release: vi.fn(),
};
const pool = { getConnection: vi.fn() } as any;

type Handler = (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>;
function setHandler(handler: Handler) {
  connection.execute.mockImplementation(async (sql, params: unknown[] = []) =>
    handler(String(sql), params));
}
function headers() {
  return {
    Origin: origin,
    'Content-Type': 'application/json',
    Cookie: SESSION_COOKIE_NAME + '=' + token,
    'X-CSRF-Token': deriveCsrfToken(secret, 'authenticated', token),
  };
}
function app() { return createApp({ dbPool: pool, logErrors: false }); }
async function request(baseUrl: string, path: string, body: unknown, method = 'POST') {
  return fetch(baseUrl + '/api/opportunities/' + path, {
    method, headers: headers(),
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
function existingRow(publicId: string, position: number, deletedAt: string | null = null) {
  return { id: position + 10, public_id: publicId, position, deleted_at: deletedAt };
}

describe('opportunity backup API — Stage 9', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('exports a version-3 envelope with structured job details and without server metadata', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users')) return [[{ opportunity_revision: 7 }], []];
      if (sql.includes('SELECT o.*')) return [[{
        id: 41, user_id: userId, public_id: 'opportunity-1', position: 0,
        title: 'Software Engineer', company: 'Acme', type: 'Internship', status: 'Applied',
        priority: 'High', url: 'https://example.test/job', deadline: '2026-11-15',
        follow_up_date: '', department: 'Engineering', team: 'Platform',
        workplace_type: 'Hybrid', employment_type: 'Full-time', posted_date: '2026-11-05',
        compensation_min: '15000.2500', compensation_max: '20000.0000',
        compensation_currency: 'EGP', compensation_interval: 'month',
        compensation: 'EGP 15,000–20,000 monthly', description: '', notes: '',
        archived_at: '2026-10-31 12:30:00.000', is_demo: 1, version: 9,
        created_at: '2026-10-20 10:00:00.000', updated_at: '2026-10-31 12:30:00.000',
      }], []];
      if (sql.includes('FROM opportunity_tags')) return [[{ opportunity_id: 41, tag: 'Remote' }], []];
      if (sql.includes('FROM opportunity_locations')) return [[
        { opportunity_id: 41, location: 'Cairo, Egypt', position: 0 },
        { opportunity_id: 41, location: 'Berlin, Germany', position: 1 },
      ], []];
      if (sql.includes('FROM activities')) return [[{
        opportunity_id: 41, public_id: 'activity-1', type: 'Application submitted',
        date: '2026-10-01', note: 'Applied.', position: 0,
      }], []];
      if (sql.includes('FROM contacts')) return [[{
        opportunity_id: 41, public_id: 'contact-1', name: 'Jordan Lee',
        role: 'Recruiter', email: 'jordan@example.test', phone: '', website: '', notes: '',
      }], []];
      if (sql.includes('FROM interviews')) return [[{
        opportunity_id: 41, public_id: 'interview-1', round: 'Recruiter Screen',
        date: '2026-11-02', time: '09:30:00', mode: 'Video', status: 'Scheduled',
        outcome: null, meeting_url: '', location: '', preparation_notes: '',
        notes: '', contact_public_id: 'contact-1',
      }], []];
      if (sql.includes('FROM materials')) return [[{
        opportunity_id: 41, public_id: 'material-1', label: 'Resume',
        kind: 'Resume', url: '', version: 'v1', status: 'Ready', notes: '',
      }], []];
      if (sql.includes('FROM tasks')) return [[{
        opportunity_id: 41, public_id: 'task-exported', title: 'Prepare for interview',
        notes: 'Review the role', priority: 'High', due_date: '2026-11-08',
        completed: 0, completed_on: null, position: 0,
      }], []];
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'export', undefined, 'GET');
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain('attachment');
      expect(body).toMatchObject({
        format: 'launchboard-backup', schemaVersion: 3,
        opportunities: [{
          id: 'opportunity-1', archivedAt: '2026-10-31T12:30:00.000Z', isDemo: true,
          tags: ['Remote'],
          locations: ['Cairo, Egypt', 'Berlin, Germany'],
          department: 'Engineering', team: 'Platform', workplaceType: 'Hybrid',
          employmentType: 'Full-time', postedDate: '2026-11-05',
          compensation: 'EGP 15,000–20,000 monthly',
          compensationDetails: {
            minAmount: '15000.25', maxAmount: '20000', currency: 'EGP', interval: 'month',
          },
          activities: [{ id: 'activity-1', date: '2026-10-01' }],
          contacts: [{ id: 'contact-1', name: 'Jordan Lee' }],
          interviews: [{ id: 'interview-1', contactId: 'contact-1', time: '09:30' }],
          materials: [{ id: 'material-1', version: 'v1' }],
          tasks: [{
            id: 'task-exported',
            title: 'Prepare for interview',
            notes: 'Review the role',
            priority: 'High',
            dueDate: '2026-11-08',
            completed: false,
            completedOn: '',
          }],
        }],
      });
      expect(body.exportedAt).toMatch(/Z$/);
      for (const key of ['version', 'createdAt', 'updatedAt', 'deletedAt', 'deletionBatchId']) {
        expect(body.opportunities[0]).not.toHaveProperty(key);
      }
    });
  });

  it('dry-runs merge with repairs, invalids, duplicates and existing IDs without writes', async () => {
    const repaired = { ...validOpportunity, id: 'new-1', priority: 'Urgent', deadline: '2026-02-30' };
    const duplicate = { ...validOpportunity, id: 'new-1' };
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 5 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[existingRow('existing-1', 4)], []];
      }
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'import', {
        mode: 'merge',
        backup: backupEnvelope([
          { ...validOpportunity, id: 'existing-1' }, repaired, null, duplicate,
        ]),
        dryRun: true,
      });
      const body = await response.json() as any;
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        mode: 'merge', dryRun: true, revision: 5, totalRecords: 4,
        validRecords: 2, repairedRecords: 1, invalidRecords: 1, duplicateRecords: 1,
        added: 1, skippedExisting: 1, replaced: 0, finalCount: 2,
      });
      expect(body.skipped.map((item: any) => item.index)).toEqual([0, 2, 3]);
      expect(connection.beginTransaction).toHaveBeenCalledOnce();
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT ') || String(sql).startsWith('UPDATE ') ||
        String(sql).startsWith('DELETE '),
      )).toBe(false);
    });
  });

  it('merges nested data atomically and appends after the current maximum position', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 2 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[existingRow('old-1', 6)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-11-01 10:00:00.000' }], []];
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 90 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      if (sql.includes('SELECT opportunity_revision FROM users')) return [[{ opportunity_revision: 3 }], []];
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const task = {
        id: 'task-imported',
        title: 'Send recruiter follow-up',
        notes: 'Include portfolio link',
        priority: 'High',
        dueDate: '2026-11-08',
        completed: false,
        completedOn: '',
      };
      const response = await request(baseUrl, 'import', {
        mode: 'merge',
        backup: backupEnvelope(
          [{
            ...validOpportunity,
            id: 'imported-1',
            locations: ['Cairo, Egypt', 'Berlin, Germany'],
            department: 'Engineering',
            team: 'Platform',
            workplaceType: 'Hybrid',
            employmentType: 'Full-time',
            postedDate: '2026-11-05',
            compensation: 'EGP 15,000–20,000 monthly',
            compensationDetails: {
              minAmount: '15000.25',
              maxAmount: '20000',
              currency: 'EGP',
              interval: 'month',
            },
            tasks: [task],
          }],
          { schemaVersion: 3 },
        ),
      });
      const body = await response.json() as any;
      const calls = connection.execute.mock.calls;
      const sql = calls.map(([statement]) => String(statement));
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        mode: 'merge', dryRun: false, revision: 3, totalRecords: 1,
        validRecords: 1, added: 1, skippedExisting: 0, finalCount: 2,
      });
      const parentInsert = calls.find(([statement]) => String(statement).includes('INSERT INTO opportunities'));
      expect(parentInsert?.[1]).toEqual([
        userId, 'imported-1', 7, 'Software Engineering Intern', 'Acme',
        'Internship', 'Applied', 'Medium', 'https://example.com/jobs/1',
        '2026-11-01', null, 'Engineering', 'Platform', 'Hybrid', 'Full-time',
        '2026-11-05', '15000.25', '20000', 'EGP', 'month',
        'EGP 15,000–20,000 monthly', '', '', null, 0,
        '2026-11-01 10:00:00.000', '2026-11-01 10:00:00.000',
      ]);
      expect(sql.findIndex((statement) => statement.includes('INSERT INTO contacts')))
        .toBeLessThan(sql.findIndex((statement) => statement.includes('INSERT INTO interviews')));
      const locationInserts = calls.filter(([statement]) => String(statement).includes('INSERT INTO opportunity_locations'));
      expect(locationInserts.map(([, params]) => params)).toEqual([
        [90, 0, 'Cairo, Egypt'],
        [90, 1, 'Berlin, Germany'],
      ]);
      for (const table of ['opportunity_locations', 'opportunity_tags', 'contacts', 'interviews', 'materials', 'activities', 'tasks']) {
        expect(sql.some((statement) => statement.includes('INSERT INTO ' + table))).toBe(true);
      }
      const taskInsert = calls.find(([statement]) => String(statement).includes('INSERT INTO tasks'));
      expect(taskInsert?.[1]).toEqual([
        90, 'task-imported', 0, 'Send recruiter follow-up',
        'Include portfolio link', 'High', '2026-11-08', 0, null,
      ]);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
    });
  });

  it('makes merge retries idempotent without changing the revision twice', async () => {
    let inserted = false;
    let revision = 4;
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: revision }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [inserted ? [existingRow('retry-safe', 0)] : [], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-11-01 10:00:00.000' }], []];
      if (sql.includes('INSERT INTO opportunities')) {
        inserted = true;
        return [{ affectedRows: 1, insertId: 93 }, []];
      }
      if (sql.includes('UPDATE users SET opportunity_revision')) {
        revision += 1;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SELECT opportunity_revision FROM users')) return [[{ opportunity_revision: revision }], []];
      return [{ affectedRows: 1 }, []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const backup = backupEnvelope([{ ...validOpportunity, id: 'retry-safe' }]);
      const first = await request(baseUrl, 'import', { mode: 'merge', backup });
      const firstBody = await first.json() as any;
      expect(first.status).toBe(200);
      expect(firstBody).toMatchObject({ revision: 5, added: 1, skippedExisting: 0, finalCount: 1 });

      connection.execute.mockClear();
      connection.beginTransaction.mockClear();
      connection.commit.mockClear();
      connection.rollback.mockClear();

      const second = await request(baseUrl, 'import', { mode: 'merge', backup });
      const secondBody = await second.json() as any;
      expect(second.status).toBe(200);
      expect(secondBody).toMatchObject({
        revision: 5, added: 0, skippedExisting: 1, finalCount: 1,
      });
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT ') || String(sql).startsWith('UPDATE ') ||
        String(sql).startsWith('DELETE '),
      )).toBe(false);
      expect(connection.commit).toHaveBeenCalledOnce();
    });
  });

  it('returns specific backup size and record-count limit errors before database access', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const tooLarge = await request(baseUrl, 'import', {
        mode: 'merge',
        backup: {
          format: 'launchboard-backup',
          schemaVersion: 1,
          opportunities: [],
          extra: 'x'.repeat(MAX_BACKUP_BYTES + 1),
        },
      });
      const tooLargeBody = await tooLarge.json() as any;
      expect(tooLarge.status).toBe(413);
      expect(tooLargeBody.error.code).toBe('PAYLOAD_TOO_LARGE');

      const tooMany = await request(baseUrl, 'import', {
        mode: 'merge',
        backup: backupEnvelope(Array.from({ length: MAX_BACKUP_RECORDS + 1 }, () => null)),
      });
      const tooManyBody = await tooMany.json() as any;
      expect(tooMany.status).toBe(422);
      expect(tooManyBody.error.code).toBe('INVALID_BACKUP');
      expect(tooManyBody.error.details).toEqual({ reason: 'too-many-records' });
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('dry-runs replace without deleting tombstones or changing the collection revision', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 9 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[
          existingRow('visible-1', 0),
          existingRow('deleted-1', 1, '2026-11-01 09:00:00.000'),
        ], []];
      }
      return [[], []];
    });

    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'import', {
        mode: 'replace',
        confirmReplace: true,
        expectedRevision: 9,
        dryRun: true,
        backup: backupEnvelope([{ ...validOpportunity, id: 'planned-1' }]),
      });
      const body = await response.json() as any;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        mode: 'replace',
        dryRun: true,
        revision: 9,
        added: 1,
        replaced: 1,
        finalCount: 1,
      });
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('INSERT ') ||
        String(sql).startsWith('UPDATE ') ||
        String(sql).startsWith('DELETE '),
      )).toBe(false);
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
    });
  });

  it('rejects replace with a stale revision before deleting existing records', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 9 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[existingRow('old-1', 0)], []];
      }
      return [[], []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'import', {
        mode: 'replace', confirmReplace: true, expectedRevision: 8,
        backup: backupEnvelope([{ ...validOpportunity, id: 'new-1' }]),
      });
      const body = await response.json() as any;
      expect(response.status).toBe(409);
      expect(body.error.code).toBe('STALE_REVISION');
      expect(body.error.details).toMatchObject({ expectedRevision: 8, currentRevision: 9 });
      expect(connection.execute.mock.calls.some(([sql]) =>
        String(sql).startsWith('DELETE ') || String(sql).startsWith('INSERT '),
      )).toBe(false);
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
    });
  });

  it('replaces the collection transactionally and removes tombstones in FK-safe order', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 9 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[existingRow('old-1', 0), existingRow('deleted-1', 1, '2026-11-01 09:00:00.000')], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-11-01 10:00:00.000' }], []];
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 91 }, []];
      if (sql.includes('UPDATE users SET opportunity_revision')) return [{ affectedRows: 1 }, []];
      if (sql.includes('SELECT opportunity_revision FROM users')) return [[{ opportunity_revision: 10 }], []];
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'import', {
        mode: 'replace', confirmReplace: true, expectedRevision: 9,
        backup: backupEnvelope([{ ...validOpportunity, id: 'replacement-1' }]),
      });
      const body = await response.json() as any;
      const sql = connection.execute.mock.calls.map(([statement]) => String(statement));
      expect(response.status).toBe(200);
      expect(body).toMatchObject({ mode: 'replace', revision: 10, replaced: 1, added: 1, finalCount: 1 });
      const orderedDeletes = [
        'DELETE FROM interviews', 'DELETE FROM tasks', 'DELETE FROM activities', 'DELETE FROM materials',
        'DELETE FROM contacts', 'DELETE FROM opportunity_tags', 'DELETE FROM opportunity_locations',
        'DELETE FROM opportunities', 'DELETE FROM opportunity_deletions',
      ].map((fragment) => sql.findIndex((statement) => statement.includes(fragment)));
      expect(orderedDeletes.every((index) => index >= 0)).toBe(true);
      expect(orderedDeletes).toEqual([...orderedDeletes].sort((a, b) => a - b));
      expect(connection.commit).toHaveBeenCalledOnce();
      expect(connection.rollback).not.toHaveBeenCalled();
    });
  });

  it('rolls back all replace writes when an imported nested insert fails', async () => {
    setHandler((sql) => {
      if (sql.includes('SELECT opportunity_revision FROM users') && sql.includes('FOR UPDATE')) {
        return [[{ opportunity_revision: 2 }], []];
      }
      if (sql.includes('SELECT id, public_id') && sql.includes('FROM opportunities')) {
        return [[existingRow('old-1', 0)], []];
      }
      if (sql.includes('SELECT UTC_TIMESTAMP(3)')) return [[{ now_utc: '2026-11-01 10:00:00.000' }], []];
      if (sql.includes('INSERT INTO opportunities')) return [{ affectedRows: 1, insertId: 92 }, []];
      if (sql.includes('INSERT INTO contacts')) {
        throw Object.assign(new Error('private child insert diagnostic'), { code: 'ER_DATA_TOO_LONG' });
      }
      return [{ affectedRows: 1 }, []];
    });
    await withTestServer(app(), async (baseUrl) => {
      const response = await request(baseUrl, 'import', {
        mode: 'replace', confirmReplace: true, expectedRevision: 2,
        backup: backupEnvelope([{ ...validOpportunity, id: 'replacement-1' }]),
      });
      const text = await response.text();
      expect(response.status).toBe(503);
      expect(text).not.toContain('private child insert diagnostic');
      expect(connection.rollback).toHaveBeenCalledOnce();
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledOnce();
    });
  });

  it('returns INVALID_BACKUP with invalid-json for malformed JSON', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const response = await fetch(baseUrl + '/api/opportunities/import', {
        method: 'POST', headers: headers(), body: '{"backup":',
      });
      const body = await response.json() as any;
      expect(response.status).toBe(422);
      expect(body.error.code).toBe('INVALID_BACKUP');
      expect(body.error.details).toEqual({ reason: 'invalid-json' });
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });

  it('reports unsupported schema and malformed envelopes as INVALID_BACKUP', async () => {
    await withTestServer(app(), async (baseUrl) => {
      const unsupported = await request(baseUrl, 'import', {
        mode: 'merge', backup: backupEnvelope([], { schemaVersion: 4 }),
      });
      const unsupportedBody = await unsupported.json() as any;
      expect(unsupported.status).toBe(422);
      expect(unsupportedBody.error.details).toEqual({ reason: 'unsupported-schema' });

      const malformed = await request(baseUrl, 'import', {
        mode: 'merge',
        backup: { format: 'not-launchboard', schemaVersion: 1, opportunities: [] },
      });
      const malformedBody = await malformed.json() as any;
      expect(malformed.status).toBe(422);
      expect(malformedBody.error.code).toBe('INVALID_BACKUP');
      expect(malformedBody.error.details).toEqual({ reason: 'invalid-envelope' });
      expect(pool.getConnection).not.toHaveBeenCalled();
    });
  });
});

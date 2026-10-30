import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from '../test/fixtures';
import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  createCsv,
  createJsonBackup,
} from './exports';

const HEADERS = [
  'ID',
  'Title',
  'Company',
  'Type',
  'Status',
  'Priority',
  'Tags',
  'Deadline',
  'Follow-up Date',
  'Compensation',
  'Application URL',
  'Description',
  'Notes',
  'Demo',
  'Activities (JSON)',
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-15T12:34:56.000Z'));
});

describe('createCsv', () => {
  it('writes a UTF-8 BOM, the existing header schema, and CRLF row separators', () => {
    const csv = createCsv([]);
    const header = HEADERS.map((value) => `"${value}"`).join(',');

    expect(csv).toBe(`\uFEFF${header}`);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).not.toContain('\r\n');
  });

  it('writes all values, including optional fields, in the existing column order', () => {
    const item = makeOpportunity({
      id: 'op,1',
      title: 'Frontend, "Intern"',
      company: 'Line\nBreak',
      tags: ['Remote', 'React'],
      description: '=SUM(A1)',
      isDemo: true,
    });

    const csv = createCsv([item]);
    const row = csv.split('\r\n')[1];

    expect(row).toBe(
      '"op,1","Frontend, ""Intern""","Line\nBreak","Internship","Applied","Medium","Remote, React","","","","","\'=SUM(A1)","","Yes","[]"',
    );
    expect(csv).toContain('\r\n');
    expect(csv.endsWith('\r\n')).toBe(false);
  });

  it('escapes commas, quotes and embedded line breaks through CSV quoting', () => {
    const item = makeOpportunity({
      title: 'Role, with "quotes"',
      company: 'First line\nSecond line',
      tags: ['One', 'Two'],
    });

    const row = createCsv([item]).split('\r\n')[1];

    expect(row).toContain('"Role, with ""quotes"""');
    expect(row).toContain('"First line\nSecond line"');
    expect(row).toContain('"One, Two"');
  });

  it('neutralizes values that spreadsheets may treat as formulas', () => {
    const item = makeOpportunity({
      title: '=1+1',
      company: '+1',
      compensation: '-5',
      description: '@command',
      notes: '\tTabbed',
    });

    const row = createCsv([item]).split('\r\n')[1];

    expect(row).toContain('"\'=1+1"');
    expect(row).toContain('"\'+1"');
    expect(row).toContain('"\'-5"');
    expect(row).toContain('"\'@command"');
    expect(row).toContain('"\'\tTabbed"');
  });

  it('serializes activities as JSON inside the final cell', () => {
    const item = makeOpportunity({
      activities: [
        makeActivity({
          id: 'activity-1',
          type: 'Interview scheduled',
          date: '2026-01-12',
          note: 'Technical screen',
        }),
      ],
    });

    const row = createCsv([item]).split('\r\n')[1];

    expect(row).toContain('""id"":""activity-1""');
    expect(row).toContain('""type"":""Interview scheduled""');
    expect(row).toContain('""date"":""2026-01-12""');
    expect(row).toContain('""note"":""Technical screen""');
  });

  it('uses empty quoted cells for empty optional values', () => {
    const row = createCsv([makeOpportunity()]).split('\r\n')[1];

    expect(row).toContain('"","","",""');
    expect(row.endsWith('"No","[]"')).toBe(true);
  });

  it('includes archived records without changing the CSV schema', () => {
    const csv = createCsv([
      makeOpportunity({ id: 'active', title: 'Active Role' }),
      makeOpportunity({
        id: 'archived',
        title: 'Archived Role',
        status: 'Interview',
        archivedAt: '2026-03-04T09:30:00.000Z',
      }),
    ]);
    const lines = csv.split('\r\n');

    expect(lines).toHaveLength(3);
    expect(lines[0].replace(/^\uFEFF/, '')).toBe(
      HEADERS.map((value) => `"${value}"`).join(','),
    );
    expect(lines[1]).toContain('"Active Role"');
    expect(lines[2]).toContain('"Archived Role"');
    expect(lines[2]).toContain('"Interview"');
  });

  it('keeps the existing CSV columns when workspace collections are present', () => {
    const item = makeOpportunity({
      interviews: [makeInterview({ round: 'Technical Interview' })],
      contacts: [makeContact({ name: 'Jordan Lee' })],
      materials: [makeMaterial({ label: 'Portfolio', kind: 'Portfolio' })],
    });

    expect(createCsv([item])).toBe(
      createCsv([{ ...item, interviews: [], contacts: [], materials: [] }]),
    );
  });
});

describe('createJsonBackup', () => {
  it('uses the existing backup format and schema version', () => {
    const items = [makeOpportunity(), makeOpportunity({ id: 'op-2', status: 'Interview' })];

    const backup = JSON.parse(createJsonBackup(items));

    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-01-15T12:34:56.000Z',
      opportunities: items,
    });
  });

  it('preserves archived records and the existing envelope in the JSON backup', () => {
    const archivedAt = '2026-03-04T09:30:00.000Z';
    const items = [
      makeOpportunity({ id: 'active' }),
      makeOpportunity({ id: 'archived', status: 'Interview', archivedAt }),
    ];

    const backup = JSON.parse(createJsonBackup(items));

    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup.opportunities).toEqual(items);
    expect(backup.opportunities[1].archivedAt).toBe(archivedAt);
    expect(backup.opportunities[1].status).toBe('Interview');
  });

  it('includes all workspace data in the canonical JSON backup', () => {
    const contact = makeContact({ id: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const interview = makeInterview({
      id: 'round-1',
      outcome: 'Positive',
      contactId: 'contact-1',
    });
    const items = [
      makeOpportunity({
        interviews: [interview],
        contacts: [contact],
        materials: [material],
      }),
    ];

    const backup = JSON.parse(createJsonBackup(items));

    expect(backup.opportunities[0].interviews).toEqual([interview]);
    expect(backup.opportunities[0].contacts).toEqual([contact]);
    expect(backup.opportunities[0].materials).toEqual([material]);
  });
});

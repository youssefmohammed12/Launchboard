import { describe, expect, it } from 'vitest';
import { makeActivity, makeOpportunity } from '../test/fixtures';
import { createCsv, createJsonBackup } from './exports';
import { parseImportFile } from './backup';

describe('parseImportFile CSV support', () => {
  it('imports a Launchboard CSV export, including escaped quotes, multiline cells and activity JSON', () => {
    const source = makeOpportunity({
      id: 'csv-1',
      title: 'Landing, "Page"',
      company: 'Horizon\nDigital',
      tags: ['React', 'Remote'],
      description: 'First line\nSecond line',
      activities: [makeActivity({ id: 'activity-csv', note: 'Sent portfolio' })],
    });

    const result = parseImportFile(createCsv([source]), 'launchboard-export.csv');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileType).toBe('csv');
    expect(result.backup.validRecords).toBe(1);
    expect(result.backup.records[0]).toMatchObject({
      id: 'csv-1',
      title: 'Landing, "Page"',
      company: 'Horizon\nDigital',
      tags: ['React', 'Remote'],
      description: 'First line\nSecond line',
      activities: [makeActivity({ id: 'activity-csv', note: 'Sent portfolio' })],
    });
    expect(result.envelope.format).toBe('launchboard-backup');
  });

  it('accepts a basic spreadsheet without IDs and supplies safe optional-field defaults', () => {
    const csv = [
      'Title,Company or client,Type,Status,Priority,Tags,Deadline,Follow-up Date,Application URL,Description',
      '"Frontend Engineer, Junior",Northwind Labs,Part-time,Saved,High,"React, Remote",2026-12-10,2026-12-04,https://example.com/jobs/1,"Build UI, test features"',
    ].join('\r\n');

    const result = parseImportFile(csv, 'opportunities.csv');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.validRecords).toBe(1);
    expect(result.backup.records[0]).toMatchObject({
      title: 'Frontend Engineer, Junior',
      company: 'Northwind Labs',
      type: 'Part-time',
      status: 'Saved',
      priority: 'High',
      tags: ['React', 'Remote'],
      deadline: '2026-12-10',
      followUpDate: '2026-12-04',
      url: 'https://example.com/jobs/1',
      description: 'Build UI, test features',
      activities: [],
      interviews: [],
      contacts: [],
      materials: [],
    });
    expect(result.backup.records[0].id.length).toBeGreaterThan(0);
  });

  it('round-trips structured job details through additive CSV columns', () => {
    const source = makeOpportunity({
      id: 'csv-job-details',
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
    });

    const result = parseImportFile(createCsv([source]), 'launchboard-export.csv');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.records[0]).toMatchObject({
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
    });
  });

  it('preserves valid JSON backups through the shared import entry point', () => {
    const source = makeOpportunity({ id: 'json-1' });
    const result = parseImportFile(createJsonBackup([source]), 'launchboard-backup.json');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fileType).toBe('json');
    expect(result.backup.records).toHaveLength(1);
    expect(result.envelope.opportunities[0].id).toBe('json-1');
  });

  it('rejects CSV files without the required Title and Company columns', () => {
    const result = parseImportFile('Name,Employer\nRole,Company', 'bad.csv');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-csv-header' },
    });
  });

  it('rejects malformed quoted fields rather than importing ambiguous data', () => {
    const result = parseImportFile('Title,Company\n"Open title,Company', 'bad.csv');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-csv' },
    });
  });

  it('rejects malformed nested JSON cells instead of silently dropping activity data', () => {
    const result = parseImportFile(
      'Title,Company,Activities (JSON)\nRole,Northwind,"not json"',
      'bad.csv',
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-csv-row' },
    });
    if (!result.ok) expect(result.error.message).toContain('Record 1');
  });

  it('reports rows with extra columns clearly', () => {
    const result = parseImportFile('Title,Company\nRole,Northwind,Unexpected', 'bad.csv');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid-csv-row' },
    });
  });
});

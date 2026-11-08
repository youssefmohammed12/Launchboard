import { normalizeOpportunityJobDetails, type LaunchboardBackup } from '@launchboard/domain';
import type { Opportunity } from '../types/opportunity';
import { createId } from './id';

export type CsvImportErrorCode = 'invalid-csv' | 'invalid-csv-header' | 'invalid-csv-row';

export interface CsvImportError {
  code: CsvImportErrorCode;
  message: string;
}

export type CsvImportResult =
  | { ok: true; backup: LaunchboardBackup }
  | { ok: false; error: CsvImportError };

function parseRows(input: string): { rows: string[][] } | { error: string } {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  const pushField = () => {
    row.push(field);
    field = '';
    closedQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (closedQuote) {
      if (char === ',') {
        pushField();
        continue;
      }
      if (char === '\n' || char === '\r') {
        if (char === '\r' && text[index + 1] === '\n') index += 1;
        pushRow();
        continue;
      }
      if (/\s/.test(char)) continue;
      return { error: 'Unexpected text after a quoted CSV field.' };
    }

    if (char === '"') {
      if (field.length > 0) return { error: 'A quoted CSV field must start with a quote.' };
      quoted = true;
    } else if (char === ',') {
      pushField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      field += char;
    }
  }

  if (quoted) return { error: 'The CSV file contains an unclosed quoted field.' };
  if (field.length > 0 || row.length > 0 || closedQuote) pushRow();
  return { rows };
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function headerIndex(headers: Map<string, number>, ...names: string[]): number {
  for (const name of names) {
    const index = headers.get(name);
    if (index !== undefined) return index;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  return index < 0 ? '' : (row[index] ?? '').trim();
}

function jsonArrayCell(
  row: string[],
  headers: Map<string, number>,
  names: string[],
  recordNumber: number,
  label: string,
): unknown[] | CsvImportError {
  const raw = cell(row, headerIndex(headers, ...names));
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('Expected an array.');
    return value;
  } catch {
    return {
      code: 'invalid-csv-row',
      message: `Record ${recordNumber}: the ${label} column must contain a valid JSON array.`,
    };
  }
}

/**
 * Converts a spreadsheet CSV into the shared version-1 backup envelope.
 * CSV is intentionally a tabular import; JSON remains the full-fidelity format.
 * The parser supports RFC-4180-style quotes, escaped quotes and multiline cells.
 */
export function parseOpportunityCsv(input: string): CsvImportResult {
  const parsed = parseRows(input);
  if ('error' in parsed) {
    return { ok: false, error: { code: 'invalid-csv', message: parsed.error } };
  }

  const [rawHeaders, ...rawRows] = parsed.rows;
  if (!rawHeaders || rawHeaders.length === 0) {
    return {
      ok: false,
      error: { code: 'invalid-csv-header', message: 'The CSV file is empty or has no header row.' },
    };
  }

  const headers = new Map<string, number>();
  rawHeaders.forEach((raw, index) => {
    const normalized = normalizeHeader(raw);
    if (normalized && !headers.has(normalized)) headers.set(normalized, index);
  });

  const titleIndex = headerIndex(headers, 'title', 'opportunity title');
  const companyIndex = headerIndex(headers, 'company', 'company or client', 'client');
  if (titleIndex < 0 || companyIndex < 0) {
    return {
      ok: false,
      error: {
        code: 'invalid-csv-header',
        message: 'The CSV needs Title and Company columns (Company or client is also accepted).',
      },
    };
  }

  const opportunities: Opportunity[] = [];
  for (let index = 0; index < rawRows.length; index += 1) {
    const row = rawRows[index];
    if (row.length > rawHeaders.length) {
      return {
        ok: false,
        error: {
          code: 'invalid-csv-row',
          message: `Record ${index + 1}: this row has more columns than the header.`,
        },
      };
    }

    const recordNumber = index + 1;
    const activities = jsonArrayCell(
      row, headers, ['activities (json)', 'activities'], recordNumber, 'Activities',
    );
    if (!Array.isArray(activities)) return { ok: false, error: activities };

    const interviews = jsonArrayCell(
      row, headers, ['interviews (json)', 'interviews'], recordNumber, 'Interviews',
    );
    if (!Array.isArray(interviews)) return { ok: false, error: interviews };

    const contacts = jsonArrayCell(
      row, headers, ['contacts (json)', 'contacts'], recordNumber, 'Contacts',
    );
    if (!Array.isArray(contacts)) return { ok: false, error: contacts };

    const materials = jsonArrayCell(
      row, headers, ['materials (json)', 'materials'], recordNumber, 'Materials',
    );
    if (!Array.isArray(materials)) return { ok: false, error: materials };

    // Preserve non-empty unrecognized enum values so the shared backup
    // normalizer marks those rows invalid instead of silently changing them.
    const type = (
      cell(row, headerIndex(headers, 'type', 'opportunity type')) || 'Internship'
    ) as Opportunity['type'];
    const status = (
      cell(row, headerIndex(headers, 'status', 'application status')) || 'Saved'
    ) as Opportunity['status'];
    const priority = (
      cell(row, headerIndex(headers, 'priority')) || 'Medium'
    ) as Opportunity['priority'];
    const tags = cell(row, headerIndex(headers, 'tags'))
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const demoValue = cell(row, headerIndex(headers, 'demo', 'is demo')).toLowerCase();
    const archivedAt = cell(row, headerIndex(headers, 'archived at'));

    const rawLocations = cell(row, headerIndex(headers, 'locations (json)', 'locations'));
    let locations: unknown[] = [];
    if (rawLocations) {
      if (rawLocations.startsWith('[')) {
        try {
          const parsedLocations: unknown = JSON.parse(rawLocations);
          if (Array.isArray(parsedLocations)) locations = parsedLocations;
        } catch {
          return {
            ok: false,
            error: {
              code: 'invalid-csv-row',
              message: `Record ${recordNumber}: the Locations (JSON) column must contain a valid JSON array.`,
            },
          };
        }
      } else {
        locations = rawLocations.split(/\r?\n|\s*;\s*/u);
      }
    }
    const minAmount = cell(row, headerIndex(headers, 'compensation min', 'salary min'));
    const maxAmount = cell(row, headerIndex(headers, 'compensation max', 'salary max'));
    const currency = cell(row, headerIndex(headers, 'compensation currency', 'salary currency'));
    const interval = cell(row, headerIndex(headers, 'compensation interval', 'salary interval'));
    const jobDetails = normalizeOpportunityJobDetails({
      locations,
      department: cell(row, headerIndex(headers, 'department')),
      team: cell(row, headerIndex(headers, 'team')),
      workplaceType: cell(row, headerIndex(headers, 'workplace type')),
      employmentType: cell(row, headerIndex(headers, 'employment type')),
      postedDate: cell(row, headerIndex(headers, 'posted date', 'publication date')),
      compensationDetails: minAmount || maxAmount || currency || interval
        ? { minAmount, maxAmount, currency, interval }
        : null,
    });
    const {
      repaired: _repaired,
      ...normalizedJobDetails
    } = jobDetails;

    opportunities.push({
      id: cell(row, headerIndex(headers, 'id')) || createId(),
      title: cell(row, titleIndex),
      company: cell(row, companyIndex),
      type,
      status,
      priority,
      tags,
      url: cell(row, headerIndex(headers, 'application url', 'url')),
      deadline: cell(row, headerIndex(headers, 'deadline')),
      followUpDate: cell(row, headerIndex(headers, 'follow-up date', 'follow up date')),
      ...normalizedJobDetails,
      compensation: cell(row, headerIndex(headers, 'compensation')),
      description: cell(row, headerIndex(headers, 'description')),
      notes: cell(row, headerIndex(headers, 'notes', 'personal notes')),
      isDemo: ['yes', 'true', '1'].includes(demoValue),
      ...(archivedAt ? { archivedAt } : {}),
      activities: activities as Opportunity['activities'],
      interviews: interviews as Opportunity['interviews'],
      contacts: contacts as Opportunity['contacts'],
      materials: materials as Opportunity['materials'],
      tasks: [],
    });
  }

  return {
    ok: true,
    backup: {
      format: 'launchboard-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      opportunities,
    },
  };
}

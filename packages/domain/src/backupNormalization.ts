import {
  ACTIVITY_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  type ActivityEntry,
  type ContactEntry,
  type InterviewEntry,
  type MaterialEntry,
  type Opportunity,
} from './opportunity.js';
import { BACKUP_SCHEMA_VERSION } from './backup.js';
import { normalizeTaskList } from './tasks.js';
import { normalizeOpportunityJobDetails } from './jobDetails.js';
import {
  MAX_CONTACTS,
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  MAX_CONTACT_WEBSITE_LENGTH,
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_INTERVIEW_URL_LENGTH,
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_URL_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
  MAX_TAGS,
} from './limits.js';
import { isValidISODate } from './dates.js';
import { isValidContactEmail, isValidInterviewTime, isValidUrl } from './validation.js';
import { normalizeTagList } from './tags.js';

export type BackupRecordFailure =
  | 'not-an-object'
  | 'missing-id'
  | 'invalid-id'
  | 'missing-title'
  | 'missing-company'
  | 'invalid-type'
  | 'invalid-status';

export interface NormalizedBackupRecord {
  opportunity: Opportunity | null;
  repaired: boolean;
  failure: BackupRecordFailure | null;
}

const MAX_PUBLIC_ID_LENGTH = 128;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] as string : '';
}

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function normalizeArchivedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));

  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(Date.parse(value))
  ) {
    return undefined;
  }
  return value;
}

function normalizeActivities(value: unknown): ActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const result: ActivityEntry[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    const entry = asRecord(raw);
    if (!entry || typeof entry.id !== 'string' || !entry.id ||
      entry.id.length > MAX_PUBLIC_ID_LENGTH ||
      !includes(ACTIVITY_TYPES, entry.type) ||
      typeof entry.date !== 'string' || !isValidISODate(entry.date) ||
      seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    result.push({
      id: entry.id,
      type: entry.type,
      date: entry.date,
      note: typeof entry.note === 'string' ? entry.note : '',
    });
  }
  return result;
}

function normalizeContacts(value: unknown): ContactEntry[] {
  if (!Array.isArray(value)) return [];
  const result: ContactEntry[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (result.length >= MAX_CONTACTS) break;
    const entry = asRecord(raw);
    if (!entry || typeof entry.id !== 'string' || !entry.id ||
      entry.id.length > MAX_PUBLIC_ID_LENGTH || seen.has(entry.id)) continue;
    const name = limitedText(entry.name, MAX_CONTACT_NAME_LENGTH);
    if (!name) continue;
    seen.add(entry.id);

    const emailCandidate = limitedText(entry.email, MAX_CONTACT_EMAIL_LENGTH);
    const websiteCandidate = limitedText(entry.website, MAX_CONTACT_WEBSITE_LENGTH);
    result.push({
      id: entry.id,
      name,
      role: limitedText(entry.role, MAX_CONTACT_ROLE_LENGTH),
      email: emailCandidate && isValidContactEmail(emailCandidate) ? emailCandidate : '',
      phone: limitedText(entry.phone, MAX_CONTACT_PHONE_LENGTH),
      website: websiteCandidate && isValidUrl(websiteCandidate) ? websiteCandidate : '',
      notes: limitedText(entry.notes, MAX_CONTACT_NOTES_LENGTH),
    });
  }
  return result;
}

function normalizeInterviews(value: unknown): InterviewEntry[] {
  if (!Array.isArray(value)) return [];
  const result: InterviewEntry[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (result.length >= MAX_INTERVIEWS) break;
    const entry = asRecord(raw);
    if (!entry || typeof entry.id !== 'string' || !entry.id ||
      entry.id.length > MAX_PUBLIC_ID_LENGTH || seen.has(entry.id)) continue;
    const round = limitedText(entry.round, MAX_INTERVIEW_ROUND_LENGTH);
    if (!round || typeof entry.date !== 'string' || !isValidISODate(entry.date)) continue;
    seen.add(entry.id);

    const timeCandidate = limitedText(entry.time, 32);
    const urlCandidate = limitedText(entry.meetingUrl, MAX_INTERVIEW_URL_LENGTH);
    result.push({
      id: entry.id,
      round,
      date: entry.date,
      time: timeCandidate && isValidInterviewTime(timeCandidate) ? timeCandidate : '',
      mode: includes(INTERVIEW_MODES, entry.mode) ? entry.mode : 'Other',
      status: includes(INTERVIEW_STATUSES, entry.status) ? entry.status : 'Scheduled',
      outcome: includes(INTERVIEW_OUTCOMES, entry.outcome) ? entry.outcome : '',
      meetingUrl: urlCandidate && isValidUrl(urlCandidate) ? urlCandidate : '',
      location: limitedText(entry.location, MAX_INTERVIEW_LOCATION_LENGTH),
      preparationNotes: limitedText(entry.preparationNotes, MAX_INTERVIEW_NOTES_LENGTH),
      notes: limitedText(entry.notes, MAX_INTERVIEW_NOTES_LENGTH),
      contactId: limitedText(entry.contactId, MAX_INTERVIEW_CONTACT_ID_LENGTH),
    });
  }
  return result;
}

function normalizeMaterials(value: unknown): MaterialEntry[] {
  if (!Array.isArray(value)) return [];
  const result: MaterialEntry[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (result.length >= MAX_MATERIALS) break;
    const entry = asRecord(raw);
    if (!entry || typeof entry.id !== 'string' || !entry.id ||
      entry.id.length > MAX_PUBLIC_ID_LENGTH || seen.has(entry.id)) continue;
    const label = limitedText(entry.label, MAX_MATERIAL_LABEL_LENGTH);
    if (!label) continue;
    seen.add(entry.id);

    const urlCandidate = limitedText(entry.url, MAX_MATERIAL_URL_LENGTH);
    result.push({
      id: entry.id,
      label,
      kind: includes(MATERIAL_KINDS, entry.kind) ? entry.kind : 'Other',
      url: urlCandidate && isValidUrl(urlCandidate) ? urlCandidate : '',
      version: limitedText(entry.version, MAX_MATERIAL_VERSION_LENGTH),
      status: includes(MATERIAL_STATUSES, entry.status) ? entry.status : 'Draft',
      notes: limitedText(entry.notes, MAX_MATERIAL_NOTES_LENGTH),
    });
  }
  return result;
}

function sameTags(raw: unknown, normalized: string[]): boolean {
  return Array.isArray(raw) && raw.length === normalized.length &&
    raw.every((value, index) => value === normalized[index]);
}

function sameActivities(raw: unknown, normalized: ActivityEntry[]): boolean {
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return normalized.every((entry, index) => {
    const candidate = asRecord(raw[index]);
    if (!candidate || candidate.id !== entry.id ||
      candidate.type !== entry.type || candidate.date !== entry.date) return false;
    if (candidate.note !== undefined && typeof candidate.note !== 'string') return false;
    return (candidate.note ?? '') === entry.note;
  });
}

function sameContacts(raw: unknown, normalized: ContactEntry[]): boolean {
  if (raw === undefined && normalized.length === 0) return true;
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return normalized.every((entry, index) => {
    const candidate = asRecord(raw[index]);
    return candidate !== null &&
      candidate.id === entry.id &&
      candidate.name === entry.name &&
      (candidate.role ?? '') === entry.role &&
      (candidate.email ?? '') === entry.email &&
      (candidate.phone ?? '') === entry.phone &&
      (candidate.website ?? '') === entry.website &&
      (candidate.notes ?? '') === entry.notes;
  });
}

function sameInterviews(raw: unknown, normalized: InterviewEntry[]): boolean {
  if (raw === undefined && normalized.length === 0) return true;
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return normalized.every((entry, index) => {
    const candidate = asRecord(raw[index]);
    return candidate !== null &&
      candidate.id === entry.id &&
      candidate.round === entry.round &&
      candidate.date === entry.date &&
      (candidate.time ?? '') === entry.time &&
      candidate.mode === entry.mode &&
      candidate.status === entry.status &&
      (candidate.outcome ?? '') === entry.outcome &&
      (candidate.meetingUrl ?? '') === entry.meetingUrl &&
      (candidate.location ?? '') === entry.location &&
      (candidate.preparationNotes ?? '') === entry.preparationNotes &&
      (candidate.notes ?? '') === entry.notes &&
      (candidate.contactId ?? '') === entry.contactId;
  });
}

function sameMaterials(raw: unknown, normalized: MaterialEntry[]): boolean {
  if (raw === undefined && normalized.length === 0) return true;
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return normalized.every((entry, index) => {
    const candidate = asRecord(raw[index]);
    return candidate !== null &&
      candidate.id === entry.id &&
      candidate.label === entry.label &&
      candidate.kind === entry.kind &&
      (candidate.url ?? '') === entry.url &&
      (candidate.version ?? '') === entry.version &&
      candidate.status === entry.status &&
      (candidate.notes ?? '') === entry.notes;
  });
}

/**
 * Applies the shared server-safe repair policy for versioned backup records.
 * It mirrors the browser importer's field-repair rules while enforcing database
 * public-ID bounds and first-wins child IDs. The Stage 10 browser adapter will
 * consume this helper so both import paths use one implementation. Required
 * parent identity/title/type fields cannot be safely invented; malformed child
 * entries and optional fields are repaired independently so valid siblings survive.
 */
export function normalizeBackupOpportunityRecord(
  value: unknown,
  schemaVersion: number = BACKUP_SCHEMA_VERSION,
): NormalizedBackupRecord {
  const record = asRecord(value);
  if (!record) return { opportunity: null, repaired: false, failure: 'not-an-object' };

  const id = typeof record.id === 'string' && record.id ? record.id : null;
  const title = text(record, 'title');
  const company = text(record, 'company');
  const type = OPPORTUNITY_TYPES.find((candidate) => candidate === record.type);
  const status = OPPORTUNITY_STATUSES.find((candidate) => candidate === record.status);

  if (!id) return { opportunity: null, repaired: false, failure: 'missing-id' };
  if (id.length > MAX_PUBLIC_ID_LENGTH) {
    return { opportunity: null, repaired: false, failure: 'invalid-id' };
  }
  if (!title.trim()) return { opportunity: null, repaired: false, failure: 'missing-title' };
  if (!company.trim()) return { opportunity: null, repaired: false, failure: 'missing-company' };
  if (!type) return { opportunity: null, repaired: false, failure: 'invalid-type' };
  if (!status) return { opportunity: null, repaired: false, failure: 'invalid-status' };

  const priority = includes(PRIORITIES, record.priority) ? record.priority : 'Medium';
  const tags = (Array.isArray(record.tags) ? normalizeTagList(record.tags) : []).slice(0, MAX_TAGS);
  const url = text(record, 'url');
  const deadlineValue = text(record, 'deadline');
  const followUpValue = text(record, 'followUpDate');
  const deadline = isValidISODate(deadlineValue) ? deadlineValue : '';
  const followUpDate = isValidISODate(followUpValue) ? followUpValue : '';
  const activities = normalizeActivities(record.activities);
  const contacts = normalizeContacts(record.contacts);
  const materials = normalizeMaterials(record.materials);
  // Version 1 predates tasks and must never import an unversioned task field.
  const normalizedTasks = normalizeTaskList(
    schemaVersion === 1 ? undefined : record.tasks,
  );
  const availableContactIds = new Set(contacts.map((contact) => contact.id));
  const interviews = normalizeInterviews(record.interviews).map((interview) =>
    interview.contactId && !availableContactIds.has(interview.contactId)
      ? { ...interview, contactId: '' }
      : interview,
  );
  const { repaired: jobDetailsRepaired, ...normalizedJobDetails } = normalizeOpportunityJobDetails(record);
  const compensation = text(record, 'compensation');
  const description = text(record, 'description');
  const notes = text(record, 'notes');
  const archivedAt = normalizeArchivedAt(record.archivedAt);
  const isDemo = record.isDemo === true;

  const repaired =
    record.priority !== priority ||
    !sameTags(record.tags, tags) ||
    record.url !== url ||
    record.deadline !== deadline ||
    record.followUpDate !== followUpDate ||
    !sameActivities(record.activities, activities) ||
    !sameInterviews(record.interviews, interviews) ||
    !sameContacts(record.contacts, contacts) ||
    !sameMaterials(record.materials, materials) ||
    normalizedTasks.repaired ||
    jobDetailsRepaired ||
    (schemaVersion === 1 &&
      record.tasks !== undefined &&
      (!Array.isArray(record.tasks) || record.tasks.length > 0)) ||
    (schemaVersion !== 1 && record.tasks === undefined) ||
    record.compensation !== compensation ||
    record.description !== description ||
    record.notes !== notes ||
    record.archivedAt !== archivedAt ||
    (record.isDemo !== undefined && record.isDemo !== true && record.isDemo !== false);

  return {
    opportunity: {
      id,
      title,
      company,
      type,
      status,
      priority,
      tags,
      url,
      deadline,
      followUpDate,
      activities,
      interviews,
      contacts,
      materials,
      tasks: normalizedTasks.tasks,
      ...normalizedJobDetails,
      compensation,
      description,
      notes,
      ...(archivedAt ? { archivedAt } : {}),
      ...(isDemo ? { isDemo: true } : {}),
    },
    repaired,
    failure: null,
  };
}

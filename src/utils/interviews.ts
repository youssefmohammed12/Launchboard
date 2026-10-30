import {
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  type InterviewDraft,
  type InterviewEntry,
  type InterviewMode,
  type InterviewOutcome,
  type InterviewStatus,
} from '../types/opportunity';
import {
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_INTERVIEW_URL_LENGTH,
  isValidInterviewTime,
} from '@launchboard/domain';
import { isValidISODate } from './dates';
import { isValidUrl } from './opportunities';

export {
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_INTERVIEW_URL_LENGTH,
  isValidInterviewTime,
} from '@launchboard/domain';

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function knownMode(value: unknown): InterviewMode {
  return INTERVIEW_MODES.find((mode) => mode === value) ?? 'Other';
}

function knownStatus(value: unknown): InterviewStatus {
  return INTERVIEW_STATUSES.find((status) => status === value) ?? 'Scheduled';
}

function knownOutcome(value: unknown): InterviewOutcome | '' {
  return INTERVIEW_OUTCOMES.find((outcome) => outcome === value) ?? '';
}

function normalizedTime(value: unknown): string {
  if (typeof value !== 'string') return '';
  const time = value.trim();
  return time && isValidInterviewTime(time) ? time : '';
}

function normalizedUrl(value: unknown): string {
  const candidate = limitedText(value, MAX_INTERVIEW_URL_LENGTH);
  return candidate && isValidUrl(candidate) ? candidate : '';
}

/**
 * Repairs interviews read from storage or a backup. Each child is normalized
 * independently; a malformed interview is dropped without discarding its valid
 * parent or siblings.
 *
 * A round and a real calendar date are required. Invalid optional values use
 * safe defaults: empty time/link, "Other" mode, "Scheduled" status and no
 * outcome. IDs are preserved, and the first valid interview wins when the same
 * ID appears more than once in one opportunity.
 */
export function normalizeStoredInterviews(value: unknown): InterviewEntry[] {
  if (!Array.isArray(value)) return [];

  const interviews: InterviewEntry[] = [];
  const seenIds = new Set<string>();

  for (const raw of value) {
    if (interviews.length >= MAX_INTERVIEWS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.id !== 'string' || !entry.id) continue;
    const round = limitedText(entry.round, MAX_INTERVIEW_ROUND_LENGTH);
    if (!round) continue;
    if (typeof entry.date !== 'string' || !isValidISODate(entry.date)) continue;
    if (seenIds.has(entry.id)) continue;

    seenIds.add(entry.id);
    interviews.push({
      id: entry.id,
      round,
      date: entry.date,
      time: normalizedTime(entry.time),
      mode: knownMode(entry.mode),
      status: knownStatus(entry.status),
      outcome: knownOutcome(entry.outcome),
      meetingUrl: normalizedUrl(entry.meetingUrl),
      location: limitedText(entry.location, MAX_INTERVIEW_LOCATION_LENGTH),
      preparationNotes: limitedText(entry.preparationNotes, MAX_INTERVIEW_NOTES_LENGTH),
      notes: limitedText(entry.notes, MAX_INTERVIEW_NOTES_LENGTH),
      contactId: limitedText(entry.contactId, MAX_INTERVIEW_CONTACT_ID_LENGTH),
    });
  }

  return interviews;
}

/**
 * Reports whether stored interviews already match their normalized form. A
 * missing collection is accepted as the canonical empty collection so legacy
 * records are not reported as repaired solely because interviews are new.
 */
export function sameStoredInterviews(value: unknown, normalized: InterviewEntry[]): boolean {
  if (value === undefined && normalized.length === 0) return true;
  if (!Array.isArray(value) || value.length !== normalized.length) return false;

  return normalized.every((entry, index) => {
    const raw = value[index];
    if (typeof raw !== 'object' || raw === null) return false;
    const candidate = raw as Record<string, unknown>;
    return (
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
      (candidate.contactId ?? '') === entry.contactId
    );
  });
}

/** Produces a trimmed, length-limited draft with canonical enum values. */
export function cleanInterviewDraft(data: InterviewDraft): InterviewDraft {
  return {
    round: data.round.trim().slice(0, MAX_INTERVIEW_ROUND_LENGTH),
    date: data.date,
    time: data.time.trim(),
    mode: knownMode(data.mode),
    status: knownStatus(data.status),
    outcome: knownOutcome(data.outcome),
    meetingUrl: data.meetingUrl.trim().slice(0, MAX_INTERVIEW_URL_LENGTH),
    location: data.location.trim().slice(0, MAX_INTERVIEW_LOCATION_LENGTH),
    preparationNotes: data.preparationNotes.trim().slice(0, MAX_INTERVIEW_NOTES_LENGTH),
    notes: data.notes.trim().slice(0, MAX_INTERVIEW_NOTES_LENGTH),
    contactId: data.contactId.trim().slice(0, MAX_INTERVIEW_CONTACT_ID_LENGTH),
  };
}

export type InterviewFormErrors = Partial<Record<keyof InterviewDraft, string>>;

/** Inline form validation; storage normalization applies the same limits. */
export function validateInterviewDraft(data: InterviewDraft): InterviewFormErrors {
  const errors: InterviewFormErrors = {};
  const round = data.round.trim();
  const time = data.time.trim();
  const meetingUrl = data.meetingUrl.trim();

  if (!round) {
    errors.round = 'Enter a round or name.';
  } else if (round.length > MAX_INTERVIEW_ROUND_LENGTH) {
    errors.round = `Round or name must be ${MAX_INTERVIEW_ROUND_LENGTH} characters or fewer.`;
  }

  if (!isValidISODate(data.date)) {
    errors.date = 'Enter a valid interview date.';
  }

  if (time && !isValidInterviewTime(time)) {
    errors.time = 'Enter a valid 24-hour time (HH:mm).';
  }

  if (meetingUrl && meetingUrl.length > MAX_INTERVIEW_URL_LENGTH) {
    errors.meetingUrl = `Meeting URL must be ${MAX_INTERVIEW_URL_LENGTH} characters or fewer.`;
  } else if (meetingUrl && !isValidUrl(meetingUrl)) {
    errors.meetingUrl = 'Enter a valid URL starting with http:// or https://.';
  }

  if (data.location.trim().length > MAX_INTERVIEW_LOCATION_LENGTH) {
    errors.location = `Location must be ${MAX_INTERVIEW_LOCATION_LENGTH} characters or fewer.`;
  }
  if (data.preparationNotes.length > MAX_INTERVIEW_NOTES_LENGTH) {
    errors.preparationNotes = `Preparation notes must be ${MAX_INTERVIEW_NOTES_LENGTH} characters or fewer.`;
  }
  if (data.notes.length > MAX_INTERVIEW_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_INTERVIEW_NOTES_LENGTH} characters or fewer.`;
  }
  if (data.contactId.length > MAX_INTERVIEW_CONTACT_ID_LENGTH) {
    errors.contactId = `Contact reference must be ${MAX_INTERVIEW_CONTACT_ID_LENGTH} characters or fewer.`;
  }

  return errors;
}

function entryFromDraft(draft: InterviewDraft, id: string): InterviewEntry {
  return { ...cleanInterviewDraft(draft), id };
}

/** Appends a new interview without mutating the existing collection. */
export function addInterview(
  interviews: InterviewEntry[],
  draft: InterviewDraft,
  id: string,
): InterviewEntry[] {
  if (interviews.length >= MAX_INTERVIEWS) return [...interviews];
  return [...interviews, entryFromDraft(draft, id)];
}

/**
 * Replaces one interview's editable fields while preserving its stable ID.
 * Other interviews and the input array are untouched.
 */
export function updateInterview(
  interviews: InterviewEntry[],
  id: string,
  draft: InterviewDraft,
): InterviewEntry[] {
  return interviews.map((entry) =>
    entry.id === id ? { ...entryFromDraft(draft, entry.id), id: entry.id } : entry,
  );
}

/** Removes one interview by ID, returning a new array. */
export function removeInterview(interviews: InterviewEntry[], id: string): InterviewEntry[] {
  return interviews.filter((entry) => entry.id !== id);
}

/** Changes only an interview's status, preserving its outcome and history. */
export function setInterviewStatus(
  interviews: InterviewEntry[],
  id: string,
  status: InterviewStatus,
): InterviewEntry[] {
  return interviews.map((entry) => (entry.id === id ? { ...entry, status } : entry));
}

/** Records or clears an interview's outcome without changing its status. */
export function setInterviewOutcome(
  interviews: InterviewEntry[],
  id: string,
  outcome: InterviewOutcome | '',
): InterviewEntry[] {
  return interviews.map((entry) => (entry.id === id ? { ...entry, outcome } : entry));
}

/**
 * Chronological by date and time, with untimed entries after timed entries on
 * the same day and insertion order as the final tie-breaker.
 */
export function sortInterviews(interviews: InterviewEntry[]): InterviewEntry[] {
  return interviews
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const byDate = a.entry.date.localeCompare(b.entry.date);
      if (byDate !== 0) return byDate;
      const aTime = a.entry.time || '99:99';
      const bTime = b.entry.time || '99:99';
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

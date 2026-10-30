import type {
  ContactDraft,
  ContactEntry,
  InterviewEntry,
} from '../types/opportunity';
import {
  MAX_CONTACTS,
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  MAX_CONTACT_WEBSITE_LENGTH,
  isValidContactEmail,
} from '@launchboard/domain';
import { isValidUrl } from './opportunities';

export {
  MAX_CONTACTS,
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  MAX_CONTACT_WEBSITE_LENGTH,
  isValidContactEmail,
} from '@launchboard/domain';

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizedEmail(value: unknown): string {
  const email = limitedText(value, MAX_CONTACT_EMAIL_LENGTH);
  return email && isValidContactEmail(email) ? email : '';
}

function normalizedWebsite(value: unknown): string {
  const website = limitedText(value, MAX_CONTACT_WEBSITE_LENGTH);
  return website && isValidUrl(website) ? website : '';
}

/**
 * Repairs contacts read from storage or a backup. Each child is normalized
 * independently; a malformed contact is dropped without discarding its valid
 * parent or siblings.
 *
 * A name is required. Invalid optional emails and URLs become empty values so
 * the rest of the contact survives; phones accept any practical international
 * format and are only trimmed/length-limited. IDs are preserved, and the first
 * valid contact wins when the same ID appears more than once.
 */
export function normalizeStoredContacts(value: unknown): ContactEntry[] {
  if (!Array.isArray(value)) return [];

  const contacts: ContactEntry[] = [];
  const seenIds = new Set<string>();

  for (const raw of value) {
    if (contacts.length >= MAX_CONTACTS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.id !== 'string' || !entry.id) continue;
    const name = limitedText(entry.name, MAX_CONTACT_NAME_LENGTH);
    if (!name) continue;
    if (seenIds.has(entry.id)) continue;

    seenIds.add(entry.id);
    contacts.push({
      id: entry.id,
      name,
      role: limitedText(entry.role, MAX_CONTACT_ROLE_LENGTH),
      email: normalizedEmail(entry.email),
      phone: limitedText(entry.phone, MAX_CONTACT_PHONE_LENGTH),
      website: normalizedWebsite(entry.website),
      notes: limitedText(entry.notes, MAX_CONTACT_NOTES_LENGTH),
    });
  }

  return contacts;
}

/**
 * Reports whether stored contacts already match their normalized form. A
 * missing collection is accepted as the canonical empty collection so legacy
 * records are not reported as repaired solely because contacts are new.
 */
export function sameStoredContacts(value: unknown, normalized: ContactEntry[]): boolean {
  if (value === undefined && normalized.length === 0) return true;
  if (!Array.isArray(value) || value.length !== normalized.length) return false;

  return normalized.every((entry, index) => {
    const raw = value[index];
    if (typeof raw !== 'object' || raw === null) return false;
    const candidate = raw as Record<string, unknown>;
    return (
      candidate.id === entry.id &&
      candidate.name === entry.name &&
      (candidate.role ?? '') === entry.role &&
      (candidate.email ?? '') === entry.email &&
      (candidate.phone ?? '') === entry.phone &&
      (candidate.website ?? '') === entry.website &&
      (candidate.notes ?? '') === entry.notes
    );
  });
}

/** Produces a trimmed, length-limited draft with safe optional values. */
export function cleanContactDraft(data: ContactDraft): ContactDraft {
  return {
    name: data.name.trim().slice(0, MAX_CONTACT_NAME_LENGTH),
    role: data.role.trim().slice(0, MAX_CONTACT_ROLE_LENGTH),
    email: data.email.trim().slice(0, MAX_CONTACT_EMAIL_LENGTH),
    phone: data.phone.trim().slice(0, MAX_CONTACT_PHONE_LENGTH),
    website: data.website.trim().slice(0, MAX_CONTACT_WEBSITE_LENGTH),
    notes: data.notes.trim().slice(0, MAX_CONTACT_NOTES_LENGTH),
  };
}

export type ContactFormErrors = Partial<Record<keyof ContactDraft, string>>;

/** Inline form validation; storage normalization applies the same limits. */
export function validateContactDraft(data: ContactDraft): ContactFormErrors {
  const errors: ContactFormErrors = {};
  const name = data.name.trim();
  const email = data.email.trim();
  const website = data.website.trim();

  if (!name) {
    errors.name = 'Enter a contact name.';
  } else if (name.length > MAX_CONTACT_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_CONTACT_NAME_LENGTH} characters or fewer.`;
  }

  if (data.role.trim().length > MAX_CONTACT_ROLE_LENGTH) {
    errors.role = `Role must be ${MAX_CONTACT_ROLE_LENGTH} characters or fewer.`;
  }

  if (email && email.length > MAX_CONTACT_EMAIL_LENGTH) {
    errors.email = `Email must be ${MAX_CONTACT_EMAIL_LENGTH} characters or fewer.`;
  } else if (email && !isValidContactEmail(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (data.phone.trim().length > MAX_CONTACT_PHONE_LENGTH) {
    errors.phone = `Phone must be ${MAX_CONTACT_PHONE_LENGTH} characters or fewer.`;
  }

  if (website && website.length > MAX_CONTACT_WEBSITE_LENGTH) {
    errors.website = `Website must be ${MAX_CONTACT_WEBSITE_LENGTH} characters or fewer.`;
  } else if (website && !isValidUrl(website)) {
    errors.website = 'Enter a valid URL starting with http:// or https://.';
  }

  if (data.notes.length > MAX_CONTACT_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_CONTACT_NOTES_LENGTH} characters or fewer.`;
  }

  return errors;
}

/** The selector label includes only information useful in an interview context. */
export function contactLabel(contact: ContactEntry): string {
  return contact.role ? `${contact.name} — ${contact.role}` : contact.name;
}

/** Returns the ID only when it resolves to a contact in the same opportunity. */
export function resolveContactId(contactId: string, contacts: ContactEntry[]): string {
  return contactId && contacts.some((contact) => contact.id === contactId) ? contactId : '';
}

/** Clears references to contacts that do not exist in the same opportunity. */
export function repairInterviewContactReferences(
  interviews: InterviewEntry[],
  contacts: ContactEntry[],
): InterviewEntry[] {
  const availableIds = new Set(contacts.map((contact) => contact.id));
  let changed = false;
  const repaired = interviews.map((interview) => {
    if (!interview.contactId || availableIds.has(interview.contactId)) return interview;
    changed = true;
    return { ...interview, contactId: '' };
  });
  return changed ? repaired : interviews;
}

/**
 * Clears one contact reference from every interview. Interview records, IDs,
 * dates, statuses and notes are retained; only the relationship is removed.
 */
export function clearInterviewContactReferences(
  interviews: InterviewEntry[],
  contactId: string,
): InterviewEntry[] {
  return interviews.map((interview) =>
    interview.contactId === contactId ? { ...interview, contactId: '' } : interview,
  );
}

function entryFromDraft(draft: ContactDraft, id: string): ContactEntry {
  return { ...cleanContactDraft(draft), id };
}

/** Appends a new contact without mutating the existing collection. */
export function addContact(
  contacts: ContactEntry[],
  draft: ContactDraft,
  id: string,
): ContactEntry[] {
  if (contacts.length >= MAX_CONTACTS) return [...contacts];
  return [...contacts, entryFromDraft(draft, id)];
}

/**
 * Replaces one contact's editable fields while preserving its stable ID.
 * Other contacts and the input array are untouched.
 */
export function updateContact(
  contacts: ContactEntry[],
  id: string,
  draft: ContactDraft,
): ContactEntry[] {
  return contacts.map((entry) =>
    entry.id === id ? { ...entryFromDraft(draft, entry.id), id: entry.id } : entry,
  );
}

/** Removes one contact by ID. Interview references are handled by the caller. */
export function removeContact(contacts: ContactEntry[], id: string): ContactEntry[] {
  return contacts.filter((entry) => entry.id !== id);
}

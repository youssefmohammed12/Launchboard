import { describe, expect, it } from 'vitest';
import type { ContactDraft, ContactEntry } from '../types/opportunity';
import { makeContact, makeInterview } from '../test/fixtures';
import {
  MAX_CONTACTS,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  addContact,
  clearInterviewContactReferences,
  cleanContactDraft,
  contactLabel,
  isValidContactEmail,
  normalizeStoredContacts,
  removeContact,
  repairInterviewContactReferences,
  resolveContactId,
  sameStoredContacts,
  updateContact,
  validateContactDraft,
} from './contacts';

function draftFrom(contact: ContactEntry): ContactDraft {
  const { id: ignored, ...draft } = contact;
  void ignored;
  return draft;
}

describe('normalizeStoredContacts', () => {
  it('treats missing or non-array collections as empty', () => {
    expect(normalizeStoredContacts(undefined)).toEqual([]);
    expect(normalizeStoredContacts(null)).toEqual([]);
    expect(normalizeStoredContacts({})).toEqual([]);
    expect(normalizeStoredContacts('contacts')).toEqual([]);
  });

  it('preserves complete valid contacts and their stable IDs', () => {
    const contact = makeContact({
      id: 'contact-7',
      name: 'Sam Rivera',
      role: 'Hiring Manager',
      email: 'sam@example.com',
      phone: '+33 (0)6 12 34 56 78',
      website: 'https://example.com/sam',
      notes: 'Met at a meetup.',
    });

    expect(normalizeStoredContacts([contact])).toEqual([contact]);
  });

  it('skips contacts without an ID or name and keeps the first duplicate ID', () => {
    const first = makeContact({ id: 'duplicate', name: 'First contact' });
    const second = makeContact({ id: 'duplicate', name: 'Second contact' });
    const normalized = normalizeStoredContacts([
      null,
      'not a contact',
      { name: 'No ID', role: 'Recruiter' },
      { id: 'no-name', name: '   ' },
      first,
      second,
      { id: 'after-duplicate', name: 'Valid sibling' },
    ]);

    expect(normalized.map((contact) => contact.id)).toEqual(['duplicate', 'after-duplicate']);
    expect(normalized[0].name).toBe('First contact');
  });

  it('repairs optional values and preserves the rest of the contact', () => {
    const [contact] = normalizeStoredContacts([
      {
        id: 'repaired',
        name: '  Jordan Lee  ',
        role: '  Recruiter  ',
        email: 'not-an-email',
        phone: '  +44 20 7946 0958  ',
        website: 'javascript:alert(1)',
        notes: 42,
      },
    ]);

    expect(contact).toEqual({
      id: 'repaired',
      name: 'Jordan Lee',
      role: 'Recruiter',
      email: '',
      phone: '+44 20 7946 0958',
      website: '',
      notes: '',
    });
  });

  it('caps the collection and each text field at its limit', () => {
    const many = Array.from({ length: MAX_CONTACTS + 3 }, (_, index) =>
      makeContact({ id: `contact-${index}`, name: `Contact ${index}` }),
    );
    expect(normalizeStoredContacts(many)).toHaveLength(MAX_CONTACTS);

    const [long] = normalizeStoredContacts([
      makeContact({
        id: 'long',
        name: 'N'.repeat(MAX_CONTACT_NAME_LENGTH + 10),
        role: 'R'.repeat(MAX_CONTACT_ROLE_LENGTH + 10),
        phone: '1'.repeat(MAX_CONTACT_PHONE_LENGTH + 10),
        notes: 'N'.repeat(MAX_CONTACT_NOTES_LENGTH + 10),
      }),
    ]);

    expect(long.name).toHaveLength(MAX_CONTACT_NAME_LENGTH);
    expect(long.role).toHaveLength(MAX_CONTACT_ROLE_LENGTH);
    expect(long.phone).toHaveLength(MAX_CONTACT_PHONE_LENGTH);
    expect(long.notes).toHaveLength(MAX_CONTACT_NOTES_LENGTH);
  });
});

describe('sameStoredContacts', () => {
  it('accepts a missing collection as canonical empty data', () => {
    expect(sameStoredContacts(undefined, [])).toBe(true);
  });

  it('reports malformed or repaired contact collections', () => {
    const contact = makeContact();

    expect(sameStoredContacts([contact], [contact])).toBe(true);
    expect(sameStoredContacts([contact, contact], [contact])).toBe(false);
    expect(sameStoredContacts([{ ...contact, name: '  Jordan Lee  ' }], [contact])).toBe(false);
    expect(sameStoredContacts([{ ...contact, email: 'not-an-email' }], [contact])).toBe(false);
    expect(sameStoredContacts(null, [])).toBe(false);
  });
});

describe('contact validation', () => {
  it('accepts practical email addresses and rejects malformed ones', () => {
    expect(isValidContactEmail('jordan.lee@example.com')).toBe(true);
    expect(isValidContactEmail('jordan+tag@example.co.uk')).toBe(true);
    expect(isValidContactEmail('not-an-email')).toBe(false);
    expect(isValidContactEmail('name@example')).toBe(false);
    expect(isValidContactEmail('name @example.com')).toBe(false);
  });

  it('requires a name and validates optional email and website fields', () => {
    const errors = validateContactDraft(
      draftFrom(
        makeContact({
          name: '   ',
          email: 'not-an-email',
          website: 'ftp://example.com/profile',
        }),
      ),
    );

    expect(errors.name).toBe('Enter a contact name.');
    expect(errors.email).toBe('Enter a valid email address.');
    expect(errors.website).toBe('Enter a valid URL starting with http:// or https://.');
  });

  it('accepts international phone formats without imposing a pattern', () => {
    const errors = validateContactDraft(
      draftFrom(
        makeContact({
          phone: '+33 (0)6 12 34 56 78',
          email: '',
          website: '',
        }),
      ),
    );

    expect(errors.phone).toBeUndefined();
    expect(errors).toEqual({});
  });

  it('enforces text limits and accepts a valid draft', () => {
    expect(validateContactDraft(draftFrom(makeContact()))).toEqual({});

    const errors = validateContactDraft(
      draftFrom(
        makeContact({
          name: 'N'.repeat(MAX_CONTACT_NAME_LENGTH + 1),
          role: 'R'.repeat(MAX_CONTACT_ROLE_LENGTH + 1),
          phone: '1'.repeat(MAX_CONTACT_PHONE_LENGTH + 1),
          notes: 'N'.repeat(MAX_CONTACT_NOTES_LENGTH + 1),
        }),
      ),
    );

    expect(errors.name).toContain('characters or fewer');
    expect(errors.role).toContain('characters or fewer');
    expect(errors.phone).toContain('characters or fewer');
    expect(errors.notes).toContain('characters or fewer');
  });

  it('trims text and length-limits drafts before saving', () => {
    expect(
      cleanContactDraft({
        name: '  Jordan Lee  ',
        role: '  Recruiter  ',
        email: '  jordan@example.com  ',
        phone: '  +1 555 010 2030  ',
        website: '  https://example.com/jordan  ',
        notes: '  Follow up Friday.  ',
      }),
    ).toEqual({
      name: 'Jordan Lee',
      role: 'Recruiter',
      email: 'jordan@example.com',
      phone: '+1 555 010 2030',
      website: 'https://example.com/jordan',
      notes: 'Follow up Friday.',
    });

    expect(
      cleanContactDraft({ ...draftFrom(makeContact()), name: 'N'.repeat(MAX_CONTACT_NAME_LENGTH + 5) })
        .name,
    ).toHaveLength(MAX_CONTACT_NAME_LENGTH);
  });
});

describe('contact operations', () => {
  const first = makeContact({ id: 'first', name: 'Jordan Lee' });
  const second = makeContact({ id: 'second', name: 'Sam Rivera', role: 'Hiring Manager' });

  it('adds a contact without mutating the original collection', () => {
    const original = [first];
    const snapshot = [...original];
    const draft = draftFrom(makeContact({ name: '  Alex Chen  ', role: '  Engineer  ' }));

    const next = addContact(original, draft, 'new-contact');

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ ...cleanContactDraft(draft), id: 'new-contact' });
    expect(original).toEqual(snapshot);
  });

  it('does not exceed the per-opportunity contact limit', () => {
    const full = Array.from({ length: MAX_CONTACTS }, (_, index) =>
      makeContact({ id: `contact-${index}` }),
    );

    const next = addContact(full, draftFrom(makeContact()), 'one-too-many');

    expect(next).toHaveLength(MAX_CONTACTS);
    expect(next).toEqual(full);
  });

  it('updates one contact while preserving stable IDs and other contacts', () => {
    const original = [first, second];
    const draft = draftFrom({ ...second, name: 'Sam Rivera', role: 'Engineering Manager' });

    const next = updateContact(original, second.id, draft);

    expect(next[0]).toBe(first);
    expect(next[1]).toMatchObject({
      id: 'second',
      name: 'Sam Rivera',
      role: 'Engineering Manager',
    });
    expect(original[1]).toBe(second);
  });

  it('removes one contact without touching the others', () => {
    const next = removeContact([first, second], first.id);

    expect(next).toEqual([second]);
    expect(next[0]).toBe(second);
  });
});

describe('interview contact relationships', () => {
  const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter' });
  const other = makeContact({ id: 'contact-2', name: 'Sam Rivera', role: '' });

  it('formats a selector label with a role only when present', () => {
    expect(contactLabel(contact)).toBe('Jordan Lee — Recruiter');
    expect(contactLabel(other)).toBe('Sam Rivera');
  });

  it('resolves only IDs belonging to the same opportunity', () => {
    expect(resolveContactId('contact-1', [contact])).toBe('contact-1');
    expect(resolveContactId('missing', [contact])).toBe('');
    expect(resolveContactId('', [contact])).toBe('');
  });

  it('clears missing references without mutating or losing interview history', () => {
    const valid = makeInterview({
      id: 'valid',
      round: 'Recruiter Screen',
      contactId: 'contact-1',
      notes: 'Keep this note.',
    });
    const missing = makeInterview({
      id: 'missing',
      round: 'Technical Interview',
      date: '2026-02-01',
      contactId: 'deleted-contact',
      status: 'Completed',
      notes: 'Keep this too.',
    });
    const original = [valid, missing];

    const repaired = repairInterviewContactReferences(original, [contact]);

    expect(repaired[0]).toBe(valid);
    expect(repaired[1]).toMatchObject({
      id: 'missing',
      round: 'Technical Interview',
      date: '2026-02-01',
      status: 'Completed',
      notes: 'Keep this too.',
      contactId: '',
    });
    expect(original[1].contactId).toBe('deleted-contact');
  });

  it('clears one deleted contact reference while preserving every other field', () => {
    const linked = makeInterview({
      id: 'linked',
      round: 'Final Interview',
      date: '2026-03-01',
      status: 'Completed',
      outcome: 'Positive',
      notes: 'History stays.',
      contactId: 'contact-1',
    });
    const unrelated = makeInterview({ id: 'unrelated', contactId: 'contact-2' });
    const original = [linked, unrelated];

    const cleared = clearInterviewContactReferences(original, 'contact-1');

    expect(cleared[0]).toMatchObject({
      id: 'linked',
      round: 'Final Interview',
      date: '2026-03-01',
      status: 'Completed',
      outcome: 'Positive',
      notes: 'History stays.',
      contactId: '',
    });
    expect(cleared[1]).toBe(unrelated);
    expect(original[0].contactId).toBe('contact-1');
  });
});

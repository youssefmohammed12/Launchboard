import { describe, expect, it } from 'vitest';
import type { InterviewDraft, InterviewEntry } from '../types/opportunity';
import { makeInterview } from '../test/fixtures';
import {
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  addInterview,
  cleanInterviewDraft,
  isValidInterviewTime,
  normalizeStoredInterviews,
  removeInterview,
  sameStoredInterviews,
  setInterviewOutcome,
  setInterviewStatus,
  sortInterviews,
  updateInterview,
  validateInterviewDraft,
} from './interviews';

function draftFrom(interview: InterviewEntry): InterviewDraft {
  const { id: ignored, ...draft } = interview;
  void ignored;
  return draft;
}

describe('normalizeStoredInterviews', () => {
  it('treats missing or non-array collections as empty', () => {
    expect(normalizeStoredInterviews(undefined)).toEqual([]);
    expect(normalizeStoredInterviews(null)).toEqual([]);
    expect(normalizeStoredInterviews({})).toEqual([]);
    expect(normalizeStoredInterviews('interviews')).toEqual([]);
  });

  it('preserves complete valid interview records and their IDs', () => {
    const interview = makeInterview({
      id: 'round-1',
      round: 'Technical Interview',
      date: '2026-03-04',
      time: '14:30',
      mode: 'In person',
      status: 'Completed',
      outcome: 'Positive',
      meetingUrl: 'https://meet.example.com/abc',
      location: 'Northwind HQ',
      preparationNotes: 'Review the design system.',
      notes: 'Met the team lead.',
      contactId: 'contact-7',
    });

    expect(normalizeStoredInterviews([interview])).toEqual([interview]);
  });

  it('skips impossible dates and repairs invalid optional values safely', () => {
    const normalized = normalizeStoredInterviews([
      {
        id: 'invalid-date',
        round: 'Final Interview',
        date: '2026-02-30',
        time: '09:00',
      },
      {
        id: 'repaired',
        round: '  Technical Interview  ',
        date: '2028-02-29',
        time: '25:00',
        mode: 'Zoom',
        status: 'Ghosted',
        outcome: 'Maybe',
        meetingUrl: 'javascript:alert(1)',
        location: '  Remote  ',
        preparationNotes: '  Practise arrays.  ',
        notes: 42,
        contactId: '  contact-7  ',
      },
    ]);

    expect(normalized).toEqual([
      expect.objectContaining({
        id: 'repaired',
        round: 'Technical Interview',
        date: '2028-02-29',
        time: '',
        mode: 'Other',
        status: 'Scheduled',
        outcome: '',
        meetingUrl: '',
        location: 'Remote',
        preparationNotes: 'Practise arrays.',
        notes: '',
        contactId: 'contact-7',
      }),
    ]);
  });

  it('drops malformed children without affecting valid siblings', () => {
    const valid = makeInterview({ id: 'valid' });
    const normalized = normalizeStoredInterviews([
      null,
      'not an interview',
      { round: 'No ID', date: '2026-01-01' },
      { id: 'no-round', round: '   ', date: '2026-01-01' },
      { id: 'no-date', round: 'No date', date: '' },
      valid,
    ]);

    expect(normalized).toEqual([valid]);
  });

  it('keeps the first valid interview when IDs are duplicated', () => {
    const first = makeInterview({ id: 'duplicate', round: 'First round' });
    const second = makeInterview({ id: 'duplicate', round: 'Second round' });
    const normalized = normalizeStoredInterviews([first, second]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].round).toBe('First round');
  });

  it('caps the collection and each text field at its limit', () => {
    const many = Array.from({ length: MAX_INTERVIEWS + 3 }, (_, index) =>
      makeInterview({ id: `round-${index}`, round: `Round ${index}` }),
    );
    expect(normalizeStoredInterviews(many)).toHaveLength(MAX_INTERVIEWS);

    const [long] = normalizeStoredInterviews([
      makeInterview({
        id: 'long',
        round: 'R'.repeat(MAX_INTERVIEW_ROUND_LENGTH + 10),
        location: 'L'.repeat(MAX_INTERVIEW_LOCATION_LENGTH + 10),
        preparationNotes: 'P'.repeat(MAX_INTERVIEW_NOTES_LENGTH + 10),
        notes: 'N'.repeat(MAX_INTERVIEW_NOTES_LENGTH + 10),
        contactId: 'C'.repeat(MAX_INTERVIEW_CONTACT_ID_LENGTH + 10),
      }),
    ]);

    expect(long.round).toHaveLength(MAX_INTERVIEW_ROUND_LENGTH);
    expect(long.location).toHaveLength(MAX_INTERVIEW_LOCATION_LENGTH);
    expect(long.preparationNotes).toHaveLength(MAX_INTERVIEW_NOTES_LENGTH);
    expect(long.notes).toHaveLength(MAX_INTERVIEW_NOTES_LENGTH);
    expect(long.contactId).toHaveLength(MAX_INTERVIEW_CONTACT_ID_LENGTH);
  });
});

describe('sameStoredInterviews', () => {
  it('accepts a missing collection as canonical empty data', () => {
    expect(sameStoredInterviews(undefined, [])).toBe(true);
  });

  it('reports malformed or repaired interview collections', () => {
    const interview = makeInterview();

    expect(sameStoredInterviews([interview], [interview])).toBe(true);
    expect(sameStoredInterviews([interview, interview], [interview])).toBe(false);
    expect(sameStoredInterviews([{ ...interview, time: '9:00' }], [interview])).toBe(false);
    expect(sameStoredInterviews(null, [])).toBe(false);
  });
});

describe('interview operations', () => {
  const first = makeInterview({ id: 'first', round: 'Recruiter Screen' });
  const second = makeInterview({ id: 'second', round: 'Technical Interview', date: '2026-01-20' });

  it('adds an interview without mutating the original collection', () => {
    const original = [first];
    const snapshot = [...original];
    const draft = draftFrom(makeInterview({ round: 'Final Interview' }));

    const next = addInterview(original, draft, 'new-round');

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ ...cleanInterviewDraft(draft), id: 'new-round' });
    expect(original).toEqual(snapshot);
  });

  it('does not exceed the per-opportunity interview limit', () => {
    const full = Array.from({ length: MAX_INTERVIEWS }, (_, index) =>
      makeInterview({ id: `round-${index}` }),
    );

    const next = addInterview(full, draftFrom(makeInterview()), 'one-too-many');

    expect(next).toHaveLength(MAX_INTERVIEWS);
    expect(next).toEqual(full);
  });

  it('updates one interview while preserving stable IDs and other rounds', () => {
    const original = [first, second];
    const draft = draftFrom({ ...second, round: 'Hiring Manager Interview', date: '2026-01-22' });

    const next = updateInterview(original, second.id, draft);

    expect(next[0]).toBe(first);
    expect(next[1]).toMatchObject({
      id: 'second',
      round: 'Hiring Manager Interview',
      date: '2026-01-22',
    });
    expect(original[1]).toBe(second);
  });

  it('reschedules through an update and can return a cancelled round to scheduled', () => {
    const cancelled = makeInterview({ id: 'cancelled', status: 'Cancelled', outcome: '' });
    const draft = draftFrom({
      ...cancelled,
      date: '2026-04-01',
      time: '16:00',
      status: 'Scheduled',
    });

    const [next] = updateInterview([cancelled], cancelled.id, draft);

    expect(next).toMatchObject({
      id: 'cancelled',
      date: '2026-04-01',
      time: '16:00',
      status: 'Scheduled',
    });
  });

  it('removes one interview without touching the others', () => {
    const next = removeInterview([first, second], first.id);

    expect(next).toEqual([second]);
    expect(next[0]).toBe(second);
  });

  it('completes, cancels and updates an outcome without changing the ID', () => {
    const completed = setInterviewStatus([first], first.id, 'Completed');
    expect(completed[0]).toMatchObject({ id: 'first', status: 'Completed' });

    const cancelled = setInterviewStatus([first], first.id, 'Cancelled');
    expect(cancelled[0]).toMatchObject({ id: 'first', status: 'Cancelled' });

    const positive = setInterviewOutcome(completed, first.id, 'Positive');
    expect(positive[0]).toMatchObject({ id: 'first', status: 'Completed', outcome: 'Positive' });

    const cleared = setInterviewOutcome(positive, first.id, '');
    expect(cleared[0].outcome).toBe('');
    expect(first.status).toBe('Scheduled');
    expect(first.outcome).toBe('');
  });
});

describe('validateInterviewDraft', () => {
  it('requires a round and a genuine calendar date', () => {
    const draft = draftFrom(makeInterview({ round: '  ', date: '2026-02-30' }));
    const errors = validateInterviewDraft(draft);

    expect(errors.round).toBe('Enter a round or name.');
    expect(errors.date).toBe('Enter a valid interview date.');
  });

  it('rejects invalid times and meeting URLs', () => {
    const errors = validateInterviewDraft(
      draftFrom(
        makeInterview({
          time: '24:00',
          meetingUrl: 'not-a-url',
        }),
      ),
    );

    expect(errors.time).toBe('Enter a valid 24-hour time (HH:mm).');
    expect(errors.meetingUrl).toBe('Enter a valid URL starting with http:// or https://.');
    expect(isValidInterviewTime('09:05')).toBe(true);
    expect(isValidInterviewTime('9:05')).toBe(false);
    expect(isValidInterviewTime('23:59')).toBe(true);
  });

  it('accepts a valid draft and enforces text limits', () => {
    expect(validateInterviewDraft(draftFrom(makeInterview()))).toEqual({});

    const tooLong = validateInterviewDraft(
      draftFrom(
        makeInterview({
          round: 'R'.repeat(MAX_INTERVIEW_ROUND_LENGTH + 1),
          location: 'L'.repeat(MAX_INTERVIEW_LOCATION_LENGTH + 1),
          preparationNotes: 'P'.repeat(MAX_INTERVIEW_NOTES_LENGTH + 1),
          notes: 'N'.repeat(MAX_INTERVIEW_NOTES_LENGTH + 1),
        }),
      ),
    );

    expect(tooLong.round).toContain('characters or fewer');
    expect(tooLong.location).toContain('characters or fewer');
    expect(tooLong.preparationNotes).toContain('characters or fewer');
    expect(tooLong.notes).toContain('characters or fewer');
  });
});

describe('sortInterviews', () => {
  it('sorts chronologically, puts untimed rounds after timed rounds on the same day, and does not mutate input', () => {
    const later = makeInterview({ id: 'later', date: '2026-02-01', time: '09:00' });
    const untimed = makeInterview({ id: 'untimed', date: '2026-01-15', time: '' });
    const timed = makeInterview({ id: 'timed', date: '2026-01-15', time: '08:00' });
    const original = [later, untimed, timed];

    const sorted = sortInterviews(original);

    expect(sorted.map((entry) => entry.id)).toEqual(['timed', 'untimed', 'later']);
    expect(original.map((entry) => entry.id)).toEqual(['later', 'untimed', 'timed']);
  });
});

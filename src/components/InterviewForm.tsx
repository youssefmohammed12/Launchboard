import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  type ContactEntry,
  type InterviewDraft,
  type InterviewEntry,
} from '../types/opportunity';
import { contactLabel } from '../utils/contacts';
import { toISODate } from '../utils/dates';
import {
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_INTERVIEW_URL_LENGTH,
  cleanInterviewDraft,
  validateInterviewDraft,
  type InterviewFormErrors,
} from '../utils/interviews';

interface Props {
  /** Contacts belonging to the same opportunity. */
  contacts: ContactEntry[];
  /** When provided, the form edits this interview; otherwise it creates one. */
  initial?: InterviewEntry;
  onSave: (draft: InterviewDraft) => void;
  onCancel: () => void;
}

const controlClass =
  'w-full rounded-control border border-border bg-surface px-s3 py-[8px] text-inherit [font:inherit] [&[aria-invalid]]:border-danger';
const fieldClass = 'grid items-start gap-s1';
const labelClass = 'font-semibold text-[0.82rem]';
const errorClass = 'text-[0.8rem] text-danger';
const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-border bg-surface px-s3 py-[6px] text-[0.85rem] font-medium text-text hover:border-[#c9c4b9]';
const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-accent bg-accent px-s3 py-[6px] text-[0.85rem] font-medium text-white hover:bg-accent-dark';

function toDraft(initial?: InterviewEntry): InterviewDraft {
  if (initial) {
    return {
      round: initial.round,
      date: initial.date,
      time: initial.time,
      mode: initial.mode,
      status: initial.status,
      outcome: initial.outcome,
      meetingUrl: initial.meetingUrl,
      location: initial.location,
      preparationNotes: initial.preparationNotes,
      notes: initial.notes,
      contactId: initial.contactId,
    };
  }
  return {
    round: '',
    date: toISODate(new Date()),
    time: '',
    mode: 'Video',
    status: 'Scheduled',
    outcome: '',
    meetingUrl: '',
    location: '',
    preparationNotes: '',
    notes: '',
    contactId: '',
  };
}

export function InterviewForm({ contacts, initial, onSave, onCancel }: Props) {
  const [data, setData] = useState<InterviewDraft>(() => toDraft(initial));
  const [errors, setErrors] = useState<InterviewFormErrors>({});
  const roundRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    roundRef.current?.focus();
  }, []);

  const set = <K extends keyof InterviewDraft>(key: K, value: InterviewDraft[K]) => {
    setData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateInterviewDraft(data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave(cleanInterviewDraft(data));
  };

  const a11y = (key: keyof InterviewDraft) =>
    errors[key]
      ? { 'aria-invalid': true, 'aria-describedby': `interview-${key}-err` }
      : {};
  const message = (key: keyof InterviewDraft) =>
    errors[key] ? (
      <span id={`interview-${key}-err`} className={errorClass} role="alert">
        {errors[key]}
      </span>
    ) : null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="interview-form-heading"
      className="grid grid-cols-2 gap-s3 rounded-card border border-accent bg-accent-soft/30 p-s3 max-[640px]:grid-cols-1"
    >
      <h4
        id="interview-form-heading"
        className="col-span-2 m-0 text-[0.9rem] font-bold max-[640px]:col-span-1"
      >
        {initial ? 'Edit interview' : 'Add interview'}
      </h4>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="interview-round" className={labelClass}>
          Round or name *
        </label>
        <input
          ref={roundRef}
          id="interview-round"
          className={controlClass}
          maxLength={MAX_INTERVIEW_ROUND_LENGTH}
          value={data.round}
          onChange={(event) => set('round', event.target.value)}
          placeholder="Recruiter Screen"
          {...a11y('round')}
        />
        {message('round')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-date" className={labelClass}>
          Interview date *
        </label>
        <input
          id="interview-date"
          type="date"
          className={controlClass}
          value={data.date}
          onChange={(event) => set('date', event.target.value)}
          {...a11y('date')}
        />
        {message('date')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-time" className={labelClass}>
          Interview time (optional)
        </label>
        <input
          id="interview-time"
          type="time"
          className={controlClass}
          value={data.time}
          onChange={(event) => set('time', event.target.value)}
          {...a11y('time')}
        />
        {message('time')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-mode" className={labelClass}>
          Mode
        </label>
        <select
          id="interview-mode"
          className={controlClass}
          value={data.mode}
          onChange={(event) => {
            const mode = INTERVIEW_MODES.find((value) => value === event.target.value);
            if (mode) set('mode', mode);
          }}
        >
          {INTERVIEW_MODES.map((mode) => (
            <option key={mode}>{mode}</option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-status" className={labelClass}>
          Status
        </label>
        <select
          id="interview-status"
          className={controlClass}
          value={data.status}
          onChange={(event) => {
            const status = INTERVIEW_STATUSES.find((value) => value === event.target.value);
            if (status) set('status', status);
          }}
        >
          {INTERVIEW_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="interview-contact" className={labelClass}>
          Contact (optional)
        </label>
        <select
          id="interview-contact"
          className={controlClass}
          value={data.contactId}
          onChange={(event) => set('contactId', event.target.value)}
          aria-invalid={errors.contactId ? true : undefined}
          aria-describedby={
            [
              errors.contactId ? 'interview-contactId-err' : '',
              contacts.length === 0 ? 'interview-contact-help' : '',
            ]
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          <option value="">No contact</option>
          {contacts.map((contact) => (
            <option key={contact.id} value={contact.id}>
              {contactLabel(contact)}
            </option>
          ))}
        </select>
        {contacts.length === 0 && (
          <span id="interview-contact-help" className="text-[0.78rem] text-muted">
            Add a contact in the Contacts section to link one to this round.
          </span>
        )}
        {message('contactId')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-outcome" className={labelClass}>
          Outcome (optional)
        </label>
        <select
          id="interview-outcome"
          className={controlClass}
          value={data.outcome}
          onChange={(event) => {
            const outcome = INTERVIEW_OUTCOMES.find((value) => value === event.target.value);
            set('outcome', outcome ?? '');
          }}
        >
          <option value="">No outcome recorded</option>
          {INTERVIEW_OUTCOMES.map((outcome) => (
            <option key={outcome}>{outcome}</option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <label htmlFor="interview-location" className={labelClass}>
          Location (optional)
        </label>
        <input
          id="interview-location"
          className={controlClass}
          maxLength={MAX_INTERVIEW_LOCATION_LENGTH}
          value={data.location}
          onChange={(event) => set('location', event.target.value)}
          placeholder="Office, address, or room"
          {...a11y('location')}
        />
        {message('location')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="interview-url" className={labelClass}>
          Meeting URL (optional)
        </label>
        <input
          id="interview-url"
          type="url"
          inputMode="url"
          className={controlClass}
          maxLength={MAX_INTERVIEW_URL_LENGTH}
          value={data.meetingUrl}
          onChange={(event) => set('meetingUrl', event.target.value)}
          placeholder="https://"
          {...a11y('meetingUrl')}
        />
        {message('meetingUrl')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="interview-preparation" className={labelClass}>
          Preparation notes (optional)
        </label>
        <textarea
          id="interview-preparation"
          rows={3}
          className={controlClass}
          maxLength={MAX_INTERVIEW_NOTES_LENGTH}
          value={data.preparationNotes}
          onChange={(event) => set('preparationNotes', event.target.value)}
          placeholder="Topics to review, questions to ask, portfolio pieces…"
          {...a11y('preparationNotes')}
        />
        {message('preparationNotes')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="interview-notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea
          id="interview-notes"
          rows={2}
          className={controlClass}
          maxLength={MAX_INTERVIEW_NOTES_LENGTH}
          value={data.notes}
          onChange={(event) => set('notes', event.target.value)}
          {...a11y('notes')}
        />
        {message('notes')}
      </div>

      <div className="col-span-2 flex justify-end gap-s2 max-[640px]:col-span-1">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButtonClass}>
          Save interview
        </button>
      </div>
    </form>
  );
}

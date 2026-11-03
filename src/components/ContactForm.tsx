import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ContactDraft, ContactEntry } from '../types/opportunity';
import {
  MAX_CONTACT_EMAIL_LENGTH,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  MAX_CONTACT_WEBSITE_LENGTH,
  cleanContactDraft,
  validateContactDraft,
  type ContactFormErrors,
} from '../utils/contacts';

interface Props {
  /** When provided, the form edits this contact; otherwise it creates one. */
  initial?: ContactEntry;
  onSave: (draft: ContactDraft) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
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

function toDraft(initial?: ContactEntry): ContactDraft {
  if (initial) {
    return {
      name: initial.name,
      role: initial.role,
      email: initial.email,
      phone: initial.phone,
      website: initial.website,
      notes: initial.notes,
    };
  }
  return { name: '', role: '', email: '', phone: '', website: '', notes: '' };
}

export function ContactForm({ initial, onSave, onCancel, busy = false }: Props) {
  const [data, setData] = useState<ContactDraft>(() => toDraft(initial));
  const [errors, setErrors] = useState<ContactFormErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const set = <K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) => {
    setData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateContactDraft(data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave(cleanContactDraft(data));
  };

  const a11y = (key: keyof ContactDraft) =>
    errors[key]
      ? { 'aria-invalid': true, 'aria-describedby': `contact-${key}-err` }
      : {};
  const message = (key: keyof ContactDraft) =>
    errors[key] ? (
      <span id={`contact-${key}-err`} className={errorClass} role="alert">
        {errors[key]}
      </span>
    ) : null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="contact-form-heading"
      className="grid grid-cols-2 gap-s3 rounded-card border border-accent bg-accent-soft/30 p-s3 max-[640px]:grid-cols-1"
    >
      <h4
        id="contact-form-heading"
        className="col-span-2 m-0 text-[0.9rem] font-bold max-[640px]:col-span-1"
      >
        {initial ? 'Edit contact' : 'Add contact'}
      </h4>

      <div className={fieldClass}>
        <label htmlFor="contact-name" className={labelClass}>
          Name *
        </label>
        <input
          ref={nameRef}
          id="contact-name"
          className={controlClass}
          maxLength={MAX_CONTACT_NAME_LENGTH}
          value={data.name}
          onChange={(event) => set('name', event.target.value)}
          placeholder="Jordan Lee"
          autoComplete="name"
          {...a11y('name')}
        />
        {message('name')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="contact-role" className={labelClass}>
          Role or title (optional)
        </label>
        <input
          id="contact-role"
          className={controlClass}
          maxLength={MAX_CONTACT_ROLE_LENGTH}
          value={data.role}
          onChange={(event) => set('role', event.target.value)}
          placeholder="Recruiter"
          {...a11y('role')}
        />
        {message('role')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="contact-email" className={labelClass}>
          Email (optional)
        </label>
        <input
          id="contact-email"
          type="email"
          inputMode="email"
          className={controlClass}
          maxLength={MAX_CONTACT_EMAIL_LENGTH}
          value={data.email}
          onChange={(event) => set('email', event.target.value)}
          placeholder="name@example.com"
          autoComplete="email"
          {...a11y('email')}
        />
        {message('email')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="contact-phone" className={labelClass}>
          Phone (optional)
        </label>
        <input
          id="contact-phone"
          type="tel"
          inputMode="tel"
          className={controlClass}
          maxLength={MAX_CONTACT_PHONE_LENGTH}
          value={data.phone}
          onChange={(event) => set('phone', event.target.value)}
          placeholder="+1 555 010 2030"
          autoComplete="tel"
          {...a11y('phone')}
        />
        {message('phone')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="contact-website" className={labelClass}>
          Website or profile URL (optional)
        </label>
        <input
          id="contact-website"
          type="url"
          inputMode="url"
          className={controlClass}
          maxLength={MAX_CONTACT_WEBSITE_LENGTH}
          value={data.website}
          onChange={(event) => set('website', event.target.value)}
          placeholder="https://"
          {...a11y('website')}
        />
        {message('website')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="contact-notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea
          id="contact-notes"
          rows={3}
          className={controlClass}
          maxLength={MAX_CONTACT_NOTES_LENGTH}
          value={data.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder="How you met, preferred contact method, context for future conversations…"
          {...a11y('notes')}
        />
        {message('notes')}
      </div>

      <div className="col-span-2 flex justify-end gap-s2 max-[640px]:col-span-1">
        <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          Save contact
        </button>
      </div>
    </form>
  );
}

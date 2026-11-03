import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  type FormErrors,
  type Opportunity,
  type OpportunityFormData,
} from '../types/opportunity';
import { emptyForm, parseTagInput, validate } from '../utils/opportunities';
import {
  SAVE_FAILURE_MESSAGE,
  type MutationOutcome,
} from '../utils/mutationMessages';
import { Modal } from './Modal';

interface Props {
  /** When provided, the form edits this record; otherwise it creates one. */
  initial?: Opportunity;
  /** The control that opened this dialog, recorded explicitly for focus restore. */
  opener?: HTMLElement | null;
  /** Id of the element to focus when the opener is gone. */
  fallbackFocusId?: string;
  /** Optional notice shown when a stale server write refreshed the form base. */
  notice?: string;
  /** Returns false when the change could not be persisted. */
  onSave: (data: OpportunityFormData) => MutationOutcome;
  onCancel: () => void;
}

const controlClass =
  'w-full rounded-control border border-border bg-surface px-s3 py-[9px] text-inherit [font:inherit] [&[aria-invalid]]:border-danger';
const fieldClass = 'grid items-start gap-s1';
const labelClass = 'font-semibold text-[0.88rem]';
const fieldErrorClass = 'text-[0.82rem] text-danger';
const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text hover:border-[#c9c4b9]';
const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark';

function toFormData(o: Opportunity): OpportunityFormData {
  return {
    title: o.title,
    company: o.company,
    type: o.type,
    status: o.status,
    priority: o.priority,
    tags: o.tags,
    url: o.url,
    deadline: o.deadline,
    followUpDate: o.followUpDate,
    compensation: o.compensation,
    description: o.description,
    notes: o.notes,
  };
}

export function OpportunityForm({ initial, opener, fallbackFocusId, notice, onSave, onCancel }: Props) {
  const [data, setData] = useState<OpportunityFormData>(() => (initial ? toFormData(initial) : emptyForm));
  const [tagInput, setTagInput] = useState(() => (initial ? initial.tags.join(', ') : ''));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  type Change = ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  const text = (
    key:
      | 'title'
      | 'company'
      | 'url'
      | 'deadline'
      | 'followUpDate'
      | 'compensation'
      | 'description'
      | 'notes',
  ) => (e: Change) => setData((d) => ({ ...d, [key]: e.target.value }));

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const found = validate(data);
    const parsedTags = parseTagInput(tagInput);
    if (parsedTags.error) found.tags = parsedTags.error;
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaveError(null);
    try {
      const outcome = onSave({
        ...data,
        title: data.title.trim(),
        company: data.company.trim(),
        url: data.url.trim(),
        deadline: data.deadline.trim(),
        followUpDate: data.followUpDate.trim(),
        tags: parsedTags.tags,
      });

      // Keep the local adapter's synchronous persistence/error feedback exactly
      // synchronous. Only API-backed saves enter the pending UI state.
      if (outcome instanceof Promise) {
        setSaving(true);
        try {
          const saved = await outcome;
          if (saved === false) setSaveError(SAVE_FAILURE_MESSAGE);
        } finally {
          setSaving(false);
        }
      } else if (outcome === false) {
        setSaveError(SAVE_FAILURE_MESSAGE);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : SAVE_FAILURE_MESSAGE);
    }
  };

  const a11y = (k: keyof FormErrors) =>
    errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-err` } : {};
  const msg = (k: keyof FormErrors) =>
    errors[k] ? (
      <span id={`${k}-err`} className={fieldErrorClass} role="alert">
        {errors[k]}
      </span>
    ) : null;

  return (
    <Modal
      title={initial ? 'Edit opportunity' : 'Add opportunity'}
      onClose={onCancel}
      initialFocusId="f-title"
      opener={opener}
      fallbackFocusId={fallbackFocusId}
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        onChange={() => {
          if (saveError) setSaveError(null);
        }}
        noValidate
        className="grid grid-cols-2 gap-s4 px-s5 pt-s4 pb-s5 max-[640px]:grid-cols-1"
      >
        <div className={fieldClass}>
          <label htmlFor="f-title" className={labelClass}>Title *</label>
          <input id="f-title" className={controlClass} value={data.title} onChange={text('title')} {...a11y('title')} />
          {msg('title')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-company" className={labelClass}>Company or client *</label>
          <input id="f-company" className={controlClass} value={data.company} onChange={text('company')} {...a11y('company')} />
          {msg('company')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-type" className={labelClass}>Type *</label>
          <select
            id="f-type"
            className={controlClass}
            value={data.type}
            onChange={(e) => {
              const t = OPPORTUNITY_TYPES.find((x) => x === e.target.value);
              if (t) setData((d) => ({ ...d, type: t }));
            }}
          >
            {OPPORTUNITY_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-status" className={labelClass}>Status *</label>
          <select
            id="f-status"
            className={controlClass}
            value={data.status}
            onChange={(e) => {
              const s = OPPORTUNITY_STATUSES.find((x) => x === e.target.value);
              if (s) setData((d) => ({ ...d, status: s }));
            }}
          >
            {OPPORTUNITY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-priority" className={labelClass}>Priority</label>
          <select
            id="f-priority"
            className={controlClass}
            value={data.priority}
            onChange={(e) => {
              const p = PRIORITIES.find((x) => x === e.target.value);
              if (p) setData((d) => ({ ...d, priority: p }));
            }}
          >
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-comp" className={labelClass}>Compensation</label>
          <input id="f-comp" className={controlClass} value={data.compensation} onChange={text('compensation')} />
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-deadline" className={labelClass}>Deadline</label>
          <input
            id="f-deadline"
            type="date"
            className={controlClass}
            value={data.deadline}
            onChange={text('deadline')}
            {...a11y('deadline')}
          />
          {msg('deadline')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-followup" className={labelClass}>Follow-up date</label>
          <input
            id="f-followup"
            type="date"
            className={controlClass}
            value={data.followUpDate}
            onChange={text('followUpDate')}
            {...a11y('followUpDate')}
          />
          {msg('followUpDate')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-tags" className={labelClass}>Tags</label>
          <input
            id="f-tags"
            className={controlClass}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="Remote, React, Frontend"
            aria-invalid={errors.tags ? true : undefined}
            aria-describedby={errors.tags ? 'tags-help tags-err' : 'tags-help'}
          />
          <span id="tags-help" className="text-[0.78rem] text-muted">
            Comma-separated; up to 10 tags, 24 characters each.
          </span>
          {msg('tags')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-url" className={labelClass}>Application URL</label>
          <input id="f-url" type="url" inputMode="url" placeholder="https://" className={controlClass} value={data.url} onChange={text('url')} {...a11y('url')} />
          {msg('url')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-desc" className={labelClass}>Description</label>
          <textarea id="f-desc" rows={3} className={controlClass} value={data.description} onChange={text('description')} />
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-notes" className={labelClass}>Personal notes</label>
          <textarea id="f-notes" rows={3} className={controlClass} value={data.notes} onChange={text('notes')} />
        </div>
        {(notice || saveError) && (
          <p
            role="alert"
            className="col-span-2 m-0 rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.85rem] text-danger max-[640px]:col-span-1"
          >
            {saveError ?? notice}
          </p>
        )}
        <div className="col-span-2 mt-s4 flex justify-end gap-s2 max-[640px]:col-span-1">
          <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

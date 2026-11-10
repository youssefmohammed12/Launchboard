import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { findOpportunityDuplicates } from '@launchboard/domain';
import type { CaptureFieldEvidenceMap } from '@launchboard/domain';
import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  WORKPLACE_TYPES,
  COMPENSATION_INTERVALS,
  type CompensationDetails,
  type FormErrors,
  type Opportunity,
  type OpportunityFormData,
} from '../types/opportunity';
import {
  emptyForm,
  normalizeWorkplaceDetails,
  parseTagInput,
  stripUtmParameters,
  validate,
} from '../utils/opportunities';
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
  /** Partial values used to prefill a new record, e.g. a reviewed Quick Capture draft. */
  initialData?: Partial<OpportunityFormData>;
  /** Optional heading for a specialized create flow. */
  modalTitle?: string;
  /** Optional submit label for a specialized create flow. */
  submitLabel?: string;
  /** Optional explanatory copy displayed above the fields. */
  intro?: ReactNode;
  /** Capture source/confidence shown during review only; never persisted. */
  fieldEvidence?: CaptureFieldEvidenceMap;
  /** Existing records checked for exact duplicates while this review form changes. */
  duplicateOpportunities?: readonly Opportunity[];
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
    locations: o.locations,
    department: o.department,
    team: o.team,
    workplaceType: o.workplaceType,
    employmentType: o.employmentType,
    postedDate: o.postedDate,
    compensationDetails: o.compensationDetails,
    compensation: o.compensation,
    description: o.description,
    notes: o.notes,
  };
}

export function OpportunityForm({
  initial,
  opener,
  fallbackFocusId,
  notice,
  initialData,
  modalTitle,
  submitLabel,
  intro,
  fieldEvidence,
  duplicateOpportunities,
  onSave,
  onCancel,
}: Props) {
  const [initialFormData] = useState<OpportunityFormData>(() => {
    const formData = initial ? toFormData(initial) : { ...emptyForm, ...initialData };
    return { ...formData, ...normalizeWorkplaceDetails(formData) };
  });
  const [data, setData] = useState<OpportunityFormData>(initialFormData);
  const [tagInput, setTagInput] = useState(() => initialFormData.tags.join(', '));
  const [locationInput, setLocationInput] = useState(() => initialFormData.locations.join('\n'));
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editedEvidenceFields, setEditedEvidenceFields] = useState<Set<keyof CaptureFieldEvidenceMap>>(() => new Set());

  type Change = ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
  const markEvidenceEdited = (field: keyof CaptureFieldEvidenceMap) => {
    setEditedEvidenceFields((current) => new Set(current).add(field));
  };

  const evidenceHint = (field: keyof CaptureFieldEvidenceMap) => {
    const evidence = fieldEvidence?.[field];
    const edited = editedEvidenceFields.has(field);
    if (!edited && !evidence) return null;
    return (
      <span className="text-[0.74rem] text-muted" aria-live="polite">
        {edited ? 'Edited by you' : `Source: ${evidence?.label} · ${evidence?.confidence} confidence`}
      </span>
    );
  };

  const updateCompensationDetails = <K extends keyof CompensationDetails>(
    key: K,
    value: CompensationDetails[K],
  ) => setData((current) => ({
    ...current,
    compensationDetails: {
      minAmount: current.compensationDetails?.minAmount ?? '',
      maxAmount: current.compensationDetails?.maxAmount ?? '',
      currency: current.compensationDetails?.currency ?? '',
      interval: current.compensationDetails?.interval ?? '',
      [key]: value,
    },
  }));

  const text = (
    key:
      | 'title'
      | 'company'
      | 'url'
      | 'deadline'
      | 'followUpDate'
      | 'department'
      | 'team'
      | 'employmentType'
      | 'postedDate'
      | 'compensation'
      | 'description'
      | 'notes',
  ) => (e: Change) => {
    setData((d) => ({ ...d, [key]: e.target.value }));
    if (
      key === 'title' || key === 'company' || key === 'department' || key === 'team' ||
      key === 'employmentType' || key === 'postedDate' || key === 'description' ||
      key === 'compensation'
    ) {
      markEvidenceEdited(key);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    const found = validate(data);
    const parsedTags = parseTagInput(tagInput);
    if (parsedTags.error) found.tags = parsedTags.error;
    setErrors(found);
    if (Object.keys(found).length > 0 || !data.type) return;
    const normalizedJobDetails = normalizeWorkplaceDetails({
      locations: locationInput.split(/\r?\n/u).map((location) => location.trim()).filter(Boolean),
      workplaceType: data.workplaceType,
      employmentType: data.employmentType,
    });

    setSaveError(null);
    try {
      const outcome = onSave({
        ...data,
        title: data.title.trim(),
        company: data.company.trim(),
        url: stripUtmParameters(data.url),
        deadline: data.deadline.trim(),
        followUpDate: data.followUpDate.trim(),
        ...normalizedJobDetails,
        department: data.department.trim(),
        team: data.team.trim(),
        postedDate: data.postedDate.trim(),
        compensationDetails: data.compensationDetails && (data.compensationDetails.minAmount || data.compensationDetails.maxAmount)
          ? data.compensationDetails
          : null,
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
  const duplicateMatches = duplicateOpportunities
    ? findOpportunityDuplicates(
        { title: data.title, company: data.company, url: data.url },
        duplicateOpportunities,
      )
    : [];

  return (
    <Modal
      title={modalTitle ?? (initial ? 'Edit opportunity' : 'Add opportunity')}
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
        {intro && (
          <div className="col-span-2 max-[640px]:col-span-1">
            {intro}
          </div>
        )}
        {duplicateMatches.length > 0 && (
          <section
            className="col-span-2 grid gap-s2 rounded-control border border-[#e5c98d] bg-[#fff8e8] px-s3 py-s3 text-[0.83rem] text-[#76500f] max-[640px]:col-span-1"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <strong className="text-[0.88rem]">Possible duplicate</strong>
            <p className="m-0 leading-relaxed">
              We found an exact match in your workspace. Check it before saving. You can still save this opportunity if it is intentional.
            </p>
            <ul className="m-0 grid list-disc gap-s1 pl-5">
              {duplicateMatches.map(({ opportunity, reasons }) => (
                <li key={opportunity.id}>
                  <span className="font-semibold">{opportunity.title || 'Untitled opportunity'}</span>
                  {' · '}{opportunity.company || 'No company'}
                  {opportunity.archivedAt && (
                    <span className="ml-1 rounded-full border border-[#d9c18e] px-2 py-[1px] text-[0.7rem] font-semibold">Archived</span>
                  )}
                  <span className="block text-[0.77rem] text-[#82652c]">
                    {reasons.includes('url') && reasons.includes('title-company')
                      ? 'Same opportunity URL and title/company'
                      : reasons.includes('url')
                        ? 'Same opportunity URL'
                        : 'Same title and company'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className={fieldClass}>
          <label htmlFor="f-title" className={labelClass}>Title *</label>
          <input id="f-title" className={controlClass} value={data.title} onChange={text('title')} {...a11y('title')} />
          {evidenceHint('title')}
          {msg('title')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-company" className={labelClass}>Company or client *</label>
          <input id="f-company" className={controlClass} value={data.company} onChange={text('company')} {...a11y('company')} />
          {evidenceHint('company')}
          {msg('company')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-type" className={labelClass}>Type *</label>
          <select
            id="f-type"
            className={controlClass}
            value={data.type}
            onChange={(e) => {
              const t = OPPORTUNITY_TYPES.find((x) => x === e.target.value) ?? '';
              setData((d) => ({ ...d, type: t }));
            }}
            {...a11y('type')}
          >
            <option value="">Select type</option>
            {OPPORTUNITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {msg('type')}
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
          <label htmlFor="f-comp" className={labelClass}>Compensation (as advertised)</label>
          <input id="f-comp" className={controlClass} value={data.compensation} onChange={text('compensation')} />
          {evidenceHint('compensation')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-posted-date" className={labelClass}>Posted date</label>
          <input id="f-posted-date" type="date" className={controlClass} value={data.postedDate} onChange={text('postedDate')} />
          {evidenceHint('postedDate')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <span className={labelClass}>Structured compensation (optional)</span>
          <div className="grid grid-cols-4 gap-s2 max-[640px]:grid-cols-2">
            <label className={fieldClass}>
              <span className="text-[0.78rem] text-muted">Minimum</span>
              <input aria-label="Minimum compensation" inputMode="decimal" className={controlClass} value={data.compensationDetails?.minAmount ?? ''} onChange={(event) => { updateCompensationDetails('minAmount', event.target.value); markEvidenceEdited('compensationDetails'); }} />
            </label>
            <label className={fieldClass}>
              <span className="text-[0.78rem] text-muted">Maximum</span>
              <input aria-label="Maximum compensation" inputMode="decimal" className={controlClass} value={data.compensationDetails?.maxAmount ?? ''} onChange={(event) => { updateCompensationDetails('maxAmount', event.target.value); markEvidenceEdited('compensationDetails'); }} />
            </label>
            <label className={fieldClass}>
              <span className="text-[0.78rem] text-muted">Currency</span>
              <input aria-label="Compensation currency" maxLength={3} className={controlClass} value={data.compensationDetails?.currency ?? ''} onChange={(event) => { updateCompensationDetails('currency', event.target.value.toUpperCase()); markEvidenceEdited('compensationDetails'); }} />
            </label>
            <label className={fieldClass}>
              <span className="text-[0.78rem] text-muted">Pay interval</span>
              <select aria-label="Compensation interval" className={controlClass} value={data.compensationDetails?.interval ?? ''} onChange={(event) => { updateCompensationDetails('interval', event.target.value as CompensationDetails['interval']); markEvidenceEdited('compensationDetails'); }}>
                <option value="">Unspecified</option>
                {COMPENSATION_INTERVALS.map((interval) => <option key={interval} value={interval}>{interval}</option>)}
              </select>
            </label>
          </div>
          <span className="text-[0.75rem] text-muted">Keep the original wording above. Numeric values are optional and are never guessed from the text.</span>
          {evidenceHint('compensationDetails')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-locations" className={labelClass}>Job locations</label>
          <textarea id="f-locations" rows={2} className={controlClass} value={locationInput} onChange={(event) => { setLocationInput(event.target.value); markEvidenceEdited('locations'); }} placeholder="Enter one place per line" />
          <span className="text-[0.75rem] text-muted">One location per line; first location is treated as primary.</span>
          {evidenceHint('locations')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-department" className={labelClass}>Department</label>
          <input id="f-department" className={controlClass} value={data.department} onChange={text('department')} />
          {evidenceHint('department')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-team" className={labelClass}>Team</label>
          <input id="f-team" className={controlClass} value={data.team} onChange={text('team')} />
          {evidenceHint('team')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-workplace" className={labelClass}>Workplace type</label>
          <select id="f-workplace" className={controlClass} value={data.workplaceType} onChange={(event) => { setData((current) => ({ ...current, workplaceType: event.target.value as OpportunityFormData['workplaceType'] })); markEvidenceEdited('workplaceType'); }}>
            <option value="">Unspecified</option>
            {WORKPLACE_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          {evidenceHint('workplaceType')}
        </div>
        <div className={fieldClass}>
          <label htmlFor="f-employment-type" className={labelClass}>Employer employment type</label>
          <input id="f-employment-type" className={controlClass} value={data.employmentType} onChange={text('employmentType')} placeholder="e.g. Full-time" />
          {evidenceHint('employmentType')}
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
          <label htmlFor="f-url" className={labelClass}>Opportunity URL</label>
          <input id="f-url" type="url" inputMode="url" placeholder="https://" className={controlClass} value={data.url} onChange={text('url')} {...a11y('url')} />
          {msg('url')}
        </div>
        <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
          <label htmlFor="f-desc" className={labelClass}>Description</label>
          <textarea id="f-desc" rows={3} className={controlClass} value={data.description} onChange={text('description')} />
          {evidenceHint('description')}
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
            {saving ? 'Saving…' : submitLabel ?? 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

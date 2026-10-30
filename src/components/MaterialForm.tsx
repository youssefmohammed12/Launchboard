import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  type MaterialDraft,
  type MaterialEntry,
} from '../types/opportunity';
import {
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_URL_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
  cleanMaterialDraft,
  validateMaterialDraft,
  type MaterialFormErrors,
} from '../utils/materials';

interface Props {
  /** When provided, the form edits this material; otherwise it creates one. */
  initial?: MaterialEntry;
  onSave: (draft: MaterialDraft) => void;
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

function toDraft(initial?: MaterialEntry): MaterialDraft {
  if (initial) {
    return {
      label: initial.label,
      kind: initial.kind,
      url: initial.url,
      version: initial.version,
      status: initial.status,
      notes: initial.notes,
    };
  }
  return {
    label: '',
    kind: 'Resume',
    url: '',
    version: '',
    status: 'Draft',
    notes: '',
  };
}

export function MaterialForm({ initial, onSave, onCancel }: Props) {
  const [data, setData] = useState<MaterialDraft>(() => toDraft(initial));
  const [errors, setErrors] = useState<MaterialFormErrors>({});
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  const set = <K extends keyof MaterialDraft>(key: K, value: MaterialDraft[K]) => {
    setData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found = validateMaterialDraft(data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSave(cleanMaterialDraft(data));
  };

  const a11y = (key: keyof MaterialDraft) =>
    errors[key]
      ? { 'aria-invalid': true, 'aria-describedby': `material-${key}-err` }
      : {};
  const message = (key: keyof MaterialDraft) =>
    errors[key] ? (
      <span id={`material-${key}-err`} className={errorClass} role="alert">
        {errors[key]}
      </span>
    ) : null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-labelledby="material-form-heading"
      className="grid grid-cols-2 gap-s3 rounded-card border border-accent bg-accent-soft/30 p-s3 max-[640px]:grid-cols-1"
    >
      <h4
        id="material-form-heading"
        className="col-span-2 m-0 text-[0.9rem] font-bold max-[640px]:col-span-1"
      >
        {initial ? 'Edit material' : 'Add material'}
      </h4>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="material-label" className={labelClass}>
          Label *
        </label>
        <input
          ref={labelRef}
          id="material-label"
          className={controlClass}
          maxLength={MAX_MATERIAL_LABEL_LENGTH}
          value={data.label}
          onChange={(event) => set('label', event.target.value)}
          placeholder="Frontend resume"
          {...a11y('label')}
        />
        {message('label')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="material-kind" className={labelClass}>
          Kind
        </label>
        <select
          id="material-kind"
          className={controlClass}
          value={data.kind}
          onChange={(event) => {
            const kind = MATERIAL_KINDS.find((value) => value === event.target.value);
            if (kind) set('kind', kind);
          }}
        >
          {MATERIAL_KINDS.map((kind) => (
            <option key={kind}>{kind}</option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <label htmlFor="material-status" className={labelClass}>
          Status
        </label>
        <select
          id="material-status"
          className={controlClass}
          value={data.status}
          onChange={(event) => {
            const status = MATERIAL_STATUSES.find((value) => value === event.target.value);
            if (status) set('status', status);
          }}
        >
          {MATERIAL_STATUSES.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>

      <div className={fieldClass}>
        <label htmlFor="material-version" className={labelClass}>
          Version (optional)
        </label>
        <input
          id="material-version"
          className={controlClass}
          maxLength={MAX_MATERIAL_VERSION_LENGTH}
          value={data.version}
          onChange={(event) => set('version', event.target.value)}
          placeholder="v2 or Updated October"
          {...a11y('version')}
        />
        {message('version')}
      </div>

      <div className={fieldClass}>
        <label htmlFor="material-url" className={labelClass}>
          Link (optional)
        </label>
        <input
          id="material-url"
          type="url"
          inputMode="url"
          className={controlClass}
          maxLength={MAX_MATERIAL_URL_LENGTH}
          value={data.url}
          onChange={(event) => set('url', event.target.value)}
          placeholder="https://"
          {...a11y('url')}
        />
        {message('url')}
      </div>

      <div className={`${fieldClass} col-span-2 max-[640px]:col-span-1`}>
        <label htmlFor="material-notes" className={labelClass}>
          Notes (optional)
        </label>
        <textarea
          id="material-notes"
          rows={3}
          className={controlClass}
          maxLength={MAX_MATERIAL_NOTES_LENGTH}
          value={data.notes}
          onChange={(event) => set('notes', event.target.value)}
          placeholder="What this version covers, tailoring notes, or follow-up context…"
          {...a11y('notes')}
        />
        {message('notes')}
      </div>

      <div className="col-span-2 flex justify-end gap-s2 max-[640px]:col-span-1">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className={primaryButtonClass}>
          Save material
        </button>
      </div>
    </form>
  );
}

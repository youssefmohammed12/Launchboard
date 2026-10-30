import { useRef, useState, type MouseEvent } from 'react';
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  MATERIAL_STATUSES,
  type MaterialDraft,
  type MaterialEntry,
  type MaterialKind,
  type MaterialStatus,
} from '../types/opportunity';
import { MAX_MATERIALS } from '../utils/materials';
import { detailsRecordId } from '../utils/detailsFocus';
import { SAVE_FAILURE_MESSAGE, type MutationOutcome } from '../utils/mutationMessages';
import { MaterialForm } from './MaterialForm';

interface Props {
  materials: MaterialEntry[];
  /** Returns false when the change could not be persisted. */
  onAddMaterial: (draft: MaterialDraft) => MutationOutcome;
  onUpdateMaterial: (id: string, draft: MaterialDraft) => MutationOutcome;
  onRemoveMaterial: (id: string) => MutationOutcome;
  onMaterialStatusChange: (id: string, status: MaterialStatus) => MutationOutcome;
}

type Editor = { kind: 'add' } | { kind: 'edit'; material: MaterialEntry };

const badgeBaseClass =
  'inline-block whitespace-nowrap rounded-pill px-[10px] py-[2px] text-[0.76rem] font-semibold';

const kindBadgeClass: Record<MaterialKind, string> = {
  Resume: 'bg-badge text-badge-text',
  'Cover Letter': 'bg-badge text-badge-text',
  Portfolio: 'bg-badge text-badge-text',
  Assessment: 'bg-badge text-badge-text',
  Other: 'bg-badge text-badge-text',
};

const statusBadgeClass: Record<MaterialStatus, string> = {
  Draft: 'bg-badge text-badge-text',
  Ready: 'bg-accent-soft text-accent-dark',
  Submitted: 'bg-status-applied text-status-applied-text',
  Superseded: 'bg-status-rejected text-danger',
};

const smallPrimaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-accent bg-accent px-s2 py-[5px] text-[0.8rem] font-medium text-white hover:bg-accent-dark';
const smallSecondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-border bg-surface px-s2 py-[5px] text-[0.8rem] font-medium text-text hover:border-[#c9c4b9]';
const deleteConfirmButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-danger bg-danger px-s2 py-[5px] text-[0.8rem] font-semibold text-white hover:bg-[#9c2f25]';
const removeButtonClass =
  'inline-grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-status-rejected hover:text-danger';
const statusSelectClass =
  'rounded-control border border-border bg-surface px-s2 py-[4px] text-[0.8rem] text-inherit [font:inherit]';

export function MaterialSection({
  materials,
  onAddMaterial,
  onUpdateMaterial,
  onRemoveMaterial,
  onMaterialStatusChange,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const atLimit = materials.length >= MAX_MATERIALS;

  const focusAfterUpdate = (target: HTMLElement | null) => {
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
      else addButtonRef.current?.focus();
    }, 0);
  };

  const openAdd = (event: MouseEvent<HTMLButtonElement>) => {
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({ kind: 'add' });
  };

  const openEdit = (event: MouseEvent<HTMLButtonElement>, material: MaterialEntry) => {
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({ kind: 'edit', material });
  };

  const closeEditor = () => {
    const closing = editor;
    setEditor(null);
    setSaveError(null);
    const target =
      closing?.kind === 'edit'
        ? editRefs.current.get(closing.material.id) ?? returnFocusRef.current
        : returnFocusRef.current;
    focusAfterUpdate(target);
  };

  const saveEditor = (draft: MaterialDraft) => {
    if (!editor) return;
    const saved =
      editor.kind === 'add'
        ? onAddMaterial(draft)
        : onUpdateMaterial(editor.material.id, draft);
    if (saved === false) {
      // Keep the editor mounted so the entered values survive for a retry.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    closeEditor();
  };

  const confirmDelete = (material: MaterialEntry) => {
    const saved = onRemoveMaterial(material.id);
    if (saved === false) {
      // Keep the confirmation visible so the user can retry or cancel.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    setPendingDeleteId(null);
    focusAfterUpdate(addButtonRef.current);
  };

  const changeStatus = (material: MaterialEntry, status: MaterialStatus) => {
    const saved = onMaterialStatusChange(material.id, status);
    setSaveError(saved === false ? SAVE_FAILURE_MESSAGE : null);
  };

  return (
    <section className="mt-s4 border-t border-border pt-s4" aria-labelledby="materials-heading">
      <div className="mb-s3 flex flex-wrap items-center justify-between gap-s2">
        <div className="flex items-center gap-s2">
          <h3 id="materials-heading" className="m-0">
            Application materials
          </h3>
          <span
            className="rounded-pill border border-border bg-table-head px-s2 py-0.5 text-[0.75rem] font-semibold text-muted"
            aria-label={`${materials.length} ${
              materials.length === 1 ? 'material' : 'materials'
            }`}
          >
            {materials.length}
          </span>
        </div>
        {!editor && (
          <button
            ref={addButtonRef}
            type="button"
            className={`${smallPrimaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={openAdd}
            disabled={atLimit}
            aria-describedby={atLimit ? 'material-limit' : undefined}
          >
            <Plus size={14} aria-hidden /> Add material
          </button>
        )}
      </div>

      {atLimit && !editor && (
        <p id="material-limit" className="mt-s1 mb-s3 text-[0.8rem] text-muted">
          This opportunity has reached the {MAX_MATERIALS}-material limit. Delete a material to add
          another.
        </p>
      )}

      {saveError && (
        <p
          role="alert"
          className="mt-s1 mb-s3 rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.85rem] text-danger"
        >
          {saveError}
        </p>
      )}

      {editor && (
        <div className="mb-s4">
          <MaterialForm
            key={editor.kind === 'edit' ? editor.material.id : 'new'}
            initial={editor.kind === 'edit' ? editor.material : undefined}
            onSave={saveEditor}
            onCancel={closeEditor}
          />
        </div>
      )}

      {materials.length === 0 ? (
        !editor && (
          <p className="m-0 rounded-control border border-dashed border-border p-s3 text-center text-[0.85rem] text-muted">
            No materials yet. Track resumes, cover letters, portfolios and assessments with links
            and metadata. Launchboard does not store the files themselves.
          </p>
        )
      ) : (
        <ul className="m-0 grid list-none gap-s2 p-0">
          {materials.map((material) => {
            const confirming = pendingDeleteId === material.id;

            return (
              <li
                key={material.id}
                id={detailsRecordId('material', material.id)}
                tabIndex={-1}
                className="rounded-control border border-border bg-surface p-s3"
              >
                <div className="flex flex-wrap items-center gap-s2">
                  <span className="min-w-0 font-semibold text-[0.92rem] [overflow-wrap:anywhere]">
                    {material.label}
                  </span>
                  <span className={`${badgeBaseClass} ${kindBadgeClass[material.kind]}`}>
                    {material.kind}
                  </span>
                  {material.version && (
                    <span className="text-[0.8rem] text-muted">{material.version}</span>
                  )}
                  <span className={`${badgeBaseClass} ${statusBadgeClass[material.status]}`}>
                    {material.status}
                  </span>
                </div>

                {material.url && (
                  <p className="mt-s2 mb-0 text-[0.82rem]">
                    <a
                      href={material.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open ${material.label}`}
                      className="inline-flex items-center gap-s1 font-medium"
                    >
                      <ExternalLink size={14} aria-hidden /> Open material
                    </a>
                  </p>
                )}

                {material.notes && (
                  <div className="mt-s2">
                    <p className="m-0 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                      Notes
                    </p>
                    <p className="mt-s1 mb-0 whitespace-pre-wrap text-[0.85rem] [overflow-wrap:anywhere]">
                      {material.notes}
                    </p>
                  </div>
                )}

                {confirming ? (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 rounded-control border border-status-rejected bg-status-rejected/50 p-s2">
                    <span className="text-[0.82rem]">
                      Delete this material? The record will be removed; any linked file is not
                      affected.
                    </span>
                    <button
                      type="button"
                      autoFocus
                      className={deleteConfirmButtonClass}
                      aria-label={`Delete material: ${material.label}`}
                      onClick={() => confirmDelete(material)}
                    >
                      Delete material
                    </button>
                    <button
                      type="button"
                      className={smallSecondaryButtonClass}
                      aria-label={`Keep material: ${material.label}`}
                      onClick={() => {
                        setPendingDeleteId(null);
                        setSaveError(null);
                        focusAfterUpdate(editRefs.current.get(material.id) ?? null);
                      }}
                    >
                      Keep material
                    </button>
                  </div>
                ) : (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 border-t border-border pt-s2">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) editRefs.current.set(material.id, element);
                        else editRefs.current.delete(material.id);
                      }}
                      className={smallSecondaryButtonClass}
                      aria-label={`Edit material ${material.label}`}
                      onClick={(event) => openEdit(event, material)}
                    >
                      <Pencil size={13} aria-hidden /> Edit
                    </button>
                    <label
                      htmlFor={`material-status-${material.id}`}
                      className="text-[0.78rem] text-muted"
                    >
                      Status
                    </label>
                    <select
                      id={`material-status-${material.id}`}
                      className={statusSelectClass}
                      aria-label={`Status for ${material.label}`}
                      value={material.status}
                      onChange={(event) => {
                        const status = MATERIAL_STATUSES.find(
                          (value) => value === event.target.value,
                        );
                        if (status) changeStatus(material, status);
                      }}
                    >
                      {MATERIAL_STATUSES.map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`${removeButtonClass} ml-auto`}
                      aria-label={`Delete material ${material.label}`}
                      onClick={() => setPendingDeleteId(material.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

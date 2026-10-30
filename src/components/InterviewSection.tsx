import { useRef, useState, type MouseEvent } from 'react';
import {
  Check,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import type {
  ContactEntry,
  InterviewDraft,
  InterviewEntry,
  InterviewOutcome,
  InterviewStatus,
} from '../types/opportunity';
import { contactLabel } from '../utils/contacts';
import { formatDate } from '../utils/dates';
import { detailsRecordId } from '../utils/detailsFocus';
import { MAX_INTERVIEWS, sortInterviews } from '../utils/interviews';
import { SAVE_FAILURE_MESSAGE, type MutationOutcome } from '../utils/mutationMessages';
import { InterviewForm } from './InterviewForm';

interface Props {
  interviews: InterviewEntry[];
  contacts: ContactEntry[];
  /** Returns false when the change could not be persisted. */
  onAddInterview: (draft: InterviewDraft) => MutationOutcome;
  onUpdateInterview: (id: string, draft: InterviewDraft) => MutationOutcome;
  onRemoveInterview: (id: string) => MutationOutcome;
  onInterviewStatusChange: (id: string, status: InterviewStatus) => MutationOutcome;
}

type Editor = { kind: 'add' } | { kind: 'edit'; interview: InterviewEntry };

const badgeBaseClass = 'inline-block whitespace-nowrap rounded-pill px-[10px] py-[2px] text-[0.76rem] font-semibold';

const statusBadgeClass: Record<InterviewStatus, string> = {
  Scheduled: 'bg-status-interview text-warn',
  Completed: 'bg-accent-soft text-accent-dark',
  Cancelled: 'bg-badge text-badge-text',
};

const outcomeBadgeClass: Record<InterviewOutcome, string> = {
  Positive: 'bg-accent-soft text-accent-dark',
  Negative: 'bg-status-rejected text-danger',
  'No decision': 'bg-badge text-badge-text',
};

const smallPrimaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-accent bg-accent px-s2 py-[5px] text-[0.8rem] font-medium text-white hover:bg-accent-dark';
const smallSecondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-border bg-surface px-s2 py-[5px] text-[0.8rem] font-medium text-text hover:border-[#c9c4b9]';
const deleteConfirmButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-danger bg-danger px-s2 py-[5px] text-[0.8rem] font-semibold text-white hover:bg-[#9c2f25]';
const removeButtonClass =
  'inline-grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-status-rejected hover:text-danger';

export function InterviewSection({
  interviews,
  contacts,
  onAddInterview,
  onUpdateInterview,
  onRemoveInterview,
  onInterviewStatusChange,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const sorted = sortInterviews(interviews);
  const atLimit = interviews.length >= MAX_INTERVIEWS;

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

  const openEdit = (event: MouseEvent<HTMLButtonElement>, interview: InterviewEntry) => {
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({ kind: 'edit', interview });
  };

  const openReschedule = (event: MouseEvent<HTMLButtonElement>, interview: InterviewEntry) => {
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({
      kind: 'edit',
      interview: { ...interview, status: 'Scheduled', outcome: '' },
    });
  };

  const closeEditor = () => {
    const closing = editor;
    setEditor(null);
    setSaveError(null);
    const target =
      closing?.kind === 'edit'
        ? editRefs.current.get(closing.interview.id) ?? returnFocusRef.current
        : returnFocusRef.current;
    focusAfterUpdate(target);
  };

  const saveEditor = (draft: InterviewDraft) => {
    if (!editor) return;
    const saved =
      editor.kind === 'add'
        ? onAddInterview(draft)
        : onUpdateInterview(editor.interview.id, draft);
    if (saved === false) {
      // Keep the editor mounted so the entered values survive for a retry.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    closeEditor();
  };

  const changeStatus = (interview: InterviewEntry, status: InterviewStatus) => {
    const saved = onInterviewStatusChange(interview.id, status);
    if (saved === false) {
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    focusAfterUpdate(editRefs.current.get(interview.id) ?? null);
  };

  const confirmDelete = (interview: InterviewEntry) => {
    const saved = onRemoveInterview(interview.id);
    if (saved === false) {
      // Keep the confirmation visible so the user can retry or cancel.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    setPendingDeleteId(null);
    focusAfterUpdate(addButtonRef.current);
  };

  return (
    <section className="mt-s4 border-t border-border pt-s4" aria-labelledby="interviews-heading">
      <div className="mb-s3 flex flex-wrap items-center justify-between gap-s2">
        <div className="flex items-center gap-s2">
          <h3 id="interviews-heading" className="m-0">
            Interviews
          </h3>
          <span
            className="rounded-pill border border-border bg-table-head px-s2 py-0.5 text-[0.75rem] font-semibold text-muted"
            aria-label={`${interviews.length} ${
              interviews.length === 1 ? 'interview' : 'interviews'
            }`}
          >
            {interviews.length}
          </span>
        </div>
        {!editor && (
          <button
            ref={addButtonRef}
            type="button"
            className={`${smallPrimaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={openAdd}
            disabled={atLimit}
            aria-describedby={atLimit ? 'interview-limit' : undefined}
          >
            <Plus size={14} aria-hidden /> Add interview
          </button>
        )}
      </div>

      {atLimit && !editor && (
        <p id="interview-limit" className="mt-s1 mb-s3 text-[0.8rem] text-muted">
          This opportunity has reached the {MAX_INTERVIEWS}-interview limit. Delete a round to add
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
          <InterviewForm
            key={editor.kind === 'edit' ? editor.interview.id : 'new'}
            contacts={contacts}
            initial={editor.kind === 'edit' ? editor.interview : undefined}
            onSave={saveEditor}
            onCancel={closeEditor}
          />
        </div>
      )}

      {sorted.length === 0 ? (
        !editor && (
          <p className="m-0 rounded-control border border-dashed border-border p-s3 text-center text-[0.85rem] text-muted">
            No interviews yet. Add a round to track scheduling, preparation and outcomes.
          </p>
        )
      ) : (
        <ol className="m-0 grid list-none gap-s2 p-0">
          {sorted.map((interview) => {
            const confirming = pendingDeleteId === interview.id;
            const linkedContact = contacts.find(
              (contact) => contact.id === interview.contactId,
            );
            return (
              <li
                key={interview.id}
                id={detailsRecordId('interview', interview.id)}
                tabIndex={-1}
                className="rounded-control border border-border bg-surface p-s3"
              >
                <div className="flex flex-wrap items-center gap-s2">
                  <span className="min-w-0 font-semibold text-[0.92rem] [overflow-wrap:anywhere]">
                    {interview.round}
                  </span>
                  <span className={`${badgeBaseClass} ${statusBadgeClass[interview.status]}`}>
                    {interview.status}
                  </span>
                  {interview.outcome && (
                    <span className={`${badgeBaseClass} ${outcomeBadgeClass[interview.outcome]}`}>
                      {interview.outcome}
                    </span>
                  )}
                </div>

                <p className="mt-s1 mb-0 flex flex-wrap items-center gap-x-s2 gap-y-s1 text-[0.82rem] text-muted">
                  <span>
                    {formatDate(interview.date)}
                    {interview.time ? ` at ${interview.time}` : ''}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{interview.mode}</span>
                </p>

                {linkedContact && (
                  <p className="mt-s1 mb-0 text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                    Contact: <span className="font-medium text-text">{contactLabel(linkedContact)}</span>
                  </p>
                )}

                {(interview.meetingUrl || interview.location) && (
                  <p className="mt-s1 mb-0 flex flex-wrap items-center gap-x-s3 gap-y-s1 text-[0.82rem]">
                    {interview.meetingUrl && (
                      <a
                        href={interview.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Meeting link for ${interview.round}`}
                        className="inline-flex items-center gap-s1 font-medium"
                      >
                        <Video size={14} aria-hidden /> Join meeting
                      </a>
                    )}
                    {interview.location && (
                      <span className="inline-flex items-center gap-s1 text-muted [overflow-wrap:anywhere]">
                        <MapPin size={14} aria-hidden /> {interview.location}
                      </span>
                    )}
                  </p>
                )}

                {interview.preparationNotes && (
                  <div className="mt-s2">
                    <p className="m-0 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                      Preparation
                    </p>
                    <p className="mt-s1 mb-0 whitespace-pre-wrap text-[0.85rem] [overflow-wrap:anywhere]">
                      {interview.preparationNotes}
                    </p>
                  </div>
                )}

                {interview.notes && (
                  <div className="mt-s2">
                    <p className="m-0 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                      Notes
                    </p>
                    <p className="mt-s1 mb-0 whitespace-pre-wrap text-[0.85rem] [overflow-wrap:anywhere]">
                      {interview.notes}
                    </p>
                  </div>
                )}

                {confirming ? (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 rounded-control border border-status-rejected bg-status-rejected/50 p-s2">
                    <span className="text-[0.82rem]">
                      Delete this interview? It will be removed from the opportunity&apos;s history.
                    </span>
                    <button
                      type="button"
                      autoFocus
                      className={deleteConfirmButtonClass}
                      aria-label={`Delete interview: ${interview.round}`}
                      onClick={() => confirmDelete(interview)}
                    >
                      Delete interview
                    </button>
                    <button
                      type="button"
                      className={smallSecondaryButtonClass}
                      aria-label={`Keep interview: ${interview.round}`}
                      onClick={() => {
                        setPendingDeleteId(null);
                        setSaveError(null);
                        focusAfterUpdate(editRefs.current.get(interview.id) ?? null);
                      }}
                    >
                      Keep interview
                    </button>
                  </div>
                ) : (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 border-t border-border pt-s2">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) editRefs.current.set(interview.id, element);
                        else editRefs.current.delete(interview.id);
                      }}
                      className={smallSecondaryButtonClass}
                      aria-label={`Edit ${interview.round}`}
                      onClick={(event) => openEdit(event, interview)}
                    >
                      <Pencil size={13} aria-hidden /> Edit
                    </button>

                    {interview.status === 'Scheduled' && (
                      <>
                        <button
                          type="button"
                          className={smallPrimaryButtonClass}
                          aria-label={`Mark completed: ${interview.round}`}
                          onClick={() => changeStatus(interview, 'Completed')}
                        >
                          <Check size={13} aria-hidden /> Mark completed
                        </button>
                        <button
                          type="button"
                          className={smallSecondaryButtonClass}
                          aria-label={`Cancel interview: ${interview.round}`}
                          onClick={() => changeStatus(interview, 'Cancelled')}
                        >
                          <X size={13} aria-hidden /> Cancel interview
                        </button>
                      </>
                    )}

                    {interview.status === 'Cancelled' && (
                      <button
                        type="button"
                        className={smallSecondaryButtonClass}
                        aria-label={`Reschedule: ${interview.round}`}
                        onClick={(event) => openReschedule(event, interview)}
                      >
                        <RotateCcw size={13} aria-hidden /> Reschedule
                      </button>
                    )}

                    {interview.status === 'Completed' && !interview.outcome && (
                      <button
                        type="button"
                        className={smallSecondaryButtonClass}
                        aria-label={`Record outcome for ${interview.round}`}
                        onClick={(event) => openEdit(event, interview)}
                      >
                        Record outcome
                      </button>
                    )}

                    <button
                      type="button"
                      className={`${removeButtonClass} ml-auto`}
                      aria-label={`Delete ${interview.round}`}
                      onClick={() => setPendingDeleteId(interview.id)}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

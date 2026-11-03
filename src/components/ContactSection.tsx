import { useRef, useState, type MouseEvent } from 'react';
import { Globe, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import type {
  ContactDraft,
  ContactEntry,
  InterviewEntry,
} from '../types/opportunity';
import { MAX_CONTACTS } from '../utils/contacts';
import { detailsRecordId } from '../utils/detailsFocus';
import { SAVE_FAILURE_MESSAGE, type MutationOutcome } from '../utils/mutationMessages';
import { ContactForm } from './ContactForm';

interface Props {
  contacts: ContactEntry[];
  /** Used only to explain interview links when deleting a contact. */
  interviews: InterviewEntry[];
  /** Returns false when the change could not be persisted. */
  onAddContact: (draft: ContactDraft) => MutationOutcome;
  onUpdateContact: (id: string, draft: ContactDraft) => MutationOutcome;
  onRemoveContact: (id: string) => MutationOutcome;
}

type Editor = { kind: 'add' } | { kind: 'edit'; contact: ContactEntry };

const smallPrimaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-accent bg-accent px-s2 py-[5px] text-[0.8rem] font-medium text-white hover:bg-accent-dark';
const smallSecondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-border bg-surface px-s2 py-[5px] text-[0.8rem] font-medium text-text hover:border-[#c9c4b9]';
const deleteConfirmButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-danger bg-danger px-s2 py-[5px] text-[0.8rem] font-semibold text-white hover:bg-[#9c2f25]';
const removeButtonClass =
  'inline-grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-status-rejected hover:text-danger';
const metaLinkClass =
  'inline-flex min-w-0 items-center gap-s1 font-medium [overflow-wrap:anywhere]';

function telHref(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  return /\d/.test(digits) ? `tel:${digits}` : null;
}

export function ContactSection({
  contacts,
  interviews,
  onAddContact,
  onUpdateContact,
  onRemoveContact,
}: Props) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const editRefs = useRef(new Map<string, HTMLButtonElement>());
  const atLimit = contacts.length >= MAX_CONTACTS;

  const focusAfterUpdate = (target: HTMLElement | null) => {
    window.setTimeout(() => {
      if (target?.isConnected) target.focus();
      else addButtonRef.current?.focus();
    }, 0);
  };

  const openAdd = (event: MouseEvent<HTMLButtonElement>) => {
    if (busy) return;
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({ kind: 'add' });
  };

  const openEdit = (event: MouseEvent<HTMLButtonElement>, contact: ContactEntry) => {
    if (busy) return;
    returnFocusRef.current = event.currentTarget;
    setPendingDeleteId(null);
    setSaveError(null);
    setEditor({ kind: 'edit', contact });
  };

  const closeEditor = () => {
    const closing = editor;
    setEditor(null);
    setSaveError(null);
    const target =
      closing?.kind === 'edit'
        ? editRefs.current.get(closing.contact.id) ?? returnFocusRef.current
        : returnFocusRef.current;
    focusAfterUpdate(target);
  };

  const finishSave = (saved: boolean | void) => {
    if (saved === false) {
      // Keep the editor mounted so entered values survive for a retry.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    closeEditor();
  };

  const saveEditor = (draft: ContactDraft) => {
    if (!editor || busy) return;
    try {
      const result = editor.kind === 'add'
        ? onAddContact(draft)
        : onUpdateContact(editor.contact.id, draft);
      if (result instanceof Promise) {
        setBusy(true);
        void result
          .then(finishSave)
          .catch(() => setSaveError(SAVE_FAILURE_MESSAGE))
          .finally(() => setBusy(false));
      } else {
        finishSave(result);
      }
    } catch {
      setSaveError(SAVE_FAILURE_MESSAGE);
    }
  };

  const finishDelete = (saved: boolean | void) => {
    if (saved === false) {
      // Keep the confirmation visible so the user can retry or cancel.
      setSaveError(SAVE_FAILURE_MESSAGE);
      return;
    }
    setSaveError(null);
    setPendingDeleteId(null);
    focusAfterUpdate(addButtonRef.current);
  };

  const confirmDelete = (contact: ContactEntry) => {
    if (busy) return;
    try {
      const result = onRemoveContact(contact.id);
      if (result instanceof Promise) {
        setBusy(true);
        void result
          .then(finishDelete)
          .catch(() => setSaveError(SAVE_FAILURE_MESSAGE))
          .finally(() => setBusy(false));
      } else {
        finishDelete(result);
      }
    } catch {
      setSaveError(SAVE_FAILURE_MESSAGE);
    }
  };

  return (
    <section className="mt-s4 border-t border-border pt-s4" aria-labelledby="contacts-heading">
      <div className="mb-s3 flex flex-wrap items-center justify-between gap-s2">
        <div className="flex items-center gap-s2">
          <h3 id="contacts-heading" className="m-0">
            Contacts
          </h3>
          <span
            className="rounded-pill border border-border bg-table-head px-s2 py-0.5 text-[0.75rem] font-semibold text-muted"
            aria-label={`${contacts.length} ${contacts.length === 1 ? 'contact' : 'contacts'}`}
          >
            {contacts.length}
          </span>
        </div>
        {!editor && (
          <button
            ref={addButtonRef}
            type="button"
            className={`${smallPrimaryButtonClass} disabled:cursor-not-allowed disabled:opacity-60`}
            onClick={openAdd}
            disabled={atLimit || busy}
            aria-describedby={atLimit ? 'contact-limit' : undefined}
          >
            <Plus size={14} aria-hidden /> Add contact
          </button>
        )}
      </div>

      {atLimit && !editor && (
        <p id="contact-limit" className="mt-s1 mb-s3 text-[0.8rem] text-muted">
          This opportunity has reached the {MAX_CONTACTS}-contact limit. Delete a contact to add
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
          <ContactForm
            key={editor.kind === 'edit' ? editor.contact.id : 'new'}
            initial={editor.kind === 'edit' ? editor.contact : undefined}
            onSave={saveEditor}
            onCancel={closeEditor}
            busy={busy}
          />
        </div>
      )}

      {contacts.length === 0 ? (
        !editor && (
          <p className="m-0 rounded-control border border-dashed border-border p-s3 text-center text-[0.85rem] text-muted">
            No contacts yet. Add the people involved, such as recruiters, hiring managers or
            referrals, and link them to interview rounds.
          </p>
        )
      ) : (
        <ul className="m-0 grid list-none gap-s2 p-0">
          {contacts.map((contact) => {
            const confirming = pendingDeleteId === contact.id;
            const linkedInterviews = interviews.filter(
              (interview) => interview.contactId === contact.id,
            ).length;
            const phoneHref = telHref(contact.phone);

            return (
              <li
                key={contact.id}
                id={detailsRecordId('contact', contact.id)}
                tabIndex={-1}
                className="rounded-control border border-border bg-surface p-s3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-s2 gap-y-s1">
                    <span className="font-semibold text-[0.92rem] [overflow-wrap:anywhere]">
                      {contact.name}
                    </span>
                    {contact.role && (
                      <span className="text-[0.82rem] text-muted [overflow-wrap:anywhere]">
                        {contact.role}
                      </span>
                    )}
                  </div>

                  {(contact.email || contact.phone || contact.website) && (
                    <div className="mt-s2 flex flex-wrap gap-x-s4 gap-y-s1 text-[0.82rem]">
                      {contact.email && (
                        <a
                          href={`mailto:${contact.email}`}
                          className={metaLinkClass}
                          aria-label={`Email ${contact.name}`}
                        >
                          <Mail size={14} aria-hidden className="shrink-0" />
                          {contact.email}
                        </a>
                      )}
                      {contact.phone &&
                        (phoneHref ? (
                          <a
                            href={phoneHref}
                            className={metaLinkClass}
                            aria-label={`Call ${contact.name}`}
                          >
                            <Phone size={14} aria-hidden className="shrink-0" />
                            {contact.phone}
                          </a>
                        ) : (
                          <span className="inline-flex min-w-0 items-center gap-s1 text-muted">
                            <Phone size={14} aria-hidden className="shrink-0" />
                            {contact.phone}
                          </span>
                        ))}
                      {contact.website && (
                        <a
                          href={contact.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={metaLinkClass}
                          aria-label={`Website for ${contact.name}`}
                        >
                          <Globe size={14} aria-hidden className="shrink-0" />
                          {contact.website}
                        </a>
                      )}
                    </div>
                  )}

                  {contact.notes && (
                    <div className="mt-s2">
                      <p className="m-0 text-[0.75rem] font-medium uppercase tracking-[0.04em] text-muted">
                        Notes
                      </p>
                      <p className="mt-s1 mb-0 whitespace-pre-wrap text-[0.85rem] [overflow-wrap:anywhere]">
                        {contact.notes}
                      </p>
                    </div>
                  )}

                  {linkedInterviews > 0 && (
                    <p className="mt-s2 mb-0 text-[0.8rem] text-muted">
                      Linked to {linkedInterviews}{' '}
                      {linkedInterviews === 1 ? 'interview' : 'interviews'}.
                    </p>
                  )}
                </div>

                {confirming ? (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 rounded-control border border-status-rejected bg-status-rejected/50 p-s2">
                    <span className="text-[0.82rem]">
                      {linkedInterviews > 0
                        ? `This contact is linked to ${linkedInterviews} ${
                            linkedInterviews === 1 ? 'interview' : 'interviews'
                          }. Deleting the contact will clear ${
                            linkedInterviews === 1 ? 'that link' : 'those links'
                          } but keep the interview records.`
                        : 'Delete this contact?'}
                    </span>
                    <button
                      type="button"
                      autoFocus
                      className={deleteConfirmButtonClass}
                      aria-label={`Delete contact: ${contact.name}`}
                      disabled={busy}
                      onClick={() => confirmDelete(contact)}
                    >
                      Delete contact
                    </button>
                    <button
                      type="button"
                      className={smallSecondaryButtonClass}
                      aria-label={`Keep contact: ${contact.name}`}
                      disabled={busy}
                      onClick={() => {
                        setPendingDeleteId(null);
                        setSaveError(null);
                        focusAfterUpdate(editRefs.current.get(contact.id) ?? null);
                      }}
                    >
                      Keep contact
                    </button>
                  </div>
                ) : (
                  <div className="mt-s3 flex flex-wrap items-center gap-s2 border-t border-border pt-s2">
                    <button
                      type="button"
                      ref={(element) => {
                        if (element) editRefs.current.set(contact.id, element);
                        else editRefs.current.delete(contact.id);
                      }}
                      className={smallSecondaryButtonClass}
                      aria-label={`Edit contact ${contact.name}`}
                      disabled={busy}
                      onClick={(event) => openEdit(event, contact)}
                    >
                      <Pencil size={13} aria-hidden /> Edit
                    </button>
                    <button
                      type="button"
                      className={`${removeButtonClass} ml-auto`}
                      aria-label={`Delete contact ${contact.name}`}
                      disabled={busy}
                      onClick={() => setPendingDeleteId(contact.id)}
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

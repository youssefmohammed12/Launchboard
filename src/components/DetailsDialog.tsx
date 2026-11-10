import { useEffect, useState, type FormEvent } from 'react';
import { Archive, History, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  SYSTEM_ACTIVITY_TYPE,
  USER_ACTIVITY_TYPES,
  type ActivityDraft,
  type ContactDraft,
  type InterviewDraft,
  type InterviewStatus,
  type MaterialDraft,
  type MaterialStatus,
  type Opportunity,
  type UserActivityType,
} from '../types/opportunity';
import { isArchived, type ArchiveOperationResult } from '../utils/archive';
import { formatDate, isValidISODate, toISODate } from '../utils/dates';
import { detailsRecordId, type DetailsFocusTarget } from '../utils/detailsFocus';
import { sortActivities } from '../utils/activities';
import { SAVE_FAILURE_MESSAGE, type MutationOutcome } from '../utils/mutationMessages';
import {
  ArchivedBadge,
  DeadlineBadge,
  DemoTag,
  FollowUpBadge,
  PriorityBadge,
  StatusBadge,
  TagList,
} from './Badges';
import { normalizeWorkplaceDetails } from '../utils/opportunities';
import { Modal } from './Modal';
import { ContactSection } from './ContactSection';
import { InterviewSection } from './InterviewSection';
import { MaterialSection } from './MaterialSection';

interface Props {
  item: Opportunity;
  /** The control that opened this dialog, recorded explicitly for focus restore. */
  opener?: HTMLElement | null;
  /** Id of the element to focus when the opener is gone. */
  fallbackFocusId?: string;
  /**
   * A nested record to focus after opening, used when the dialog was opened
   * from a global-search result. The record is identified by its stable ID.
   */
  focusTarget?: DetailsFocusTarget | null;
  onEdit: () => void;
  onClose: () => void;
  /** Persists archive/restore before the app updates its collection. */
  onArchive: (id: string) => ArchiveOperationResult | Promise<ArchiveOperationResult>;
  onRestore: (id: string) => ArchiveOperationResult | Promise<ArchiveOperationResult>;
  onAddActivity: (id: string, data: ActivityDraft) => MutationOutcome;
  onRemoveActivity: (id: string, activityId: string) => MutationOutcome;
  onAddInterview: (id: string, data: InterviewDraft) => MutationOutcome;
  onUpdateInterview: (id: string, interviewId: string, data: InterviewDraft) => MutationOutcome;
  onRemoveInterview: (id: string, interviewId: string) => MutationOutcome;
  onInterviewStatusChange: (
    id: string,
    interviewId: string,
    status: InterviewStatus,
  ) => MutationOutcome;
  onAddContact: (id: string, data: ContactDraft) => MutationOutcome;
  onUpdateContact: (id: string, contactId: string, data: ContactDraft) => MutationOutcome;
  onRemoveContact: (id: string, contactId: string) => MutationOutcome;
  onAddMaterial: (id: string, data: MaterialDraft) => MutationOutcome;
  onUpdateMaterial: (id: string, materialId: string, data: MaterialDraft) => MutationOutcome;
  onRemoveMaterial: (id: string, materialId: string) => MutationOutcome;
  onMaterialStatusChange: (
    id: string,
    materialId: string,
    status: MaterialStatus,
  ) => MutationOutcome;
}

const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s4 py-[9px] font-medium text-text hover:border-[#c9c4b9]';
const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark';
const smallPrimaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s1 rounded-control border border-accent bg-accent px-s3 py-[6px] text-[0.85rem] font-medium text-white hover:bg-accent-dark';
const smallSecondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-border bg-surface px-s2 py-[5px] text-[0.8rem] font-medium text-text hover:border-[#c9c4b9]';
const confirmRemoveButtonClass =
  'inline-flex cursor-pointer items-center justify-center rounded-control border border-danger bg-danger px-s2 py-[5px] text-[0.8rem] font-semibold text-white hover:bg-[#9c2f25]';
const removeButtonClass =
  'inline-grid h-[28px] w-[28px] shrink-0 cursor-pointer place-items-center rounded-control border-0 bg-transparent text-muted hover:bg-status-rejected hover:text-danger';
const dtClass = 'm-0 text-[0.78rem] uppercase tracking-[0.04em] text-muted';

function formatCompensationAmount(value: string): string {
  const [whole = '', fraction] = value.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction ? grouped + '.' + fraction : grouped;
}
const ddClass = 'm-0 [overflow-wrap:anywhere]';
const activityControlClass =
  'w-full rounded-control border border-border bg-surface px-s3 py-[8px] text-inherit [font:inherit] [&[aria-invalid]]:border-danger';
const activityFieldClass = 'grid items-start gap-s1';
const activityLabelClass = 'font-semibold text-[0.82rem]';
const activityErrorClass = 'text-[0.8rem] text-danger';

interface ActivityErrors {
  type?: string;
  date?: string;
  note?: string;
}

export function DetailsDialog({
  item,
  opener,
  fallbackFocusId,
  focusTarget,
  onEdit,
  onClose,
  onArchive,
  onRestore,
  onAddActivity,
  onRemoveActivity,
  onAddInterview,
  onUpdateInterview,
  onRemoveInterview,
  onInterviewStatusChange,
  onAddContact,
  onUpdateContact,
  onRemoveContact,
  onAddMaterial,
  onUpdateMaterial,
  onRemoveMaterial,
  onMaterialStatusChange,
}: Props) {
  const [activityType, setActivityType] = useState<UserActivityType | ''>('');
  const [activityDate, setActivityDate] = useState(() => toISODate(new Date()));
  const [activityNote, setActivityNote] = useState('');
  const [activityErrors, setActivityErrors] = useState<ActivityErrors>({});
  const [activitySaveError, setActivitySaveError] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [archiveFeedback, setArchiveFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [activityBusy, setActivityBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const archived = isArchived(item);
  const focusId = focusTarget ? detailsRecordId(focusTarget.category, focusTarget.id) : undefined;

  // Modal focuses the target synchronously; this scrolls it into view for
  // nested records that are below the dialog's initial viewport.
  useEffect(() => {
    if (!focusId) return;
    const target = document.getElementById(focusId);
    target?.scrollIntoView?.({ block: 'center' });
  }, [focusId]);

  const handleArchiveToggle = async () => {
    if (archiveBusy) return;
    setArchiveBusy(true);
    try {
      const result = await (archived ? onRestore(item.id) : onArchive(item.id));
      setArchiveFeedback({ kind: result.ok ? 'success' : 'error', message: result.message });
    } catch {
      setArchiveFeedback({
        kind: 'error',
        message: 'The archive change could not be saved. Please refresh and try again.',
      });
    } finally {
      setArchiveBusy(false);
    }
  };

  const structuredSalary = item.compensationDetails
    ? [
        item.compensationDetails.minAmount && item.compensationDetails.maxAmount
          ? formatCompensationAmount(item.compensationDetails.minAmount) + '–' +
            formatCompensationAmount(item.compensationDetails.maxAmount)
          : formatCompensationAmount(item.compensationDetails.minAmount || item.compensationDetails.maxAmount),
        item.compensationDetails.currency,
        item.compensationDetails.interval ? '/' + item.compensationDetails.interval : '',
      ].filter(Boolean).join(' ')
    : '';
  const workplaceDetails = normalizeWorkplaceDetails(item);
  const rows: [string, string][] = [
    ['Company', item.company],
    ['Employment type', workplaceDetails.employmentType || item.type || '—'],
    ['Work mode', workplaceDetails.workplaceType || '—'],
    ['Locations', workplaceDetails.locations.join(' · ') || '—'],
    ['Department', item.department || '—'],
    ['Team', item.team || '—'],
    ['Posted date', item.postedDate ? formatDate(item.postedDate) : '—'],
    ['Deadline', formatDate(item.deadline)],
    ['Compensation', item.compensation || structuredSalary || '—'],
    ...(item.compensation && structuredSalary ? [['Structured salary', structuredSalary] as [string, string]] : []),
  ];
  const activities = sortActivities(item.activities);

  const handleAddActivity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activityBusy) return;
    const nextErrors: ActivityErrors = {};
    if (!activityType) nextErrors.type = 'Choose an activity type.';
    if (!isValidISODate(activityDate)) nextErrors.date = 'Choose a valid activity date.';
    if (activityNote.length > 500) nextErrors.note = 'Notes must be 500 characters or fewer.';
    setActivityErrors(nextErrors);
    if (nextErrors.type || nextErrors.date || nextErrors.note || !activityType) return;

    setActivityBusy(true);
    try {
      const saved = await onAddActivity(item.id, {
        type: activityType,
        date: activityDate,
        note: activityNote.trim(),
      });
      if (saved === false) {
        // Keep the typed values so the activity can be retried.
        setActivitySaveError(SAVE_FAILURE_MESSAGE);
        return;
      }
      setActivitySaveError(null);
      setActivityType('');
      setActivityDate(toISODate(new Date()));
      setActivityNote('');
      setActivityErrors({});
    } catch {
      setActivitySaveError(SAVE_FAILURE_MESSAGE);
    } finally {
      setActivityBusy(false);
    }
  };

  const handleRemoveActivity = async (activityId: string) => {
    if (activityBusy) return;
    setActivityBusy(true);
    try {
      const saved = await onRemoveActivity(item.id, activityId);
      if (saved === false) {
        // Keep the confirmation visible so the removal can be retried.
        setActivitySaveError(SAVE_FAILURE_MESSAGE);
        return;
      }
      setActivitySaveError(null);
      setPendingRemoveId(null);
    } catch {
      setActivitySaveError(SAVE_FAILURE_MESSAGE);
    } finally {
      setActivityBusy(false);
    }
  };

  return (
    <Modal title={item.title} onClose={onClose} opener={opener} fallbackFocusId={fallbackFocusId} initialFocusId={focusId}>
      <div className="px-s5 pt-s4 pb-s5">
        <div className="mb-s3 flex flex-wrap gap-s2">
          <PriorityBadge priority={item.priority} />
          <StatusBadge status={item.status} />
          {item.status !== 'Rejected' && item.status !== 'Offer' && <DeadlineBadge deadline={item.deadline} />}
          {archived && <ArchivedBadge />}
          {item.isDemo && <DemoTag />}
        </div>
        {item.tags.length > 0 && (
          <div className="mb-s4">
            <p className={dtClass}>Tags</p>
            <TagList tags={item.tags} className="mt-s1" />
          </div>
        )}
        <dl className="m-0 grid grid-cols-2 gap-s3 max-[640px]:grid-cols-1">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className={dtClass}>{k}</dt>
              <dd className={ddClass}>{v}</dd>
            </div>
          ))}
          <div>
            <dt className={dtClass}>Follow-up</dt>
            <dd className={ddClass}>
              <span className="inline-flex flex-wrap items-center gap-s2">
                {item.followUpDate ? formatDate(item.followUpDate) : '—'}
                {item.followUpDate && <FollowUpBadge date={item.followUpDate} />}
              </span>
            </dd>
          </div>
          <div>
            <dt className={dtClass}>Application link</dt>
            <dd className={ddClass}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.url}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <h3>Description</h3>
        <p>{item.description || 'No description.'}</p>
        <h3>Notes</h3>
        <p>{item.notes || 'No notes.'}</p>

        <ContactSection
          contacts={item.contacts}
          interviews={item.interviews}
          onAddContact={(draft) => onAddContact(item.id, draft)}
          onUpdateContact={(contactId, draft) => onUpdateContact(item.id, contactId, draft)}
          onRemoveContact={(contactId) => onRemoveContact(item.id, contactId)}
        />

        <InterviewSection
          interviews={item.interviews}
          contacts={item.contacts}
          onAddInterview={(draft) => onAddInterview(item.id, draft)}
          onUpdateInterview={(interviewId, draft) =>
            onUpdateInterview(item.id, interviewId, draft)
          }
          onRemoveInterview={(interviewId) => onRemoveInterview(item.id, interviewId)}
          onInterviewStatusChange={(interviewId, status) =>
            onInterviewStatusChange(item.id, interviewId, status)
          }
        />

        <MaterialSection
          materials={item.materials}
          onAddMaterial={(draft) => onAddMaterial(item.id, draft)}
          onUpdateMaterial={(materialId, draft) =>
            onUpdateMaterial(item.id, materialId, draft)
          }
          onRemoveMaterial={(materialId) => onRemoveMaterial(item.id, materialId)}
          onMaterialStatusChange={(materialId, status) =>
            onMaterialStatusChange(item.id, materialId, status)
          }
        />

        <section className="mt-s4 border-t border-border pt-s4" aria-labelledby="activity-heading">
          <h3 id="activity-heading">Activity timeline</h3>
          <form
            className="mb-s4 grid grid-cols-2 gap-s3 rounded-card border border-border bg-table-head p-s3 max-[640px]:grid-cols-1"
            onSubmit={handleAddActivity}
            noValidate
          >
            <div className={activityFieldClass}>
              <label htmlFor="activity-type" className={activityLabelClass}>Activity type</label>
              <select
                id="activity-type"
                className={activityControlClass}
                value={activityType}
                onChange={(event) => {
                  const next = USER_ACTIVITY_TYPES.find((type) => type === event.target.value);
                  setActivityType(next ?? '');
                }}
                aria-invalid={activityErrors.type ? true : undefined}
                aria-describedby={activityErrors.type ? 'activity-type-err' : undefined}
              >
                <option value="">Select type</option>
                {USER_ACTIVITY_TYPES.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
              {activityErrors.type && (
                <span id="activity-type-err" className={activityErrorClass} role="alert">
                  {activityErrors.type}
                </span>
              )}
            </div>
            <div className={activityFieldClass}>
              <label htmlFor="activity-date" className={activityLabelClass}>Activity date</label>
              <input
                id="activity-date"
                type="date"
                className={activityControlClass}
                value={activityDate}
                onChange={(event) => setActivityDate(event.target.value)}
                aria-invalid={activityErrors.date ? true : undefined}
                aria-describedby={activityErrors.date ? 'activity-date-err' : undefined}
              />
              {activityErrors.date && (
                <span id="activity-date-err" className={activityErrorClass} role="alert">
                  {activityErrors.date}
                </span>
              )}
            </div>
            <div className={`${activityFieldClass} col-span-2 max-[640px]:col-span-1`}>
              <label htmlFor="activity-note" className={activityLabelClass}>Note (optional)</label>
              <textarea
                id="activity-note"
                rows={2}
                maxLength={500}
                className={activityControlClass}
                value={activityNote}
                onChange={(event) => setActivityNote(event.target.value)}
                aria-invalid={activityErrors.note ? true : undefined}
                aria-describedby={activityErrors.note ? 'activity-note-help activity-note-err' : 'activity-note-help'}
              />
              <span id="activity-note-help" className="text-[0.78rem] text-muted">
                {activityNote.length}/500 characters
              </span>
              {activityErrors.note && (
                <span id="activity-note-err" className={activityErrorClass} role="alert">
                  {activityErrors.note}
                </span>
              )}
            </div>
            <div className="col-span-2 flex justify-end max-[640px]:col-span-1">
              <button type="submit" className={smallPrimaryButtonClass} disabled={activityBusy}>
                <Plus size={14} aria-hidden /> {activityBusy ? 'Saving…' : 'Add Activity'}
              </button>
            </div>
          </form>

          {activitySaveError && (
            <p
              role="alert"
              className="mt-s1 mb-s3 rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.85rem] text-danger"
            >
              {activitySaveError}
            </p>
          )}

          {activities.length === 0 ? (
            <p className="m-0 rounded-control border border-dashed border-border p-s3 text-center text-[0.85rem] text-muted">
              No updates recorded yet. Scheduled follow-ups and interviews are shown in their sections above.
            </p>
          ) : (
            <ol className="m-0 grid list-none gap-s2 p-0">
              {activities.map((activity) => {
                const isSystem = activity.type === SYSTEM_ACTIVITY_TYPE;
                const confirming = pendingRemoveId === activity.id;
                return (
                  <li
                    key={activity.id}
                    id={detailsRecordId('activity', activity.id)}
                    tabIndex={-1}
                    className={`rounded-control border p-s3 ${
                      isSystem ? 'border-accent bg-accent-soft/40' : 'border-border bg-surface'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-s2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-s2">
                          {isSystem && <History size={14} aria-hidden className="text-accent-dark" />}
                          <span className="font-semibold text-[0.9rem]">{activity.type}</span>
                          <span className="text-[0.78rem] text-muted">{formatDate(activity.date)}</span>
                          {isSystem && (
                            <span className="rounded-pill bg-surface px-s2 py-0.5 text-[0.72rem] font-semibold text-accent-dark">
                              Automatic
                            </span>
                          )}
                        </div>
                        {activity.note && (
                          <p className="mt-s1 mb-0 whitespace-pre-wrap text-[0.88rem] [overflow-wrap:anywhere]">
                            {activity.note}
                          </p>
                        )}
                      </div>
                      {!isSystem && !confirming && (
                        <button
                          type="button"
                          className={removeButtonClass}
                          aria-label={`Remove ${activity.type} activity from ${formatDate(activity.date)}`}
                          onClick={() => setPendingRemoveId(activity.id)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      )}
                    </div>
                    {confirming && !isSystem && (
                      <div className="mt-s2 flex flex-wrap items-center gap-s2 rounded-control border border-status-rejected bg-status-rejected/50 p-s2">
                        <span className="text-[0.82rem]">Remove this activity?</span>
                        <button
                          type="button"
                          className={confirmRemoveButtonClass}
                          disabled={activityBusy}
                          onClick={() => void handleRemoveActivity(activity.id)}
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          className={smallSecondaryButtonClass}
                          onClick={() => {
                            setPendingRemoveId(null);
                            setActivitySaveError(null);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {archiveFeedback && (
          <p
            className={`mb-0 mt-s4 rounded-control border px-s3 py-s2 text-[0.85rem] ${
              archiveFeedback.kind === 'error'
                ? 'border-danger bg-status-rejected text-danger'
                : 'border-accent bg-accent-soft text-accent-dark'
            }`}
            role={archiveFeedback.kind === 'error' ? 'alert' : 'status'}
          >
            {archiveFeedback.message}
          </p>
        )}

        <div className="mt-s4 flex flex-wrap justify-end gap-s2">
          <button type="button" className={secondaryButtonClass} onClick={() => void handleArchiveToggle()} disabled={archiveBusy || activityBusy}>
            {archived ? (
              <>
                <RotateCcw size={16} aria-hidden /> Restore
              </>
            ) : (
              <>
                <Archive size={16} aria-hidden /> Archive
              </>
            )}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Close
          </button>
          <button type="button" className={primaryButtonClass} onClick={onEdit}>
            <Pencil size={16} aria-hidden /> Edit
          </button>
        </div>
      </div>
    </Modal>
  );
}

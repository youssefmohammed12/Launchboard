import { useEffect, useRef, useState } from 'react';
import ApiModeApp from './ApiModeApp';
import {
  addOpportunityTask,
  completeOpportunityTask,
  deleteOpportunityTask,
  reopenOpportunityTask,
  updateOpportunityTask,
  type TaskDraft,
} from '@launchboard/domain';
import {
  SYSTEM_ACTIVITY_TYPE,
  type ActivityDraft,
  type ContactDraft,
  type InterviewDraft,
  type InterviewStatus,
  type MaterialDraft,
  type MaterialStatus,
  type Opportunity,
  type OpportunityFormData,
  type OpportunityStatus,
  type View,
} from './types/opportunity';
import { createStatusChangeEntry } from './utils/activities';
import {
  archiveOpportunity,
  isArchived,
  restoreOpportunity,
  type ArchiveOperationResult,
} from './utils/archive';
import {
  addContact,
  clearInterviewContactReferences,
  removeContact,
  resolveContactId,
  updateContact,
} from './utils/contacts';
import {
  addMaterial,
  removeMaterial,
  setMaterialStatus,
  updateMaterial,
} from './utils/materials';
import {
  addInterview,
  removeInterview,
  setInterviewStatus,
  updateInterview,
} from './utils/interviews';
import {
  commitBackupImport,
  type ImportMode,
  type ParsedBackup,
  type RestoreOutcome,
} from './utils/backup';
import { createId } from './utils/id';
import { toISODate } from './utils/dates';
import { commitLocalTaskMutation, type TaskCollectionMutation } from './data/taskOperations';
import { SAVE_FAILURE_MESSAGE } from './utils/mutationMessages';
import { downloadRecoveryPayload } from './utils/exports';
import { resolveBulkDeleteTargets } from './utils/opportunities';
import type { DetailsFocusTarget } from './utils/detailsFocus';
import type { GlobalSearchResult } from './utils/globalSearch';
import {
  UNDO_WINDOW_MS,
  applyUndo,
  createArchiveUndoEntry,
  createBatchArchiveUndoEntry,
  createBatchDeleteUndoEntry,
  createDeleteUndoEntry,
  describeUndoAction,
  opportunityCount,
  type UndoEntry,
} from './utils/undo';
import { Sidebar } from './components/Sidebar';
import { WhatsNewButton, WhatsNewDialog } from './components/WhatsNew';
import { OpportunityForm } from './components/OpportunityForm';
import { QuickCapture } from './components/QuickCapture';
import { DetailsDialog } from './components/DetailsDialog';
import { GlobalSearchDialog } from './components/GlobalSearchDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { RestoreBackupDialog } from './components/RestoreBackupDialog';
import { RecoveryNotice } from './components/RecoveryNotice';
import { UndoBar } from './components/UndoBar';
import { useOpportunities } from './hooks/useOpportunities';
import { Dashboard } from './pages/Dashboard';
import { Opportunities } from './pages/Opportunities';
import { Calendar } from './pages/Calendar';
import { Deadlines } from './pages/Deadlines';
import { Reports } from './pages/Reports';
import { ActionCenter, type TaskFocusTarget } from './pages/ActionCenter';

// Only one dialog is open at a time.
type Dialog =
  | { kind: 'none' }
  | { kind: 'search' }
  | { kind: 'form'; item?: Opportunity; quickCapture?: boolean }
  | { kind: 'details'; item: Opportunity; focusTarget?: DetailsFocusTarget | null }
  | { kind: 'delete'; item: Opportunity }
  | { kind: 'restore' }
  | { kind: 'bulk-archive'; ids: string[] }
  | { kind: 'bulk-restore'; ids: string[] }
  | { kind: 'bulk-status'; ids: string[]; status: OpportunityStatus }
  | { kind: 'bulk-delete'; ids: string[]; archiveView: 'active' | 'archived' };

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

const ARCHIVE_SAVE_ERROR =
  'The archive change could not be saved to this browser. The opportunity was not changed. Check available storage and browser settings, then try again.';

const DELETE_SAVE_ERROR =
  'The deletion could not be saved to this browser. The opportunity was not changed. Check available storage and browser settings, then try again.';

const UNDO_SAVE_ERROR =
  'The undo could not be saved to this browser. Your current records were not changed. Check available storage and browser settings, then try again.';

const BULK_ARCHIVE_SAVE_ERROR =
  'The bulk archive could not be saved to this browser. No opportunities were changed. Check available storage and browser settings, then try again.';

const BULK_RESTORE_SAVE_ERROR =
  'The bulk restore could not be saved to this browser. No opportunities were changed. Check available storage and browser settings, then try again.';

const BULK_STATUS_SAVE_ERROR =
  'The bulk status change could not be saved to this browser. No opportunities were changed. Check available storage and browser settings, then try again.';

const BULK_DELETE_SAVE_ERROR =
  'The bulk delete could not be saved to this browser. No opportunities were deleted. Check available storage and browser settings, then try again.';

const BULK_DELETE_STALE_ERROR =
  'The selected opportunities changed, so this batch could not be deleted safely. Nothing was deleted. Review the current selection and try again.';

interface ArchiveNotice {
  kind: 'success' | 'error';
  message: string;
}

function LocalStorageApp() {
  const [view, setView] = useState<View>('dashboard');
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewOpener, setWhatsNewOpener] = useState<HTMLElement | null>(null);
  const [pendingTaskFocus, setPendingTaskFocus] = useState<TaskFocusTarget | null>(null);
  const {
    items,
    recovery,
    commitCandidate,
    retryPreservation,
    replaceRecovery,
    removeRecovery,
  } = useOpportunities();
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [recoveryDownloadError, setRecoveryDownloadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  /** Latest dialog kind, read by the global shortcut without re-binding it. */
  const dialogRef = useRef<Dialog>(dialog);
  dialogRef.current = dialog;
  /**
   * The control that opened the current dialog.
   *
   * It is recorded explicitly because some browsers (WebKit) move focus to
   * <body> as soon as a button is clicked, so document.activeElement cannot
   * be trusted to identify the trigger.
   */
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<ArchiveNotice | null>(null);
  /**
   * One-level Undo metadata, held in memory only. It is intentionally not
   * persisted: reloading the page ends the Undo opportunity, while the
   * completed action stays in localStorage.
   */
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  /** Bumped after a failed Undo so a safe retry gets a fresh time window. */
  const [undoAttempt, setUndoAttempt] = useState(0);
  /**
   * Bumped only after a bulk operation commits. The Opportunities page watches
   * it and clears the selection then; a failed write leaves the selection so the
   * user can retry.
   */
  const [selectionResetToken, setSelectionResetToken] = useState(0);
  /** Guards against a second submission while a bulk commit is in progress. */
  const bulkBusyRef = useRef(false);

  const clearUndo = () => {
    setUndoEntry(null);
    setUndoError(null);
  };

  useEffect(() => {
    if (!undoEntry) return;
    const timer = setTimeout(() => {
      setUndoEntry(null);
      setUndoError(null);
    }, UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undoEntry, undoAttempt]);

  const handleDownloadRecovery = () => {
    if (!recovery.recoveryCopy) return;
    try {
      downloadRecoveryPayload(recovery.recoveryCopy);
      setRecoveryDownloadError(null);
    } catch {
      setRecoveryDownloadError(
        'The recovery copy could not be downloaded. Check your browser settings and try again.',
      );
    }
  };

  const handleDownloadPrimary = () => {
    if (!recovery.primaryRaw) return;
    try {
      downloadRecoveryPayload(recovery.primaryRaw, 'unreadable-primary');
      setRecoveryDownloadError(null);
    } catch {
      setRecoveryDownloadError(
        'The current saved data could not be downloaded. Check your browser settings and try again.',
      );
    }
  };

  const handleRetryPreservation = () => {
    const result = retryPreservation();
    if (result.ok) setRecoveryDownloadError(null);
    document.getElementById('recovery-notice')?.focus();
  };

  const handleReplaceRecovery = () => {
    const result = replaceRecovery();
    if (result.ok) setRecoveryDownloadError(null);
    document.getElementById('recovery-notice')?.focus();
  };

  const handleRemoveRecovery = () => {
    const result = removeRecovery();
    if (result.ok) setRecoveryDownloadError(null);
    if (result.ok) {
      document.getElementById('main-content')?.focus();
    } else {
      document.getElementById('recovery-notice')?.focus();
    }
  };

  /**
   * Persists the complete candidate collection before exposing it to React.
   * A failed write leaves both the visible collection and any pending Undo
   * entry untouched, so callers can keep the editor open and offer a retry.
   */
  const commit = (next: Opportunity[]): boolean => {
    if (!commitCandidate(next)) return false;

    // A further successful collection change makes the pending Undo snapshot
    // unsafe, so the conservative policy invalidates it here. The hook never
    // touches Undo; that remains an application decision.
    clearUndo();
    return true;
  };

  /**
   * Updates one record and keeps an open Details dialog in sync with the new
   * value, so activity changes appear immediately without reopening the dialog.
   * Returns false without changing state when the write fails.
   */
  const updateItem = (
    id: string,
    update: (item: Opportunity) => Opportunity,
  ): boolean => {
    const next = items.map((o) => (o.id === id ? update(o) : o));
    if (!commit(next)) return false;

    if (dialog.kind === 'details' && dialog.item.id === id) {
      const updated = next.find((o) => o.id === id);
      if (updated) setDialog({ ...dialog, item: updated });
    }
    return true;
  };

  const close = () => setDialog({ kind: 'none' });
  const navigate = (next: View) => {
    setView(next);
    setArchiveNotice(null);
  };
  const openTaskInActionCenter = (opportunityId: string, taskId: string) => {
    setPendingTaskFocus({ opportunityId, taskId });
    navigate('action-center');
  };
  // The trigger is stored explicitly so focus can be restored to it later.
  const openDetails = (item: Opportunity, trigger?: HTMLElement | null) => {
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'details', item });
  };
  const openForm = (item?: Opportunity, trigger?: HTMLElement | null) => {
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'form', item });
  };
  /**
   * Details -> edit keeps the original opener, so closing the form returns
   * focus to the row that was clicked, not to the (now removed) Edit button.
   */
  const openEditFromDetails = () => {
    if (dialog.kind === 'details') setDialog({ kind: 'form', item: dialog.item });
  };
  const openAdd = (trigger?: HTMLElement | null) => openForm(undefined, trigger);
  const openQuickCapture = (trigger?: HTMLElement | null) => {
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'form', quickCapture: true });
  };
  const openWhatsNew = (trigger: HTMLElement) => {
    setWhatsNewOpener(trigger);
    setWhatsNewOpen(true);
  };
  const openEdit = (item: Opportunity, trigger?: HTMLElement | null) => openForm(item, trigger);
  const openDelete = (item: Opportunity, trigger?: HTMLElement | null) => {
    setOpener(trigger ?? null);
    setDialog({ kind: 'delete', item });
  };
  const openRestore = (trigger?: HTMLElement | null) => {
    setImportStatus(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'restore' });
  };

  /**
   * Global search is another single-dialog variant. Its opener is recorded so
   * closing the search (or the Details dialog it leads to) returns focus to
   * the control that started the flow.
   */
  const openSearch = (trigger?: HTMLElement | null) => {
    setArchiveNotice(null);
    const active = document.activeElement;
    setOpener(
      trigger ??
        (active instanceof HTMLElement && active !== document.body ? active : null),
    );
    setDialog({ kind: 'search' });
  };

  /** Replaces search with the existing Details dialog; never stacks dialogs. */
  const openSearchResult = (result: GlobalSearchResult) => {
    const item = items.find((o) => o.id === result.opportunityId);
    if (!item) return;
    const focusTarget: DetailsFocusTarget | null =
      result.childId && result.category !== 'opportunity'
        ? { category: result.category, id: result.childId }
        : null;
    setArchiveNotice(null);
    setDialog({ kind: 'details', item, focusTarget });
  };

  /**
   * One global Ctrl/Cmd+K listener. It is registered once; the current dialog
   * is read through a ref, and the handler declines while the user is typing
   * or while any modal is open.
   */
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      if (dialogRef.current.kind !== 'none') return;
      if (document.querySelector('dialog[open]')) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      event.preventDefault();
      const active = document.activeElement;
      openSearch(active instanceof HTMLElement && active !== document.body ? active : null);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  /**
   * Bulk actions follow the same single-dialog convention as every other
   * action: the page asks, the app validates and opens one confirmation, and
   * only the confirmation commits anything.
   */
  const openBulkArchive = (ids: string[], trigger?: HTMLElement | null) => {
    if (ids.length === 0) return;
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'bulk-archive', ids });
  };

  const openBulkRestore = (ids: string[], trigger?: HTMLElement | null) => {
    if (ids.length === 0) return;
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'bulk-restore', ids });
  };

  const openBulkStatus = (
    ids: string[],
    status: OpportunityStatus,
    trigger?: HTMLElement | null,
  ) => {
    if (ids.length === 0) return;
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'bulk-status', ids, status });
  };

  const openBulkDelete = (
    ids: string[],
    archiveView: 'active' | 'archived',
    trigger?: HTMLElement | null,
  ) => {
    if (ids.length === 0) return;
    setArchiveNotice(null);
    setOpener(trigger ?? null);
    setDialog({ kind: 'bulk-delete', ids, archiveView });
  };

  /**
   * Restore is transactional: the candidate collection is written first, and
   * React state changes only after that write succeeds. A failed write leaves
   * both the visible records and localStorage exactly as they were.
   */
  const handleRestoreBackup = (backup: ParsedBackup, mode: ImportMode): RestoreOutcome => {
    const result = commitBackupImport(items, backup, mode, commitCandidate);
    if (!result.ok) return { ok: false, message: result.message };

    // The imported collection is authoritative: any earlier Undo snapshot may
    // now conflict with it, so it is discarded even though the import was not
    // itself an undoable action.
    clearUndo();
    const skipped =
      result.plan.skippedExisting + backup.invalidRecords + backup.duplicateRecords;
    const base =
      mode === 'merge'
        ? `Import complete. Added ${countLabel(result.plan.added, 'record')}.`
        : `Restore complete. ${countLabel(result.plan.finalCount, 'record')} now stored.`;
    setImportStatus(
      skipped > 0 ? `${base} ${countLabel(skipped, 'backup record')} skipped.` : base,
    );
    close();
    return { ok: true };
  };

  const handleSave = (data: OpportunityFormData): boolean => {
    let candidate: Opportunity[];

    if (dialog.kind === 'form' && dialog.item) {
      const edited = dialog.item;
      const current = items.find((o) => o.id === edited.id) ?? edited;
      // Editing a demo record turns it into the user's own record.
      const activities =
        data.status !== current.status
          ? [
              ...current.activities,
              createStatusChangeEntry(current.status, data.status, createId()),
            ]
          : current.activities;
      candidate = items.map((o) =>
        o.id === current.id
          ? {
              ...data,
              id: current.id,
              // The core form never owns archive state, so an edit must not
              // silently reactivate an archived opportunity.
              ...(current.archivedAt ? { archivedAt: current.archivedAt } : {}),
              activities,
              interviews: current.interviews,
              contacts: current.contacts,
              materials: current.materials,
              tasks: current.tasks,
            }
          : o,
      );
    } else {
      candidate = [
        ...items,
        {
          ...data,
          id: createId(),
          activities: [],
          interviews: [],
          contacts: [],
          materials: [],
          tasks: [],
        },
      ];
    }

    if (!commit(candidate)) return false;
    close();
    return true;
  };

  /**
   * Delete is transactional like archive/restore: the candidate collection is
   * persisted first. Only a confirmed, successful deletion creates the Undo
   * entry; a failed write leaves the record and the previous Undo state alone.
   * The confirmation dialog remains the required first step.
   */
  const handleDelete = (id: string) => {
    const index = items.findIndex((o) => o.id === id);
    if (index === -1) {
      close();
      return;
    }

    const current = items[index];
    const candidate = items.filter((o) => o.id !== id);
    if (!commitCandidate(candidate)) {
      setArchiveNotice({ kind: 'error', message: DELETE_SAVE_ERROR });
      close();
      return;
    }

    setArchiveNotice(null);
    setUndoError(null);
    setUndoEntry(createDeleteUndoEntry(current, index));
    close();
  };

  /**
   * Bulk commits are synchronous and follow the same transactional order as
   * every other mutation: validate, build a candidate, write once, then update
   * React state. A failed write leaves data and selection untouched.
   */
  const runBulkCommit = (commitAction: () => void) => {
    if (bulkBusyRef.current) return;
    bulkBusyRef.current = true;
    try {
      commitAction();
    } finally {
      bulkBusyRef.current = false;
    }
  };

  /** Clears the selection through the page's token and closes the dialog. */
  const finishBulk = () => {
    setSelectionResetToken((token) => token + 1);
    close();
  };

  const confirmBulkArchive = () => {
    if (dialog.kind !== 'bulk-archive') return;
    runBulkCommit(() => {
      const ids = new Set(dialog.ids);
      const targets = items.filter((item) => ids.has(item.id) && !isArchived(item));
      if (targets.length === 0) {
        setArchiveNotice({
          kind: 'error',
          message: 'No selected opportunities can be archived. Nothing was changed.',
        });
        close();
        return;
      }

      // One timestamp for the whole batch keeps the operation a single,
      // coherent transition. Only archive metadata changes.
      const archivedAt = new Date().toISOString();
      const updatedById = new Map(
        targets.map((item) => [item.id, archiveOpportunity(item, archivedAt)]),
      );
      const candidate = items.map((item) => updatedById.get(item.id) ?? item);

      if (!commitCandidate(candidate)) {
        setArchiveNotice({ kind: 'error', message: BULK_ARCHIVE_SAVE_ERROR });
        close();
        return;
      }

      const updated = targets.map((item) => updatedById.get(item.id) as Opportunity);
      // The Undo notification is the success announcement, matching the
      // single-record archive flow.
      setArchiveNotice(null);
      setUndoError(null);
      setUndoEntry(createBatchArchiveUndoEntry(targets, updated));
      finishBulk();
    });
  };

  const confirmBulkRestore = () => {
    if (dialog.kind !== 'bulk-restore') return;
    runBulkCommit(() => {
      const ids = new Set(dialog.ids);
      const targets = items.filter((item) => ids.has(item.id) && isArchived(item));
      if (targets.length === 0) {
        setArchiveNotice({
          kind: 'error',
          message: 'No selected opportunities can be restored. Nothing was changed.',
        });
        close();
        return;
      }

      const updatedById = new Map(
        targets.map((item) => [item.id, restoreOpportunity(item)]),
      );
      const candidate = items.map((item) => updatedById.get(item.id) ?? item);

      if (!commitCandidate(candidate)) {
        setArchiveNotice({ kind: 'error', message: BULK_RESTORE_SAVE_ERROR });
        close();
        return;
      }

      const updated = targets.map((item) => updatedById.get(item.id) as Opportunity);
      setArchiveNotice(null);
      setUndoError(null);
      setUndoEntry(createBatchArchiveUndoEntry(targets, updated));
      finishBulk();
    });
  };

  const confirmBulkStatus = () => {
    if (dialog.kind !== 'bulk-status') return;
    const status = dialog.status;
    runBulkCommit(() => {
      const ids = new Set(dialog.ids);
      // Archived records are never bulk-status targets, even if a stale ID
      // somehow reaches the dialog.
      const targets = items.filter((item) => ids.has(item.id) && !isArchived(item));
      if (targets.length === 0) {
        setArchiveNotice({
          kind: 'error',
          message: 'No selected opportunities can change status. Nothing was changed.',
        });
        close();
        return;
      }

      const changing = targets.filter((item) => item.status !== status);
      const already = targets.length - changing.length;

      if (changing.length === 0) {
        setArchiveNotice({
          kind: 'success',
          message: `No status changes were needed. ${opportunityCount(already)} already ${
            already === 1 ? 'has' : 'have'
          } status ${status}.`,
        });
        close();
        return;
      }

      // Reuse the individual status-change helper for each record that really
      // changes, so automatic history stays identical to the single workflow.
      const updatedById = new Map(
        changing.map((item) => [
          item.id,
          {
            ...item,
            status,
            activities: [
              ...item.activities,
              createStatusChangeEntry(item.status, status, createId()),
            ],
          },
        ]),
      );
      const candidate = items.map((item) => updatedById.get(item.id) ?? item);

      if (!commitCandidate(candidate)) {
        setArchiveNotice({ kind: 'error', message: BULK_STATUS_SAVE_ERROR });
        close();
        return;
      }

      // A successful status mutation invalidates a pending Undo, matching the
      // existing individual status-change policy.
      clearUndo();
      setArchiveNotice({
        kind: 'success',
        message: `Updated ${opportunityCount(changing.length)} to ${status}.${
          already > 0 ? ` ${opportunityCount(already)} already had that status.` : ''
        }`,
      });
      finishBulk();
    });
  };

  /**
   * Bulk delete is transactional like every other mutation: the exact confirmed
   * batch is revalidated, a candidate collection is written once, and only then
   * are React state, the selection and the batch Undo entry updated. A failed
   * write changes nothing and keeps both the selection and any previous Undo.
   */
  const confirmBulkDelete = () => {
    if (dialog.kind !== 'bulk-delete') return;
    const { ids, archiveView } = dialog;
    runBulkCommit(() => {
      const resolved = resolveBulkDeleteTargets(items, ids, archiveView);
      if (!resolved.ok) {
        setArchiveNotice({ kind: 'error', message: BULK_DELETE_STALE_ERROR });
        close();
        return;
      }

      const deletedIds = new Set(resolved.targets.map((item) => item.id));
      const candidate = items.filter((item) => !deletedIds.has(item.id));

      if (!commitCandidate(candidate)) {
        setArchiveNotice({ kind: 'error', message: BULK_DELETE_SAVE_ERROR });
        close();
        return;
      }

      // Snapshots are captured from the still-unchanged collection only after
      // the write succeeded, so a failed delete never creates an Undo entry.
      setUndoEntry(createBatchDeleteUndoEntry(items, deletedIds));
      // The Undo notification is the success announcement, matching the
      // single-record delete flow.
      setArchiveNotice(null);
      setUndoError(null);
      finishBulk();
    });
  };

  /**
   * Archive/restore is transactional like backup restore: the candidate
   * collection is written first, and React state changes only after that write
   * succeeds. A failed write leaves the previous archive state untouched.
   */
  const applyArchiveChange = (id: string, archived: boolean): ArchiveOperationResult => {
    const current = items.find((o) => o.id === id);
    if (!current) {
      return { ok: false, message: 'That opportunity could not be found.' };
    }

    if (isArchived(current) === archived) {
      return {
        ok: true,
        message: archived
          ? `“${current.title}” is already archived.`
          : `“${current.title}” is already active.`,
      };
    }

    const updated = archived ? archiveOpportunity(current) : restoreOpportunity(current);
    const candidate = items.map((o) => (o.id === id ? updated : o));

    if (!commitCandidate(candidate)) {
      setArchiveNotice({ kind: 'error', message: ARCHIVE_SAVE_ERROR });
      return { ok: false, message: ARCHIVE_SAVE_ERROR };
    }

    const message = archived
      ? `Archived “${current.title}”. It is available in the Archived view.`
      : `Restored “${current.title}”. It is available in the Active view.`;
    // The Undo notification carries the app-level success announcement for a
    // real state change; the Details dialog keeps showing its inline feedback.
    setArchiveNotice(null);
    setUndoError(null);
    setUndoEntry(createArchiveUndoEntry(current, updated));

    // Keep the open Details dialog on the same opportunity identity so the
    // archive badge and Archive/Restore action update immediately.
    if (dialog.kind === 'details' && dialog.item.id === id) {
      setDialog({ ...dialog, item: updated });
    }

    return { ok: true, message };
  };

  /**
   * Undo is transactional: validate the in-memory entry against the current
   * collection, build a candidate, persist it, then update React state. A
   * failed write changes nothing and keeps a safe entry available for retry.
   */
  const handleUndo = () => {
    if (!undoEntry) return;

    const result = applyUndo(items, undoEntry);
    if (!result.ok) {
      // The entry can never succeed now, so it is removed; the reason stays
      // visible in the notification until the user dismisses it.
      setUndoEntry(null);
      setUndoError(result.message);
      return;
    }

    if (!commitCandidate(result.items)) {
      setUndoError(UNDO_SAVE_ERROR);
      // Restart the window so a retry is still reachable.
      setUndoAttempt((attempt) => attempt + 1);
      return;
    }

    setUndoEntry(null);
    setUndoError(null);
    setArchiveNotice({ kind: 'success', message: result.message });

    if (dialog.kind === 'details') {
      const updated = result.items.find((o) => o.id === dialog.item.id);
      if (updated) setDialog({ ...dialog, item: updated });
    }
  };

  const handleStatusChange = (id: string, status: OpportunityStatus): boolean => {
    const item = items.find((o) => o.id === id);
    if (!item) return false;
    if (item.status === status) return true;

    const saved = updateItem(id, (current) => ({
      ...current,
      status,
      activities: [
        ...current.activities,
        createStatusChangeEntry(current.status, status, createId()),
      ],
    }));
    if (!saved) {
      setArchiveNotice({ kind: 'error', message: SAVE_FAILURE_MESSAGE });
      return false;
    }

    // Clear a previous write failure without discarding a success message
    // from an archive, restore, delete or bulk operation.
    setArchiveNotice((current) => (current?.kind === 'error' ? null : current));
    return true;
  };

  const handleAddActivity = (id: string, data: ActivityDraft): boolean => {
    if (data.type === SYSTEM_ACTIVITY_TYPE) return true;
    return updateItem(id, (item) => ({
      ...item,
      activities: [...item.activities, { ...data, id: createId() }],
    }));
  };

  const handleRemoveActivity = (id: string, activityId: string): boolean => {
    return updateItem(id, (item) => {
      const target = item.activities.find((activity) => activity.id === activityId);
      if (!target || target.type === SYSTEM_ACTIVITY_TYPE) return item;
      return {
        ...item,
        activities: item.activities.filter((activity) => activity.id !== activityId),
      };
    });
  };

  const handleAddInterview = (id: string, data: InterviewDraft): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      interviews: addInterview(
        item.interviews,
        { ...data, contactId: resolveContactId(data.contactId, item.contacts) },
        createId(),
      ),
    }));
  };

  const handleUpdateInterview = (
    id: string,
    interviewId: string,
    data: InterviewDraft,
  ): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      interviews: updateInterview(item.interviews, interviewId, {
        ...data,
        contactId: resolveContactId(data.contactId, item.contacts),
      }),
    }));
  };

  const handleRemoveInterview = (id: string, interviewId: string): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      interviews: removeInterview(item.interviews, interviewId),
    }));
  };

  const handleInterviewStatus = (
    id: string,
    interviewId: string,
    status: InterviewStatus,
  ): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      interviews: setInterviewStatus(item.interviews, interviewId, status),
    }));
  };

  const handleAddContact = (id: string, data: ContactDraft): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      contacts: addContact(item.contacts, data, createId()),
    }));
  };

  const handleUpdateContact = (
    id: string,
    contactId: string,
    data: ContactDraft,
  ): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      contacts: updateContact(item.contacts, contactId, data),
    }));
  };

  /**
   * Deleting a contact removes the relationship from its interviews but never
   * removes the interviews themselves or changes the opportunity status.
   */
  const handleRemoveContact = (id: string, contactId: string): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      contacts: removeContact(item.contacts, contactId),
      interviews: clearInterviewContactReferences(item.interviews, contactId),
    }));
  };

  const handleAddMaterial = (id: string, data: MaterialDraft): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      materials: addMaterial(item.materials, data, createId()),
    }));
  };

  const handleUpdateMaterial = (
    id: string,
    materialId: string,
    data: MaterialDraft,
  ): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      materials: updateMaterial(item.materials, materialId, data),
    }));
  };

  const handleRemoveMaterial = (id: string, materialId: string): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      materials: removeMaterial(item.materials, materialId),
    }));
  };

  const handleMaterialStatus = (
    id: string,
    materialId: string,
    status: MaterialStatus,
  ): boolean => {
    return updateItem(id, (item) => ({
      ...item,
      materials: setMaterialStatus(item.materials, materialId, status),
    }));
  };

  const runLocalTaskMutation = async (
    opportunityId: string,
    mutate: TaskCollectionMutation,
  ): Promise<boolean> => {
    const result = commitLocalTaskMutation(items, opportunityId, mutate, commit);
    if (!result.ok) {
      const message = result.issues?.[0]?.message ?? (
        result.reason === 'limit-reached'
          ? 'This opportunity already has the maximum of 100 tasks.'
          : result.reason === 'save-failed'
            ? SAVE_FAILURE_MESSAGE
            : result.reason === 'opportunity-not-found'
              ? 'This opportunity is no longer available. Refresh the workspace and try again.'
              : 'The task could not be changed. Review it and try again.'
      );
      setArchiveNotice({ kind: 'error', message });
      return false;
    }
    setArchiveNotice(null);
    return true;
  };

  const handleCreateTask = (opportunityId: string, draft: TaskDraft) =>
    runLocalTaskMutation(opportunityId, (tasks) => addOpportunityTask(tasks, draft, createId()));

  const handleUpdateTask = (opportunityId: string, taskId: string, draft: TaskDraft) =>
    runLocalTaskMutation(opportunityId, (tasks) => updateOpportunityTask(tasks, taskId, draft));

  const handleCompleteTask = (opportunityId: string, taskId: string) =>
    runLocalTaskMutation(opportunityId, (tasks) =>
      completeOpportunityTask(tasks, taskId, toISODate(new Date())),
    );

  const handleReopenTask = (opportunityId: string, taskId: string) =>
    runLocalTaskMutation(opportunityId, (tasks) => reopenOpportunityTask(tasks, taskId));

  const handleDeleteTask = (opportunityId: string, taskId: string) =>
    runLocalTaskMutation(opportunityId, (tasks) => deleteOpportunityTask(tasks, taskId));

  // Confirmation copy must describe the records that are still eligible at
  // render time, not just the IDs the page sent.
  const bulkArchiveTargets =
    dialog.kind === 'bulk-archive'
      ? items.filter((item) => dialog.ids.includes(item.id) && !isArchived(item))
      : [];
  const bulkRestoreTargets =
    dialog.kind === 'bulk-restore'
      ? items.filter((item) => dialog.ids.includes(item.id) && isArchived(item))
      : [];
  const bulkStatusTargets =
    dialog.kind === 'bulk-status'
      ? items.filter((item) => dialog.ids.includes(item.id) && !isArchived(item))
      : [];
  const bulkStatusChanging =
    dialog.kind === 'bulk-status'
      ? bulkStatusTargets.filter((item) => item.status !== dialog.status).length
      : 0;
  // Revalidated on every render so the confirmation always describes the exact
  // batch that is still eligible right now.
  const bulkDeleteResolution =
    dialog.kind === 'bulk-delete'
      ? resolveBulkDeleteTargets(items, dialog.ids, dialog.archiveView)
      : null;
  const bulkDeleteTargets = bulkDeleteResolution?.ok ? bulkDeleteResolution.targets : [];

  return (
    <div className="lb-app-shell">
      <Sidebar current={view} onNavigate={navigate} onSearch={openSearch} />
      <div className="lb-main-area">
        <header className="lb-topbar">
          <div className="lb-topbar-copy">
            <span className="lb-eyebrow">LOCAL WORKSPACE</span>
            <span className="lb-topbar-title">Keep track of every next step</span>
          </div>
          <div className="lb-topbar-actions">
            <span className="lb-sync-state">
              <span className="lb-sync-dot" aria-hidden="true" />
              Saved in this browser
            </span>
            <WhatsNewButton onOpen={openWhatsNew} />
            <button
              type="button"
              className="lb-topbar-quick-capture-button"
              aria-label="Quick Capture"
              data-feature-spotlight="quick-capture"
              onClick={(event) => openQuickCapture(event.currentTarget)}
            >
              <span className="lb-topbar-quick-capture-full-label">Quick Capture</span>
              <span className="lb-topbar-quick-capture-short-label">Capture</span>
            </button>
          </div>
        </header>
        <main className="lb-local-content" id="main-content" tabIndex={-1}>
        {recovery.kind !== 'none' && !recoveryDismissed && (
          <RecoveryNotice
            state={recovery}
            downloadError={recoveryDownloadError}
            onDownloadRecovery={handleDownloadRecovery}
            onDownloadPrimary={handleDownloadPrimary}
            onRetryPreservation={handleRetryPreservation}
            onReplaceRecovery={handleReplaceRecovery}
            onRemoveRecovery={handleRemoveRecovery}
            onDismiss={() => setRecoveryDismissed(true)}
          />
        )}
        {archiveNotice && (
          <div
            className={`mb-s4 rounded-control border px-s4 py-s3 text-[0.88rem] ${
              archiveNotice.kind === 'error'
                ? 'border-danger bg-status-rejected text-danger'
                : 'border-accent bg-accent-soft text-accent-dark'
            }`}
            role={archiveNotice.kind === 'error' ? 'alert' : 'status'}
            aria-atomic="true"
          >
            {archiveNotice.message}
          </div>
        )}
        {importStatus && (
          <div
            className="mb-s4 rounded-control border border-accent bg-accent-soft px-s4 py-s3 text-[0.88rem] text-accent-dark"
            role="status"
            aria-atomic="true"
          >
            {importStatus}
          </div>
        )}
        {view === 'dashboard' && (
          <Dashboard
            items={items}
            onAdd={openAdd}
            onOpen={openDetails}
            onOpenTask={openTaskInActionCenter}
            onOpenActionCenter={() => navigate('action-center')}
            onOpenCalendar={() => navigate('calendar')}
          />
        )}
        {view === 'opportunities' && (
          <Opportunities
            items={items}
            onAdd={openAdd}
            onOpen={openDetails}
            onEdit={openEdit}
            onDelete={openDelete}
            onStatusChange={handleStatusChange}
            selectionResetToken={selectionResetToken}
            onBulkArchive={openBulkArchive}
            onBulkRestore={openBulkRestore}
            onBulkStatus={openBulkStatus}
            onBulkDelete={openBulkDelete}
          />
        )}
        {view === 'action-center' && (
          <ActionCenter
            items={items}
            focusTaskTarget={pendingTaskFocus}
            onTaskFocusHandled={() => setPendingTaskFocus(null)}
            error={archiveNotice?.kind === 'error' ? archiveNotice.message : null}
            onOpen={openDetails}
            onCreate={handleCreateTask}
            onUpdate={handleUpdateTask}
            onComplete={handleCompleteTask}
            onReopen={handleReopenTask}
            onDelete={handleDeleteTask}
          />
        )}
        {view === 'calendar' && <Calendar items={items} onOpen={openDetails} onOpenTask={openTaskInActionCenter} />}
        {view === 'deadlines' && <Deadlines items={items} onOpen={openDetails} />}
        {view === 'reports' && (
          <Reports items={items} onOpen={openDetails} onRestoreBackup={openRestore} />
        )}
        </main>
      </div>

      {(undoEntry || undoError) && (
        <UndoBar
          message={undoEntry ? describeUndoAction(undoEntry) : null}
          canUndo={undoEntry !== null}
          error={undoError}
          onUndo={handleUndo}
          onDismiss={clearUndo}
          fallbackFocusId="main-content"
        />
      )}

      {dialog.kind === 'form' && (dialog.quickCapture ? (
        <QuickCapture
          mode="local"
          opener={opener}
          fallbackFocusId="main-content"
          existingOpportunities={items}
          onSave={handleSave}
          onCancel={close}
        />
      ) : (
        <OpportunityForm
          initial={dialog.item}
          opener={opener}
          fallbackFocusId="main-content"
          onSave={handleSave}
          onCancel={close}
        />
      ))}
      {dialog.kind === 'search' && (
        <GlobalSearchDialog
          items={items}
          opener={opener}
          onClose={close}
          onSelect={openSearchResult}
        />
      )}
      {dialog.kind === 'details' && (
        <DetailsDialog
          item={dialog.item}
          opener={opener}
          fallbackFocusId="main-content"
          focusTarget={dialog.focusTarget}
          onClose={close}
          onEdit={openEditFromDetails}
          onArchive={(id) => applyArchiveChange(id, true)}
          onRestore={(id) => applyArchiveChange(id, false)}
          onAddActivity={handleAddActivity}
          onRemoveActivity={handleRemoveActivity}
          onAddInterview={handleAddInterview}
          onUpdateInterview={handleUpdateInterview}
          onRemoveInterview={handleRemoveInterview}
          onInterviewStatusChange={handleInterviewStatus}
          onAddContact={handleAddContact}
          onUpdateContact={handleUpdateContact}
          onRemoveContact={handleRemoveContact}
          onAddMaterial={handleAddMaterial}
          onUpdateMaterial={handleUpdateMaterial}
          onRemoveMaterial={handleRemoveMaterial}
          onMaterialStatusChange={handleMaterialStatus}
        />
      )}
      {dialog.kind === 'delete' && (
        <ConfirmDialog
          title="Delete opportunity"
          message={`Delete “${dialog.item.title}”? You can undo this for 10 seconds.`}
          confirmLabel="Delete"
          opener={opener}
          fallbackFocusId="main-content"
          onCancel={close}
          onConfirm={() => handleDelete(dialog.item.id)}
        />
      )}
      {dialog.kind === 'bulk-archive' && (
        <ConfirmDialog
          title="Archive selected opportunities"
          message={
            bulkArchiveTargets.length === 0
              ? 'These opportunities are no longer available. Nothing will be changed.'
              : `Archive ${opportunityCount(bulkArchiveTargets.length)}? ${
                  bulkArchiveTargets.length === 1 ? 'It' : 'They'
                } will move to Archived and can be restored.`
          }
          confirmLabel={`Archive ${bulkArchiveTargets.length}`}
          opener={opener}
          fallbackFocusId="main-content"
          onCancel={close}
          onConfirm={confirmBulkArchive}
        />
      )}
      {dialog.kind === 'bulk-restore' && (
        <ConfirmDialog
          title="Restore selected opportunities"
          message={
            bulkRestoreTargets.length === 0
              ? 'These opportunities are no longer available. Nothing will be changed.'
              : `Restore ${opportunityCount(bulkRestoreTargets.length)}? ${
                  bulkRestoreTargets.length === 1 ? 'It' : 'They'
                } will move back to Active.`
          }
          confirmLabel={`Restore ${bulkRestoreTargets.length}`}
          opener={opener}
          fallbackFocusId="main-content"
          onCancel={close}
          onConfirm={confirmBulkRestore}
        />
      )}
      {dialog.kind === 'bulk-status' && (
        <ConfirmDialog
          title="Change status for selected opportunities"
          message={
            bulkStatusChanging === 0
              ? 'No selected opportunities need this status. Nothing will be changed.'
              : `Change ${opportunityCount(bulkStatusChanging)} to ${dialog.status}?${
                  bulkStatusTargets.length > bulkStatusChanging
                    ? ` ${opportunityCount(
                        bulkStatusTargets.length - bulkStatusChanging,
                      )} already ${
                        bulkStatusTargets.length - bulkStatusChanging === 1 ? 'has' : 'have'
                      } that status and will not be changed.`
                    : ''
                }`
          }
          confirmLabel={`Change to ${dialog.status}`}
          opener={opener}
          fallbackFocusId="main-content"
          onCancel={close}
          onConfirm={confirmBulkStatus}
        />
      )}
      {dialog.kind === 'bulk-delete' && (
        <ConfirmDialog
          title="Delete selected opportunities"
          message={
            bulkDeleteTargets.length === 0
              ? 'These opportunities are no longer available in this view. Nothing will be deleted.'
              : `Delete ${opportunityCount(bulkDeleteTargets.length)} from the ${
                  dialog.archiveView === 'archived' ? 'Archived' : 'Active'
                } view? ${
                  bulkDeleteTargets.length === 1 ? 'Its' : 'Their'
                } details, activities, interviews, contacts and materials will be removed from Launchboard. You can undo this for 10 seconds; after that, recovery requires a backup if you have one. Unlike archiving, deleting does not keep a copy in the Archived view.`
          }
          confirmLabel={
            bulkDeleteTargets.length > 0
              ? `Delete ${bulkDeleteTargets.length}`
              : 'Delete'
          }
          opener={opener}
          fallbackFocusId="main-content"
          onCancel={close}
          onConfirm={confirmBulkDelete}
        />
      )}
      {dialog.kind === 'restore' && (
        <RestoreBackupDialog
          currentItems={items}
          opener={opener}
          fallbackFocusId="main-content"
          onClose={close}
          onRestore={handleRestoreBackup}
        />
      )}
      <WhatsNewDialog
        open={whatsNewOpen}
        opener={whatsNewOpener}
        fallbackFocusId="main-content"
        onClose={() => setWhatsNewOpen(false)}
      />
    </div>
  );
}


/** Local browser mode remains the default; API mode is explicitly opt-in. */
export default function App() {
  return import.meta.env.VITE_DATA_MODE === 'api'
    ? <ApiModeApp />
    : <LocalStorageApp />;
}

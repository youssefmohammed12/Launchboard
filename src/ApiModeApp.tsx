import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import {
  addOpportunityTask,
  completeOpportunityTask,
  deleteOpportunityTask,
  reopenOpportunityTask,
  updateOpportunityTask,
  type TaskDraft,
} from '@launchboard/domain';
import { AuthScreen } from './components/AuthScreen';
import { ConfirmDialog } from './components/ConfirmDialog';
import { LocalMigrationDialog } from './components/LocalMigrationDialog';
import { OpportunityForm } from './components/OpportunityForm';
import { QuickCapture } from './components/QuickCapture';
import { WhatsNewButton, WhatsNewDialog } from './components/WhatsNew';
import { FeatureSpotlight } from './components/FeatureSpotlight';
import { DetailsDialog } from './components/DetailsDialog';
import { ApiBackupImportDialog } from './components/ApiBackupImportDialog';
import { Sidebar } from './components/Sidebar';
import { MobileAccountMenu } from './components/MobileAccountMenu';
import { GlobalSearchDialog } from './components/GlobalSearchDialog';
import { Dashboard } from './pages/Dashboard';
import { Opportunities } from './pages/Opportunities';
import { Calendar } from './pages/Calendar';
import { Deadlines } from './pages/Deadlines';
import { Reports } from './pages/Reports';
import { ActionCenter, type TaskFocusTarget } from './pages/ActionCenter';
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
import {
  HttpOpportunityRepository,
  type ArchiveUndoRef,
  type DeletionBatch,
  type OpportunityCollection,
  type OpportunityResource,
  type VersionedOpportunityRef,
} from './data/httpOpportunityRepository';
import { ApiRequestError, previewOpportunityCapture } from './data/apiClient';
import { commitApiTaskMutation, type TaskCollectionMutation } from './data/taskOperations';
import { getLocalMigrationMarker } from './data/localMigration';
import { createId } from './utils/id';
import { toISODate } from './utils/dates';
import { downloadJsonBackupEnvelope } from './utils/exports';
import {
  addContact,
  clearInterviewContactReferences,
  removeContact,
  resolveContactId,
  updateContact,
} from './utils/contacts';
import {
  addInterview,
  removeInterview,
  setInterviewStatus,
  updateInterview,
} from './utils/interviews';
import {
  addMaterial,
  removeMaterial,
  setMaterialStatus,
  updateMaterial,
} from './utils/materials';
import type { ArchiveOperationResult } from './utils/archive';
import type { DetailsFocusTarget } from './utils/detailsFocus';
import type { GlobalSearchResult } from './utils/globalSearch';

type OpportunityEditor =
  | { mode: 'create' }
  | { mode: 'edit'; resource: OpportunityResource; notice?: string };

type BulkAction = 'archive' | 'restore' | 'status' | 'delete';

interface ArchiveUndoAction {
  items: ArchiveUndoRef[];
  expiresAt: number;
  description: string;
}

function mergeChangedFormFields(
  previous: Opportunity,
  latest: Opportunity,
  submitted: OpportunityFormData,
): Opportunity {
  const merged: Opportunity = { ...latest };
  const fields = [
    'title',
    'company',
    'type',
    'status',
    'priority',
    'tags',
    'url',
    'deadline',
    'followUpDate',
    'compensation',
    'description',
    'notes',
  ] as const;

  for (const field of fields) {
    const changed = field === 'tags'
      ? JSON.stringify(submitted.tags) !== JSON.stringify(previous.tags)
      : submitted[field] !== previous[field];
    if (changed) Object.assign(merged, { [field]: submitted[field] });
  }

  return merged;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'STALE_VERSION':
        return 'This opportunity changed on the server. The latest version has been reloaded; review it and try again.';
      case 'DUPLICATE_ID':
        return 'An opportunity with this ID already exists in your account. Refresh the list before trying again.';
      case 'DELETION_EXPIRED':
        return 'The server Undo window has expired. The deletion can no longer be reversed.';
      case 'ALREADY_RESTORED':
        return 'This deletion batch has already been restored.';
      case 'NOT_FOUND':
        return 'This opportunity is no longer available in your account. Refresh the list and try again.';
      default:
        return error.message;
    }
  }
  return 'The request could not be completed. Try again.';
}

function replaceResource(
  current: OpportunityCollection | null,
  resource: OpportunityResource,
): OpportunityCollection | null {
  if (!current) return current;
  const found = current.items.some((item) => item.opportunity.id === resource.opportunity.id);
  return {
    ...current,
    items: found
      ? current.items.map((item) =>
          item.opportunity.id === resource.opportunity.id ? resource : item,
        )
      : [...current.items, resource],
  };
}

export default function ApiModeApp() {
  const auth = useAuth();
  const [showAccountActionFlow, setShowAccountActionFlow] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return (
      params.has('verifyEmail') ||
      params.has('resetPassword') ||
      fragment.has('verifyEmail') ||
      fragment.has('resetPassword')
    );
  });
  const repository = useMemo(() => new HttpOpportunityRepository(), []);

  async function handleAuthScreenLogin(email: string, password: string) {
    const result = await auth.signIn(email, password);
    if (result.ok) setShowAccountActionFlow(false);
    return result;
  }
  const [storedCollection, setStoredCollection] = useState<{
    userId: string;
    value: OpportunityCollection;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [showMigration, setShowMigration] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [whatsNewOpener, setWhatsNewOpener] = useState<HTMLElement | null>(null);
  const [spotlightReplayToken, setSpotlightReplayToken] = useState(0);
  const [showBackupImport, setShowBackupImport] = useState(false);
  const [backupImportOpener, setBackupImportOpener] = useState<HTMLElement | null>(null);
  const [backupExportBusy, setBackupExportBusy] = useState(false);
  const [editor, setEditor] = useState<OpportunityEditor | null>(null);
  const [editorOpener, setEditorOpener] = useState<HTMLElement | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [detailsOpener, setDetailsOpener] = useState<HTMLElement | null>(null);
  const [detailsFocusTarget, setDetailsFocusTarget] = useState<DetailsFocusTarget | null>(null);
  const [view, setView] = useState<View>('opportunities');
  const [pendingTaskFocus, setPendingTaskFocus] = useState<TaskFocusTarget | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOpener, setSearchOpener] = useState<HTMLElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OpportunityResource | null>(null);
  const [deleteOpener, setDeleteOpener] = useState<HTMLElement | null>(null);
  const [undoBatch, setUndoBatch] = useState<DeletionBatch | null>(null);
  const [undoArchiveAction, setUndoArchiveAction] = useState<ArchiveUndoAction | null>(null);
  const [archiveView, setArchiveView] = useState<'active' | 'archived'>('active');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkStatus, setBulkStatus] = useState<OpportunityStatus>('Applied');
  const [bulkOpener, setBulkOpener] = useState<HTMLElement | null>(null);
  const [selectionResetToken, setSelectionResetToken] = useState(0);
  const mutationLock = useRef(false);

  const userId = auth.state.status === 'authenticated' ? auth.state.user.id : null;
  const activeUserIdRef = useRef<string | null>(userId);
  activeUserIdRef.current = userId;
  const collection = storedCollection?.userId === userId ? storedCollection.value : null;
  const setCollection = useCallback((
    next: OpportunityCollection | null |
      ((current: OpportunityCollection | null) => OpportunityCollection | null),
  ) => {
    setStoredCollection((currentState) => {
      // An older account's request must not overwrite the active account's data
      // after a sign-out/account switch.
      if (activeUserIdRef.current !== userId) return currentState;
      const current = currentState?.userId === userId ? currentState.value : null;
      const value = typeof next === 'function' ? next(current) : next;
      return value ? { userId: userId ?? '', value } : null;
    });
  }, [userId]);
  const items = useMemo(
    () => collection?.items.map((resource) => resource.opportunity) ?? [],
    [collection],
  );

  const loadCollection = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await repository.load('all');
      setCollection(result);
    } catch (error) {
      if (activeUserIdRef.current !== userId) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        setCollection(null);
        await auth.refresh();
      } else {
        setLoadError(messageFor(error));
      }
    } finally {
      if (activeUserIdRef.current === userId) setLoading(false);
    }
  }, [auth.refresh, repository, setCollection, userId]);

  useEffect(() => {
    if (showAccountActionFlow) {
      // A one-time account-action link takes precedence over the current tab's
      // session. Do not read account data while the user is changing credentials.
      setCollection(null);
      return;
    }
    if (!userId) {
      setCollection(null);
      setLoadError(null);
      setMutationError(null);
      setUndoBatch(null);
      setUndoArchiveAction(null);
      setSelectedIds([]);
      setBulkAction(null);
      return;
    }
    void loadCollection();
  }, [loadCollection, showAccountActionFlow, userId]);

  // Keep the client-side Undo affordance in step with the server's ten-second
  // deletion batch window. The server remains authoritative if the tab sleeps.
  useEffect(() => {
    if (!undoBatch) return;
    const expiresAt = Date.parse(undoBatch.expiresAt);
    const remaining = expiresAt - Date.now();
    if (!Number.isFinite(expiresAt) || remaining <= 0) {
      setUndoBatch(null);
      return;
    }
    const timer = window.setTimeout(() => setUndoBatch(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoBatch]);

  useEffect(() => {
    if (!undoArchiveAction) return;
    const remaining = undoArchiveAction.expiresAt - Date.now();
    if (remaining <= 0) {
      setUndoArchiveAction(null);
      return;
    }
    const timer = window.setTimeout(() => setUndoArchiveAction(null), remaining);
    return () => window.clearTimeout(timer);
  }, [undoArchiveAction]);

  const visibleResources = useMemo(
    () => (collection?.items ?? []).filter((resource) =>
      archiveView === 'archived'
        ? Boolean(resource.opportunity.archivedAt)
        : !resource.opportunity.archivedAt,
    ),
    [archiveView, collection],
  );
  const selectedResources = useMemo(
    () => visibleResources.filter((resource) => selectedIds.includes(resource.opportunity.id)),
    [selectedIds, visibleResources],
  );
  const bulkStatusChanging = selectedResources.filter(
    (resource) => resource.opportunity.status !== bulkStatus,
  );

  const migrationMarker = userId ? getLocalMigrationMarker(userId) : null;

  async function saveOpportunity(data: OpportunityFormData): Promise<boolean> {
    if (!userId || !editor) return false;
    setMutationError(null);
    try {
      if (editor.mode === 'create') {
        const opportunity: Opportunity = {
          ...data,
          id: createId(),
          activities: [],
          interviews: [],
          contacts: [],
          materials: [],
          tasks: [],
        };
        const created = await repository.create(opportunity);
        setCollection((current) => replaceResource(current, created));
      } else {
        const previous = editor.resource.opportunity;
        const next: Opportunity = { ...previous, ...data };
        const updated = await repository.update(
          previous.id,
          editor.resource.version,
          previous,
          next,
          next.status !== previous.status ? toISODate(new Date()) : undefined,
        );
        setCollection((current) => replaceResource(current, updated));
      }
      setEditor(null);
      setEditorOpener(null);
      setQuickCaptureOpen(false);
      void loadCollection();
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409 && editor.mode === 'edit') {
        try {
          // Refresh the base version but keep the form's unsaved field values.
          // The next explicit Save will merge those fields into the fresh
          // aggregate, preserving any nested server changes made by another tab.
          const latest = await repository.get(editor.resource.opportunity.id);
          const merged: OpportunityResource = {
            ...latest,
            opportunity: mergeChangedFormFields(
              editor.resource.opportunity,
              latest.opportunity,
              data,
            ),
          };
          // Remount the editor on the new version. Only fields changed by the
          // user are carried over; untouched fields and nested records come
          // from the latest server aggregate.
          setEditor({
            mode: 'edit',
            resource: merged,
            notice: 'A newer version was found. Your changed fields were kept, while untouched fields were refreshed from the server. Review the form and save again.',
          });
          setCollection((current) => replaceResource(current, latest));
        } catch {
          setEditor(null);
          await loadCollection();
          setMutationError('This opportunity is no longer available to edit. The current server collection has been refreshed.');
          return false;
        }
        throw new Error(
          'A newer version was found on the server. Your form entries are still here; review them and save again to apply them to the latest record.',
        );
      }
      if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
      }
      throw new Error(messageFor(error));
    }
  }

  async function deleteOpportunity(): Promise<void> {
    if (!deleteTarget || mutationBusy) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const batch = await repository.remove(
        deleteTarget.opportunity.id,
        deleteTarget.version,
      );
      setUndoArchiveAction(null);
      setUndoBatch(batch);
      setDeleteTarget(null);
      setDeleteOpener(null);
      await loadCollection();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setDeleteTarget(null);
        setDeleteOpener(null);
        await loadCollection();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
      }
      setMutationError(messageFor(error));
    } finally {
      setMutationBusy(false);
    }
  }

  async function undoDelete(): Promise<void> {
    if (!undoBatch || mutationBusy) return;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await repository.restoreDeletion(undoBatch.deletionBatchId);
      setUndoBatch(null);
      setUndoArchiveAction(null);
      await loadCollection();
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.status === 409 || error.status === 410)
      ) {
        // The batch expired or was already restored elsewhere.
        setUndoBatch(null);
        await loadCollection();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
      }
      setMutationError(messageFor(error));
    } finally {
      setMutationBusy(false);
    }
  }

  async function runBulkAction(): Promise<void> {
    if (
      !bulkAction ||
      selectedResources.length === 0 ||
      mutationBusy ||
      mutationLock.current
    ) {
      return;
    }

    const refs: VersionedOpportunityRef[] = selectedResources.map((resource) => ({
      id: resource.opportunity.id,
      expectedVersion: resource.version,
    }));

    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError(null);
    try {
      if (bulkAction === 'archive') {
        const result = await repository.bulkArchive(refs);
        const items: ArchiveUndoRef[] = result.items.map((resource) => ({
          id: resource.opportunity.id,
          expectedArchivedAt: resource.opportunity.archivedAt ?? null,
          previousArchivedAt: null,
        }));
        if (items.some((item) => !item.expectedArchivedAt)) {
          throw new Error('The server did not return archive timestamps for the completed batch.');
        }
        setUndoBatch(null);
        setUndoArchiveAction({
          items,
          expiresAt: Date.now() + 10_000,
          description: `${items.length} opportunities archived.`,
        });
      } else if (bulkAction === 'restore') {
        const previousArchiveDates = new Map(
          selectedResources.map((resource) => [
            resource.opportunity.id,
            resource.opportunity.archivedAt ?? null,
          ]),
        );
        const result = await repository.bulkRestore(refs);
        const items: ArchiveUndoRef[] = result.items.map((resource) => ({
          id: resource.opportunity.id,
          expectedArchivedAt: null,
          previousArchivedAt: previousArchiveDates.get(resource.opportunity.id) ?? null,
        }));
        setUndoBatch(null);
        setUndoArchiveAction({
          items,
          expiresAt: Date.now() + 10_000,
          description: `${items.length} opportunities restored.`,
        });
      } else if (bulkAction === 'status') {
        if (bulkStatusChanging.length > 0) {
          await repository.bulkStatus(
            bulkStatusChanging.map((resource) => ({
              id: resource.opportunity.id,
              expectedVersion: resource.version,
            })),
            bulkStatus,
            toISODate(new Date()),
          );
        }
        setUndoBatch(null);
        setUndoArchiveAction(null);
      } else {
        const batch = await repository.bulkDelete(refs, archiveView);
        setUndoArchiveAction(null);
        setUndoBatch(batch);
      }

      setBulkAction(null);
      setSelectedIds([]);
      setSelectionResetToken((current) => current + 1);
      await loadCollection();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'BULK_CONFLICT') {
        setSelectedIds([]);
        setSelectionResetToken((current) => current + 1);
        await loadCollection();
        setMutationError(
          'At least one selected opportunity changed or no longer matches this view. The server applied none of the batch. The list was refreshed; select the records again.',
        );
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
        setMutationError(messageFor(error));
      } else {
        setMutationError(messageFor(error));
      }
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  async function undoBulkArchive(): Promise<void> {
    if (!undoArchiveAction || mutationBusy || mutationLock.current) return;
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError(null);
    try {
      await repository.undoArchive(undoArchiveAction.items);
      setUndoArchiveAction(null);
      await loadCollection();
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        setUndoArchiveAction(null);
        await loadCollection();
        setMutationError(
          'The archive state changed after this action, so the server could not safely undo it. The latest records have been reloaded.',
        );
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
        setMutationError(messageFor(error));
      } else {
        setMutationError(messageFor(error));
      }
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  async function mutateAggregate(
    id: string,
    mutate: (current: Opportunity) => Opportunity,
  ): Promise<boolean> {
    if (mutationLock.current) return false;
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError(null);
    try {
      // Fetch the newest aggregate immediately before every nested write. This
      // avoids using a stale version captured when the details dialog opened.
      const current = await repository.get(id);
      const next = mutate(current.opportunity);
      if (next === current.opportunity) return true;
      const statusActivityDate =
        next.status !== current.opportunity.status ? toISODate(new Date()) : null;
      if (statusActivityDate) {
        await repository.update(
          id,
          current.version,
          current.opportunity,
          next,
          statusActivityDate,
        );
      } else {
        await repository.update(id, current.version, current.opportunity, next);
      }
      await loadCollection();
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await loadCollection();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
      }
      setMutationError(messageFor(error));
      return false;
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  async function runApiTaskMutation(
    opportunityId: string,
    mutate: TaskCollectionMutation,
  ): Promise<boolean> {
    if (!userId || mutationLock.current) return false;
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const result = await commitApiTaskMutation(repository, opportunityId, mutate);
      if (!result.ok) {
        setMutationError(result.issues?.[0]?.message ?? (
          result.reason === 'limit-reached'
            ? 'This opportunity already has the maximum of 100 tasks.'
            : result.reason === 'not-found'
              ? 'This task no longer exists. The workspace has not been changed.'
              : 'The task could not be changed. Review it and try again.'
        ));
        return false;
      }
      setCollection((current) => replaceResource(current, result.resource));
      return true;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await loadCollection();
        setMutationError('This opportunity changed while you were editing the task. The latest version was reloaded; review it and try again.');
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
        setMutationError('Your session needs to be refreshed before this task can be changed.');
      } else {
        setMutationError(messageFor(error));
      }
      return false;
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  const handleCreateTask = (opportunityId: string, draft: TaskDraft) =>
    runApiTaskMutation(opportunityId, (tasks) => addOpportunityTask(tasks, draft, createId()));

  const handleUpdateTask = (opportunityId: string, taskId: string, draft: TaskDraft) =>
    runApiTaskMutation(opportunityId, (tasks) => updateOpportunityTask(tasks, taskId, draft));

  const handleCompleteTask = (opportunityId: string, taskId: string) =>
    runApiTaskMutation(opportunityId, (tasks) =>
      completeOpportunityTask(tasks, taskId, toISODate(new Date())),
    );

  const handleReopenTask = (opportunityId: string, taskId: string) =>
    runApiTaskMutation(opportunityId, (tasks) => reopenOpportunityTask(tasks, taskId));

  const handleDeleteTask = (opportunityId: string, taskId: string) =>
    runApiTaskMutation(opportunityId, (tasks) => deleteOpportunityTask(tasks, taskId));

  async function changeArchiveFromDetails(id: string): Promise<ArchiveOperationResult> {
    if (mutationLock.current) {
      return { ok: false, message: 'Another server update is already running.' };
    }
    mutationLock.current = true;
    setMutationBusy(true);
    setMutationError(null);
    try {
      const current = await repository.get(id);
      const previousArchivedAt = current.opportunity.archivedAt ?? null;
      const updated = previousArchivedAt
        ? await repository.restore(id, current.version)
        : await repository.archive(id, current.version);
      setUndoBatch(null);
      setUndoArchiveAction({
        items: [{
          id,
          expectedArchivedAt: updated.opportunity.archivedAt ?? null,
          previousArchivedAt,
        }],
        expiresAt: Date.now() + 10_000,
        description: previousArchivedAt ? 'Opportunity restored.' : 'Opportunity archived.',
      });
      await loadCollection();
      return {
        ok: true,
        message: current.opportunity.archivedAt
          ? 'Opportunity restored successfully.'
          : 'Opportunity archived successfully.',
      };
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        await loadCollection();
      } else if (error instanceof ApiRequestError && error.status === 401) {
        await auth.refresh();
      }
      const message = messageFor(error);
      setMutationError(message);
      return { ok: false, message };
    } finally {
      mutationLock.current = false;
      setMutationBusy(false);
    }
  }

  const handleAddActivity = (id: string, draft: ActivityDraft): Promise<boolean> => {
    if (draft.type === SYSTEM_ACTIVITY_TYPE) return Promise.resolve(true);
    return mutateAggregate(id, (current) => ({
      ...current,
      activities: [...current.activities, { ...draft, id: createId() }],
    }));
  };

  const handleRemoveActivity = (id: string, activityId: string): Promise<boolean> =>
    mutateAggregate(id, (current) => {
      const target = current.activities.find((activity) => activity.id === activityId);
      if (!target || target.type === SYSTEM_ACTIVITY_TYPE) return current;
      return {
        ...current,
        activities: current.activities.filter((activity) => activity.id !== activityId),
      };
    });

  const handleAddInterview = (id: string, draft: InterviewDraft): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      interviews: addInterview(
        current.interviews,
        { ...draft, contactId: resolveContactId(draft.contactId, current.contacts) },
        createId(),
      ),
    }));

  const handleUpdateInterview = (
    id: string,
    interviewId: string,
    draft: InterviewDraft,
  ): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      interviews: updateInterview(
        current.interviews,
        interviewId,
        { ...draft, contactId: resolveContactId(draft.contactId, current.contacts) },
      ),
    }));

  const handleRemoveInterview = (id: string, interviewId: string): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      interviews: removeInterview(current.interviews, interviewId),
    }));

  const handleInterviewStatus = (
    id: string,
    interviewId: string,
    status: InterviewStatus,
  ): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      interviews: setInterviewStatus(current.interviews, interviewId, status),
    }));

  const handleAddContact = (id: string, draft: ContactDraft): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      contacts: addContact(current.contacts, draft, createId()),
    }));

  const handleUpdateContact = (
    id: string,
    contactId: string,
    draft: ContactDraft,
  ): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      contacts: updateContact(current.contacts, contactId, draft),
    }));

  const handleRemoveContact = (id: string, contactId: string): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      contacts: removeContact(current.contacts, contactId),
      interviews: clearInterviewContactReferences(current.interviews, contactId),
    }));

  const handleAddMaterial = (id: string, draft: MaterialDraft): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      materials: addMaterial(current.materials, draft, createId()),
    }));

  const handleUpdateMaterial = (
    id: string,
    materialId: string,
    draft: MaterialDraft,
  ): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      materials: updateMaterial(current.materials, materialId, draft),
    }));

  const handleRemoveMaterial = (id: string, materialId: string): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      materials: removeMaterial(current.materials, materialId),
    }));

  const handleMaterialStatus = (
    id: string,
    materialId: string,
    status: MaterialStatus,
  ): Promise<boolean> =>
    mutateAggregate(id, (current) => ({
      ...current,
      materials: setMaterialStatus(current.materials, materialId, status),
    }));

  const openAdd = (trigger?: HTMLElement | null) => {
    setEditorOpener(trigger ?? null);
    setQuickCaptureOpen(false);
    setEditor({ mode: 'create' });
  };

  const openQuickCapture = (trigger?: HTMLElement | null) => {
    setEditorOpener(trigger ?? null);
    setQuickCaptureOpen(true);
    setEditor({ mode: 'create' });
  };
  const openWhatsNew = (trigger: HTMLElement) => {
    setWhatsNewOpener(trigger);
    setWhatsNewOpen(true);
  };
  const replayQuickCaptureSpotlight = () => {
    setWhatsNewOpen(false);
    window.setTimeout(() => setSpotlightReplayToken((current) => current + 1), 60);
  };

  const openEdit = (item: Opportunity, trigger?: HTMLElement | null) => {
    const resource = collection?.items.find((entry) => entry.opportunity.id === item.id);
    if (!resource) return;
    setEditorOpener(trigger ?? null);
    setQuickCaptureOpen(false);
    setEditor({ mode: 'edit', resource });
  };

  const openDelete = (item: Opportunity, trigger?: HTMLElement | null) => {
    const resource = collection?.items.find((entry) => entry.opportunity.id === item.id);
    if (!resource) return;
    setDeleteOpener(trigger ?? null);
    setDeleteTarget(resource);
  };

  const openDetails = (item: Opportunity, trigger?: HTMLElement | null) => {
    setDetailsOpener(trigger ?? null);
    setDetailsFocusTarget(null);
    setDetailsId(item.id);
  };

  const openTaskInActionCenter = (opportunityId: string, taskId: string) => {
    setPendingTaskFocus({ opportunityId, taskId });
    setView('action-center');
  };

  const openBackupImport = (trigger?: HTMLElement | null) => {
    setBackupImportOpener(trigger ?? null);
    setShowBackupImport(true);
  };

  async function downloadServerBackup(): Promise<void> {
    if (backupExportBusy) return;
    setBackupExportBusy(true);
    setMutationError(null);
    try {
      const backup = await repository.exportBackup();
      downloadJsonBackupEnvelope(backup);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) await auth.refresh();
      setMutationError(messageFor(error));
    } finally {
      setBackupExportBusy(false);
    }
  }

  const openSearch = useCallback((trigger?: HTMLElement | null) => {
    const active = document.activeElement;
    setSearchOpener(
      trigger ??
        (active instanceof HTMLElement && active !== document.body ? active : null),
    );
    setSearchOpen(true);
  }, []);

  const openSearchResult = (result: GlobalSearchResult) => {
    const resource = collection?.items.find(
      (entry) => entry.opportunity.id === result.opportunityId,
    );
    if (!resource) return;
    setSearchOpen(false);
    setDetailsId(resource.opportunity.id);
    setDetailsOpener(searchOpener);
    setDetailsFocusTarget(
      result.childId && result.category !== 'opportunity'
        ? { category: result.category, id: result.childId }
        : null,
    );
  };

  const openBulkArchive = (ids: string[], trigger?: HTMLElement | null) => {
    if (ids.length === 0) return;
    setArchiveView('active');
    setSelectedIds(ids);
    setBulkOpener(trigger ?? null);
    setBulkAction('archive');
  };

  const openBulkRestore = (ids: string[], trigger?: HTMLElement | null) => {
    if (ids.length === 0) return;
    setArchiveView('archived');
    setSelectedIds(ids);
    setBulkOpener(trigger ?? null);
    setBulkAction('restore');
  };

  const openBulkStatus = (
    ids: string[],
    status: OpportunityStatus,
    trigger?: HTMLElement | null,
  ) => {
    if (ids.length === 0) return;
    setArchiveView('active');
    setSelectedIds(ids);
    setBulkStatus(status);
    setBulkOpener(trigger ?? null);
    setBulkAction('status');
  };

  const openBulkDelete = (
    ids: string[],
    nextArchiveView: 'active' | 'archived',
    trigger?: HTMLElement | null,
  ) => {
    if (ids.length === 0) return;
    setArchiveView(nextArchiveView);
    setSelectedIds(ids);
    setBulkOpener(trigger ?? null);
    setBulkAction('delete');
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'k') return;
      if (
        searchOpen ||
        showBackupImport ||
        editor ||
        detailsId ||
        deleteTarget ||
        showMigration ||
        bulkAction ||
        document.querySelector('dialog[open]')
      ) {
        return;
      }
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
      openSearch();
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [bulkAction, deleteTarget, detailsId, editor, openSearch, searchOpen, showBackupImport, showMigration]);

  if (auth.state.status === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center bg-bg p-s4">
        <p role="status" className="text-sm text-muted">Checking your Launchboard session…</p>
      </main>
    );
  }

  if (auth.state.status !== 'authenticated' || showAccountActionFlow) {
    return (
      <AuthScreen
        state={auth.state.status === 'authenticated'
          ? { status: 'anonymous' }
          : auth.state}
        busy={auth.busy}
        onLogin={handleAuthScreenLogin}
        onRegister={auth.signUp}
        onRetry={auth.refresh}
      />
    );
  }

  return (
    <main id="api-main-content" tabIndex={-1} className="lb-app-shell outline-none">
      <Sidebar
        current={view}
        onNavigate={setView}
        onSearch={openSearch}
        storageDescription="Your opportunity data is stored in your Launchboard account."
      />
      <div className="lb-main-area">
        <header className="lb-topbar">
          <div className="lb-topbar-copy">
            <span className="lb-eyebrow">YOUR PERSONAL WORKSPACE</span>
            <span className="lb-topbar-title">Keep every opportunity moving forward</span>
          </div>
          <div className="lb-topbar-actions">
            <span className="lb-sync-state">
              <span className="lb-sync-dot" aria-hidden="true" />
              {collection ? 'Cloud synced' : loading ? 'Connecting' : 'Workspace'}
            </span>
            <button
              type="button"
              className="lb-topbar-add-button"
              aria-label="Add opportunity"
              onClick={(event) => openAdd(event.currentTarget)}
            >
              <span aria-hidden="true">+</span>
              <span className="lb-topbar-add-full-label">Add opportunity</span>
              <span className="lb-topbar-add-short-label">Add</span>
            </button>
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
            <button
              type="button"
              className="lb-migration-button"
              onClick={() => setShowMigration(true)}
            >
              Migrate local data
            </button>
            <div className="lb-user-block">
              <span className="lb-user-avatar" aria-hidden="true">
                {auth.state.user.email.slice(0, 1)}
              </span>
              <div className="lb-user-copy">
                <span>Signed in as</span>
                <strong>{auth.state.user.email}</strong>
              </div>
            </div>
            <button
              type="button"
              className="lb-signout-button"
              disabled={auth.busy || mutationBusy}
              onClick={() => void auth.signOut()}
            >
              Sign out
            </button>
            <MobileAccountMenu
              email={auth.state.user.email}
              disabled={auth.busy || mutationBusy}
              onMigrate={() => setShowMigration(true)}
              onSignOut={() => void auth.signOut()}
            />
          </div>
        </header>

        <div className="lb-content">
          <div className="lb-context-row" aria-label="Workspace status">
            <span className="lb-context-status">
              <span className="lb-sync-dot" aria-hidden="true" />
              {collection ? 'Your workspace is up to date' : loading ? 'Loading your workspace' : 'Your workspace is not loaded'}
            </span>
            <span className="lb-context-detail">
              {collection
                ? `${collection.items.length} opportunities tracked · revision ${collection.revision}`
                : 'Your opportunities are saved to your Launchboard account.'}
            </span>
            {migrationMarker && (
              <span className="lb-context-detail">
                Local data imported {new Date(migrationMarker.completedAt).toLocaleDateString()}.
              </span>
            )}
          </div>

          {auth.state.error && (
            <p role="alert" className="lb-inline-alert">
              {auth.state.error}
            </p>
          )}

        {mutationError && (
          <p role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
            {mutationError}
          </p>
        )}

        {undoArchiveAction && (
          <section className="flex flex-wrap items-center justify-between gap-s2 rounded-control border border-border bg-surface p-s3" role="status">
            <p className="text-sm">
              {undoArchiveAction.description} Undo is available for a few more seconds.
            </p>
            <button
              type="button"
              className="min-h-9 rounded-control bg-accent px-s3 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50"
              disabled={mutationBusy}
              onClick={() => void undoBulkArchive()}
            >
              Undo archive change
            </button>
          </section>
        )}

        {undoBatch && (
          <section className="flex flex-wrap items-center justify-between gap-s2 rounded-control border border-border bg-surface p-s3" role="status">
            <p className="text-sm">
              Opportunity deleted. Undo is available until {new Date(undoBatch.expiresAt).toLocaleTimeString()}.
            </p>
            <button
              type="button"
              className="min-h-9 rounded-control bg-accent px-s3 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-50"
              disabled={mutationBusy}
              onClick={() => void undoDelete()}
            >
              Undo delete
            </button>
          </section>
        )}

        {loadError && (
          <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-s3 text-sm text-danger">
            {loadError}
            {!collection && (
              <button type="button" className="ml-s2 underline" onClick={() => void loadCollection()}>
                Retry
              </button>
            )}
          </div>
        )}

        {!collection ? (
          <p role="status" className="rounded-card border border-border bg-surface p-s5 text-sm text-muted">
            {loading ? 'Loading your server opportunities…' : 'No server collection is loaded.'}
          </p>
        ) : (
          <>
            {view === 'dashboard' && (
              <Dashboard
                items={items}
                onAdd={openAdd}
                onOpen={openDetails}
                onOpenTask={openTaskInActionCenter}
                onOpenActionCenter={() => setView('action-center')}
                onOpenCalendar={() => setView('calendar')}
              />
            )}
            {view === 'opportunities' && (
              <Opportunities
                items={items}
                onAdd={openAdd}
                onOpen={openDetails}
                onEdit={openEdit}
                onDelete={openDelete}
                onStatusChange={(id, status) => {
                  void mutateAggregate(id, (current) =>
                    current.status === status ? current : { ...current, status },
                  );
                }}
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
                busy={mutationBusy}
                error={mutationError}
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
              <Reports
                items={items}
                onOpen={openDetails}
                onRestoreBackup={openBackupImport}
                onDownloadBackup={() => void downloadServerBackup()}
                backupExportBusy={backupExportBusy}
                backupStorageDescription="JSON backup is fetched from your authenticated account and downloaded to this browser. Uploaded imports are previewed by the server before you confirm them."
                restoreBackupLabel="Import CSV / JSON"
              />
            )}
          </>
        )}
        </div>
      </div>

      {detailsId && collection?.items.find((resource) => resource.opportunity.id === detailsId) && (
        <DetailsDialog
          item={collection.items.find((resource) => resource.opportunity.id === detailsId)!.opportunity}
          opener={detailsOpener}
          fallbackFocusId="api-main-content"
          focusTarget={detailsFocusTarget}
          onClose={() => {
            setDetailsId(null);
            setDetailsFocusTarget(null);
          }}
          onEdit={() => {
            const resource = collection.items.find((item) => item.opportunity.id === detailsId);
            setDetailsId(null);
            if (resource) {
              setEditorOpener(detailsOpener);
              setEditor({ mode: 'edit', resource });
            }
          }}
          onArchive={changeArchiveFromDetails}
          onRestore={changeArchiveFromDetails}
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

      {editor && (quickCaptureOpen ? (
        <QuickCapture
          mode="api"
          opener={editorOpener}
          fallbackFocusId="api-main-content"
          existingOpportunities={items}
          onPreview={previewOpportunityCapture}
          onCancel={() => {
            setEditor(null);
            setEditorOpener(null);
            setQuickCaptureOpen(false);
          }}
          onSave={saveOpportunity}
        />
      ) : (
        <OpportunityForm
          key={editor.mode === 'edit'
            ? `${editor.resource.opportunity.id}:${editor.resource.version}`
            : 'new'}
          initial={editor.mode === 'edit' ? editor.resource.opportunity : undefined}
          notice={editor.mode === 'edit' ? editor.notice : undefined}
          opener={editorOpener}
          fallbackFocusId="api-main-content"
          onCancel={() => {
            setEditor(null);
            setEditorOpener(null);
            setQuickCaptureOpen(false);
          }}
          onSave={saveOpportunity}
        />
      ))}

      {bulkAction && (
        <ConfirmDialog
          title={
            bulkAction === 'archive'
              ? 'Archive selected opportunities'
              : bulkAction === 'restore'
                ? 'Restore selected opportunities'
                : bulkAction === 'status'
                  ? 'Change selected opportunity status'
                  : 'Delete selected opportunities'
          }
          message={
            bulkAction === 'archive'
              ? `Archive ${selectedResources.length} active opportunities? You can undo this archive change for 10 seconds.`
              : bulkAction === 'restore'
                ? `Restore ${selectedResources.length} archived opportunities? You can undo this archive change for 10 seconds.`
                : bulkAction === 'status'
                  ? `Change ${bulkStatusChanging.length} opportunities to ${bulkStatus}? ${selectedResources.length - bulkStatusChanging.length} already have this status and will be left unchanged. The server will record each status change in activity history.`
                  : `Delete ${selectedResources.length} opportunities from the ${archiveView} view? Their workspace data will be soft-deleted with them. You can undo this within the server's 10-second Undo window.`
          }
          confirmLabel={
            mutationBusy
              ? 'Saving…'
              : bulkAction === 'archive'
                ? 'Archive selected'
                : bulkAction === 'restore'
                  ? 'Restore selected'
                  : bulkAction === 'status'
                    ? 'Change status'
                    : 'Delete selected'
          }
          busy={mutationBusy}
          opener={bulkOpener}
          fallbackFocusId="api-main-content"
          onCancel={() => setBulkAction(null)}
          onConfirm={() => void runBulkAction()}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete opportunity"
          message={`Delete “${deleteTarget.opportunity.title}” from this account? Its workspace data will be soft-deleted with it. You can undo this within the server's Undo window.`}
          confirmLabel={mutationBusy ? 'Deleting…' : 'Delete opportunity'}
          busy={mutationBusy}
          opener={deleteOpener}
          fallbackFocusId="api-main-content"
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteOpener(null);
          }}
          onConfirm={() => void deleteOpportunity()}
        />
      )}

      {searchOpen && (
        <GlobalSearchDialog
          items={items}
          opener={searchOpener}
          fallbackFocusId="api-main-content"
          onClose={() => setSearchOpen(false)}
          onSelect={openSearchResult}
        />
      )}

      {showBackupImport && (
        <ApiBackupImportDialog
          repository={repository}
          opener={backupImportOpener}
          fallbackFocusId="api-main-content"
          onClose={() => {
            setShowBackupImport(false);
            setBackupImportOpener(null);
          }}
          onImported={setCollection}
          onUnauthorized={auth.refresh}
        />
      )}

      {showMigration && (
        <LocalMigrationDialog
          repository={repository}
          userId={auth.state.user.id}
          onClose={() => setShowMigration(false)}
          onImported={setCollection}
        />
      )}
      <WhatsNewDialog
        open={whatsNewOpen}
        opener={whatsNewOpener}
        fallbackFocusId="api-main-content"
        onClose={() => setWhatsNewOpen(false)}
        onReplaySpotlight={replayQuickCaptureSpotlight}
      />
      <FeatureSpotlight
        userId={auth.state.user.id}
        replayToken={spotlightReplayToken}
        onTryQuickCapture={openQuickCapture}
      />
    </main>
  );
}

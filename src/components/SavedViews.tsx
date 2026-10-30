import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bookmark, ChevronDown } from 'lucide-react';
import {
  MAX_SAVED_VIEW_NAME_LENGTH,
  MAX_SAVED_VIEWS,
  createSavedView,
  loadSavedViews,
  sameSavedViewSettings,
  saveSavedViews,
  savedViewNameError,
  snapshotSavedViewSettings,
  type SavedView,
  type SavedViewSettings,
} from '../utils/savedViews';

interface Props {
  currentSettings: SavedViewSettings;
  onApply: (settings: SavedViewSettings) => void;
}

interface NameForm {
  mode: 'save' | 'rename';
  id?: string;
  name: string;
}

type Feedback = { kind: 'success' | 'error'; message: string };

const primaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-accent bg-accent px-s4 py-[9px] font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50';

const secondaryButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-border bg-surface px-s3 py-1.5 text-[0.82rem] font-medium text-text hover:border-[#c9c4b9] disabled:cursor-not-allowed disabled:opacity-50';

const dangerButtonClass =
  'inline-flex cursor-pointer items-center justify-center gap-s2 rounded-control border border-danger/40 bg-surface px-s3 py-1.5 text-[0.82rem] font-medium text-danger hover:border-danger hover:bg-status-rejected';

const inputClass =
  'w-full rounded-control border border-border bg-surface px-s3 py-[9px] text-inherit [font:inherit]';

const feedbackClass = (kind: Feedback['kind']) =>
  `mb-s3 mt-0 rounded-control border px-s3 py-s2 text-[0.85rem] ${
    kind === 'error'
      ? 'border-danger bg-status-rejected text-danger'
      : 'border-accent bg-accent-soft text-accent-dark'
  }`;

function describeSettings(settings: SavedViewSettings): string {
  const filters = settings.filters;
  const parts: string[] = [];
  if (filters.query.trim()) parts.push(`Search “${filters.query.trim()}”`);
  if (filters.type !== 'All') parts.push(filters.type);
  if (filters.status !== 'All') parts.push(filters.status);
  if (filters.priority !== 'All') parts.push(filters.priority);
  if (filters.tag) parts.push(`Tag “${filters.tag}”`);
  parts.push(`Deadline ${filters.sort === 'asc' ? 'earliest' : 'latest'} first`);
  parts.push(settings.archiveView === 'archived' ? 'Archived' : 'Active');
  parts.push(settings.viewMode === 'board' ? 'Board' : 'List');
  return parts.join(' · ');
}

export function SavedViews({ currentSettings, onApply }: Props) {
  const [views, setViews] = useState<SavedView[]>(loadSavedViews);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<NameForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingUpdateId, setConfirmingUpdateId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (form) nameRef.current?.focus();
  }, [form?.mode, form?.id]);

  const matchingViews = views.filter((view) =>
    sameSavedViewSettings(view.settings, currentSettings),
  );
  const appliedView = appliedId ? views.find((view) => view.id === appliedId) ?? null : null;
  const activeView =
    appliedView && sameSavedViewSettings(appliedView.settings, currentSettings)
      ? appliedView
      : matchingViews.length === 1
        ? matchingViews[0]
        : null;
  const modifiedView =
    appliedView && !sameSavedViewSettings(appliedView.settings, currentSettings)
      ? appliedView
      : null;

  const beginSave = () => {
    setForm({ mode: 'save', name: '' });
    setFormError(null);
    setConfirmingUpdateId(null);
    setConfirmingDeleteId(null);
    setFeedback(null);
  };

  const beginRename = (view: SavedView) => {
    setForm({ mode: 'rename', id: view.id, name: view.name });
    setFormError(null);
    setConfirmingUpdateId(null);
    setConfirmingDeleteId(null);
    setFeedback(null);
  };

  const cancelForm = () => {
    setForm(null);
    setFormError(null);
  };

  const submitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;

    const name = form.name.trim();
    const error = savedViewNameError(
      name,
      views,
      form.mode === 'rename' ? form.id : undefined,
    );
    if (error) {
      setFormError(error);
      return;
    }

    if (form.mode === 'save') {
      if (views.length >= MAX_SAVED_VIEWS) {
        setFormError(
          `You can save up to ${MAX_SAVED_VIEWS} views. Delete one to add another.`,
        );
        return;
      }

      const view = createSavedView(name, currentSettings);
      const next = [...views, view];
      if (!saveSavedViews(next)) {
        setFeedback({
          kind: 'error',
          message:
            'The view could not be saved because browser storage is unavailable. Nothing was changed.',
        });
        return;
      }

      setViews(next);
      setAppliedId(view.id);
      setFeedback({ kind: 'success', message: `Saved “${view.name}”.` });
      cancelForm();
      return;
    }

    const target = views.find((view) => view.id === form.id);
    if (!target) {
      cancelForm();
      return;
    }

    const next = views.map((view) =>
      view.id === target.id
        ? { ...view, name, updatedAt: new Date().toISOString() }
        : view,
    );
    if (!saveSavedViews(next)) {
      setFeedback({
        kind: 'error',
        message:
          'The view could not be renamed because browser storage is unavailable. Nothing was changed.',
      });
      return;
    }

    setViews(next);
    setFeedback({ kind: 'success', message: `Renamed “${target.name}” to “${name}”.` });
    cancelForm();
  };

  const applyView = (view: SavedView) => {
    onApply(snapshotSavedViewSettings(view.settings));
    setAppliedId(view.id);
    setConfirmingUpdateId(null);
    setConfirmingDeleteId(null);
    setForm(null);
    setFormError(null);
    setFeedback({ kind: 'success', message: `Applied “${view.name}”.` });
  };

  const updateView = (view: SavedView) => {
    const next = views.map((entry) =>
      entry.id === view.id
        ? {
            ...entry,
            settings: snapshotSavedViewSettings(currentSettings),
            updatedAt: new Date().toISOString(),
          }
        : entry,
    );
    if (!saveSavedViews(next)) {
      setFeedback({
        kind: 'error',
        message:
          'The view could not be updated because browser storage is unavailable. Nothing was changed.',
      });
      return;
    }

    setViews(next);
    setAppliedId(view.id);
    setConfirmingUpdateId(null);
    setFeedback({
      kind: 'success',
      message: `Updated “${view.name}” to the current page settings.`,
    });
  };

  const deleteView = (view: SavedView) => {
    const next = views.filter((entry) => entry.id !== view.id);
    if (!saveSavedViews(next)) {
      setFeedback({
        kind: 'error',
        message:
          'The view could not be deleted because browser storage is unavailable. Nothing was changed.',
      });
      return;
    }

    setViews(next);
    if (appliedId === view.id) setAppliedId(null);
    setConfirmingDeleteId(null);
    setFeedback({
      kind: 'success',
      message: `Deleted “${view.name}”. Opportunities were not changed.`,
    });
  };

  const nameForm = (mode: 'save' | 'rename') => (
    <form className="mt-s3 rounded-control border border-border p-s3" onSubmit={submitName}>
      <label className="grid gap-s1 text-[0.82rem] font-medium">
        View name
        <input
          ref={nameRef}
          type="text"
          value={form?.name ?? ''}
          maxLength={MAX_SAVED_VIEW_NAME_LENGTH}
          onChange={(event) => {
            if (!form) return;
            setForm({ ...form, name: event.target.value });
            setFormError(null);
          }}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? 'saved-view-name-error' : undefined}
          className={inputClass}
        />
      </label>
      {formError && (
        <p id="saved-view-name-error" role="alert" className="mb-0 mt-s2 text-[0.8rem] text-danger">
          {formError}
        </p>
      )}
      <div className="mt-s2 flex flex-wrap gap-s2">
        <button type="submit" className={primaryButtonClass}>
          {mode === 'save' ? 'Save view' : 'Rename view'}
        </button>
        <button type="button" className={secondaryButtonClass} onClick={cancelForm}>
          Cancel
        </button>
      </div>
    </form>
  );

  return (
    <div className="mb-s4 overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-s2 border-0 bg-transparent px-s4 py-s3 text-left text-inherit hover:bg-accent-soft/40"
        aria-expanded={open}
        aria-controls="saved-views-panel"
        onClick={() => setOpen((previous) => !previous)}
      >
        <Bookmark size={16} aria-hidden className="text-accent" />
        <span className="font-semibold">Saved views</span>
        <span className="rounded-full bg-accent-soft px-s2 py-0.5 text-[0.72rem] font-semibold text-accent-dark">
          {views.length}
        </span>
        <span className="ml-auto min-w-0 truncate text-[0.8rem] text-muted max-[480px]:hidden">
          {modifiedView
            ? `Modified: ${modifiedView.name}`
            : activeView
              ? `Applied: ${activeView.name}`
              : 'Save and reuse this page setup'}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div id="saved-views-panel" className="border-t border-border px-s4 py-s3">
          {feedback && (
            <p
              className={feedbackClass(feedback.kind)}
              role={feedback.kind === 'error' ? 'alert' : 'status'}
            >
              {feedback.message}
            </p>
          )}

          {views.length === 0 ? (
            <p className="m-0 text-[0.85rem] text-muted">
              No saved views yet. Set up search, filters, sorting and a layout, then save this
              page as a view.
            </p>
          ) : (
            <ul className="m-0 grid list-none gap-s2 p-0">
              {views.map((view) => {
                const isActive = activeView?.id === view.id;
                const isModified = modifiedView?.id === view.id;
                return (
                  <li key={view.id} className="rounded-control border border-border p-s3">
                    <div className="flex flex-wrap items-start justify-between gap-s2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-s2">
                          <span className="font-medium">{view.name}</span>
                          {isActive && (
                            <span className="rounded-full bg-accent-soft px-s2 py-0.5 text-[0.7rem] font-semibold text-accent-dark">
                              Applied
                            </span>
                          )}
                          {isModified && (
                            <span className="rounded-full bg-status-rejected px-s2 py-0.5 text-[0.7rem] font-semibold text-danger">
                              Modified
                            </span>
                          )}
                        </div>
                        <p className="m-0 mt-s1 text-[0.78rem] text-muted">
                          {describeSettings(view.settings)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-s1">
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          aria-label={`Apply ${view.name}`}
                          onClick={() => applyView(view)}
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          aria-label={`Update ${view.name}`}
                          onClick={() => {
                            setConfirmingUpdateId(view.id);
                            setConfirmingDeleteId(null);
                            setForm(null);
                            setFormError(null);
                            setFeedback(null);
                          }}
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          className={secondaryButtonClass}
                          aria-label={`Rename ${view.name}`}
                          onClick={() => beginRename(view)}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className={dangerButtonClass}
                          aria-label={`Delete ${view.name}`}
                          onClick={() => {
                            setConfirmingDeleteId(view.id);
                            setConfirmingUpdateId(null);
                            setForm(null);
                            setFormError(null);
                            setFeedback(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {confirmingUpdateId === view.id && (
                      <div className="mt-s3 rounded-control border border-border bg-accent-soft/40 p-s3">
                        <p className="m-0 text-[0.85rem]">
                          Replace “{view.name}” with the current page settings?
                        </p>
                        <div className="mt-s2 flex flex-wrap gap-s2">
                          <button
                            type="button"
                            className={primaryButtonClass}
                            onClick={() => updateView(view)}
                          >
                            Replace view
                          </button>
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => setConfirmingUpdateId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {confirmingDeleteId === view.id && (
                      <div className="mt-s3 rounded-control border border-danger/40 bg-status-rejected p-s3">
                        <p className="m-0 text-[0.85rem]">
                          Delete “{view.name}”? Opportunities are not affected.
                        </p>
                        <div className="mt-s2 flex flex-wrap gap-s2">
                          <button
                            type="button"
                            className={dangerButtonClass}
                            onClick={() => deleteView(view)}
                          >
                            Delete view
                          </button>
                          <button
                            type="button"
                            className={secondaryButtonClass}
                            onClick={() => setConfirmingDeleteId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {form?.mode === 'rename' && form.id === view.id && nameForm('rename')}
                  </li>
                );
              })}
            </ul>
          )}

          {form?.mode === 'save' ? (
            nameForm('save')
          ) : (
            <div className="mt-s3 flex flex-wrap items-center gap-s2">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={beginSave}
                disabled={views.length >= MAX_SAVED_VIEWS}
              >
                Save current view
              </button>
              {views.length >= MAX_SAVED_VIEWS && (
                <span className="text-[0.78rem] text-muted">
                  You can save up to {MAX_SAVED_VIEWS} views. Delete one to add another.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

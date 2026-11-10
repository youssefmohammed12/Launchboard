import { useState } from 'react';
import { EMPTY_CAPTURE_STRUCTURED_FIELDS, isValidUrl } from '@launchboard/domain';
import type { Opportunity, OpportunityFormData } from '../types/opportunity';
import { emptyForm } from '../utils/opportunities';
import { ApiRequestError } from '../data/apiClient';
import type { CapturePreviewResponse } from '../data/apiClient';
import type { MutationOutcome } from '../utils/mutationMessages';
import { Modal } from './Modal';
import { OpportunityForm } from './OpportunityForm';

interface Props {
  mode: 'local' | 'api';
  opener?: HTMLElement | null;
  fallbackFocusId?: string;
  onPreview?: (url: string) => Promise<CapturePreviewResponse>;
  existingOpportunities?: readonly Opportunity[];
  onSave: (data: OpportunityFormData) => MutationOutcome;
  onCancel: () => void;
}

type PreviewState = 'idle' | 'loading' | 'ready' | 'failed';

function isLinkedInOpportunityUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 503 || error.code === 'NOT_READY') {
      return 'Automatic lookup is not enabled yet. You can still enter the opportunity details manually.';
    }
    if (error.status === 429 || error.code === 'RATE_LIMITED') {
      return 'Automatic lookup is temporarily rate-limited. Wait a little or continue manually.';
    }
    if (error.status === 401 || error.code === 'UNAUTHORIZED') {
      return 'Your session has expired. Sign in again before using automatic lookup.';
    }
    if (error.status === 0 || error.code === 'NETWORK_ERROR') {
      return 'Launchboard could not reach the preview service. Check your connection or continue manually.';
    }
  }
  return 'Automatic lookup could not complete. Your link is still here, and you can continue manually.';
}

function outcomeMessage(result: CapturePreviewResponse): string {
  switch (result.outcome) {
    case 'ready':
      return 'We found a title and hiring organization. Review every suggested field before saving.';
    case 'partial':
      return 'We found some page details. Complete anything missing and review all suggestions before saving.';
    case 'ambiguous':
      return 'This page may contain multiple opportunities or unclear structured data. Treat these suggestions carefully and verify them.';
    case 'unsupported':
      return "We couldn't find job details on this page. Fill them in manually; your URL is preserved.";
    case 'blocked':
      return 'The job site declined the automatic request or requires access. No details were extracted. Continue manually; your URL is preserved.';
    case 'not-found':
      return 'This job posting is no longer available or the link has expired. Check the link or continue manually; your URL is preserved.';
    case 'timeout':
      return 'The job site took too long to respond. No details were extracted. Continue manually or try again later.';
    case 'too-large':
      return 'This job page is larger than the supported size. No details were extracted. Continue manually; your URL is preserved.';
    case 'unavailable':
      return 'We could not retrieve this job page right now. No details were extracted. Continue manually or try again later.';
  }
}

/** URL-first capture which always hands off to the existing, validated form before save. */
export function QuickCapture({
  mode,
  opener,
  fallbackFocusId,
  onPreview,
  existingOpportunities = [],
  onSave,
  onCancel,
}: Props) {
  const [url, setUrl] = useState('');
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [preview, setPreview] = useState<CapturePreviewResponse | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const normalizedUrl = url.trim();
  const validUrl = normalizedUrl.length <= 2048 && isValidUrl(normalizedUrl);
  const linkedInUrl = isLinkedInOpportunityUrl(normalizedUrl);
  const hasPreviewDetails = Boolean(
    preview && (
      preview.title || preview.company || preview.description || preview.locations.length ||
      preview.department || preview.team || preview.workplaceType || preview.employmentType ||
      preview.postedDate || preview.compensation || preview.compensationDetails
    ),
  );

  const continueToReview = (metadata: CapturePreviewResponse | null) => {
    const initialData: Partial<OpportunityFormData> = {
      ...emptyForm,
      url: normalizedUrl,
      title: metadata?.title ?? '',
      company: metadata?.company ?? '',
      description: metadata?.description ?? '',
      compensation: metadata?.compensation ?? '',
      ...EMPTY_CAPTURE_STRUCTURED_FIELDS,
      locations: metadata?.locations ?? [],
      department: metadata?.department ?? '',
      team: metadata?.team ?? '',
      workplaceType: metadata?.workplaceType ?? '',
      employmentType: metadata?.employmentType ?? '',
      postedDate: metadata?.postedDate ?? '',
      compensationDetails: metadata?.compensationDetails ?? null,
    };

    return (
      <OpportunityForm
        initialData={initialData}
        fieldEvidence={metadata?.fieldEvidence}
        duplicateOpportunities={existingOpportunities}
        modalTitle="Review opportunity"
        submitLabel="Save opportunity"
        intro={
          <p className="m-0 text-[0.84rem] leading-relaxed text-muted">
            {metadata
              ? outcomeMessage(metadata)
              : 'Enter the details you know. The opportunity URL is preserved so you can return to the original posting.'}
            {' '}Extracted values are suggestions, not verified facts.
          </p>
        }
        opener={opener}
        fallbackFocusId={fallbackFocusId}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  };

  const handlePreview = async () => {
    if (!validUrl) {
      setUrlError(
        normalizedUrl.length > 2048
          ? 'The URL is too long. Use a link under 2,048 characters.'
          : 'Enter a valid URL starting with http:// or https://.',
      );
      setError(null);
      return;
    }
    if (linkedInUrl) {
      setError('Automatic lookup is disabled for LinkedIn links. Launchboard will keep the original URL; continue manually to enter the posting details.');
      setPreviewState('failed');
      return;
    }
    if (!onPreview) return;

    setUrlError(null);
    setError(null);
    setPreview(null);
    setPreviewState('loading');
    try {
      const result = await onPreview(normalizedUrl);
      setPreview(result);
      setPreviewState('ready');
    } catch (caught) {
      setError(failureMessage(caught));
      setPreviewState('failed');
    }
  };

  const handleContinueManually = () => {
    if (!validUrl) {
      setUrlError(
        normalizedUrl.length > 2048
          ? 'The URL is too long. Use a link under 2,048 characters.'
          : 'Enter a valid URL starting with http:// or https://.',
      );
      return;
    }
    // Keep only the user-supplied link; never carry stale metadata from a failed attempt.
    setShowReview(true);
  };

  if (showReview) return continueToReview(previewState === 'ready' ? preview : null);

  return (
    <Modal
      title="Quick Capture"
      onClose={onCancel}
      initialFocusId="quick-capture-url"
      opener={opener}
      fallbackFocusId={fallbackFocusId}
      closeDisabled={previewState === 'loading'}
    >
      <div className="grid gap-s4 px-s5 pt-s4 pb-s5">
        <div className="grid gap-s2">
          <p className="m-0 text-[0.88rem] leading-relaxed text-muted">
            Paste the public opportunity posting link. Launchboard will suggest a few details when automatic lookup is available; you review and edit everything before saving.
          </p>
          {mode === 'local' && (
            <p className="m-0 rounded-control border border-border bg-bg px-s3 py-s2 text-[0.82rem] leading-relaxed text-muted" role="status">
              You are using browser-only storage. Quick Capture does not send your link to a server in this mode, but you can continue with the same form manually.
            </p>
          )}
        </div>

        <div className="grid gap-s1">
          <label htmlFor="quick-capture-url" className="font-semibold text-[0.88rem]">
            Opportunity URL
          </label>
          <input
            id="quick-capture-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            maxLength={2048}
            placeholder="https://example.com/jobs/your-opportunity"
            className="w-full rounded-control border border-border bg-surface px-s3 py-[10px] text-inherit [font:inherit]"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setUrlError(null);
              setError(null);
              setPreview(null);
              setPreviewState('idle');
            }}
            aria-invalid={urlError ? true : undefined}
            aria-describedby={urlError ? 'quick-capture-url-help quick-capture-url-error' : 'quick-capture-url-help'}
          />
          <span id="quick-capture-url-help" className="text-[0.78rem] text-muted">
            Public HTTP or HTTPS pages only. Private pages, sign-in walls and bot challenges are not bypassed.
          </span>
          {mode === 'api' && linkedInUrl && (
            <p className="m-0 rounded-control border border-border bg-bg px-s3 py-s2 text-[0.82rem] leading-relaxed text-muted" role="status">
              Automatic lookup is disabled for LinkedIn links. Launchboard will not send this URL to its server. Continue manually to keep the link and enter the details you can see on the posting.
            </p>
          )}
          {urlError && (
            <span id="quick-capture-url-error" className="text-[0.82rem] text-danger" role="alert">
              {urlError}
            </span>
          )}
        </div>

        {error && (
          <p className="m-0 rounded-control border border-danger bg-status-rejected px-s3 py-s2 text-[0.84rem] text-danger" role="alert">
            {error}
          </p>
        )}

        {previewState === 'ready' && preview && (
          <p className={hasPreviewDetails
            ? "m-0 rounded-control border border-accent bg-accent-soft px-s3 py-s2 text-[0.84rem] text-accent-dark"
            : "m-0 rounded-control border border-border bg-bg px-s3 py-s2 text-[0.84rem] text-muted"
          } role="status" aria-live="polite">
            {outcomeMessage(preview)}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-s2">
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-border bg-surface px-s4 py-s2 font-medium text-text hover:border-[#c9c4b9]"
            onClick={onCancel}
            disabled={previewState === 'loading'}
          >
            Cancel
          </button>

          {mode === 'api' && !linkedInUrl && (
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-accent bg-accent px-s4 py-s2 font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => void handlePreview()}
              disabled={previewState === 'loading' || !normalizedUrl}
            >
              {previewState === 'loading'
                ? 'Looking up…'
                : previewState === 'ready' && hasPreviewDetails
                  ? 'Find details again'
                  : previewState === 'ready'
                    ? 'Try again'
                  : previewState === 'failed'
                    ? 'Try again'
                    : 'Find details'}
            </button>
          )}

          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-control border border-accent bg-accent px-s4 py-s2 font-medium text-white hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-60"
            onClick={handleContinueManually}
            disabled={previewState === 'loading' || !normalizedUrl}
          >
            {mode === 'local'
              ? 'Continue to details'
              : previewState === 'ready' && hasPreviewDetails
                ? 'Review details'
                : 'Continue manually'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CapturePreviewResponse } from '../data/apiClient';
import { makeOpportunity } from '../test/fixtures';
import { QuickCapture } from './QuickCapture';

const url = 'https://jobs.example.org/roles/frontend-intern';

function readyPreview(overrides: Partial<CapturePreviewResponse> = {}): CapturePreviewResponse {
  return {
    outcome: 'ready',
    source: 'job-posting',
    title: 'Frontend Intern',
    company: 'Northwind Labs',
    description: 'Work with the frontend team.',
    compensation: '',
    locations: [],
    department: '',
    team: '',
    workplaceType: '',
    employmentType: '',
    postedDate: '',
    compensationDetails: null,
    fieldEvidence: {},
    ...overrides,
  };
}

describe('QuickCapture', () => {
  it('keeps LocalStorage mode manual and never calls the preview service', () => {
    const onPreview = vi.fn();
    render(
      <QuickCapture
        mode="local"
        onPreview={onPreview}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));

    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Review opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(url);
    expect(screen.getByLabelText(/Title/)).toHaveValue('');
    expect(screen.getByLabelText(/Company or client/)).toHaveValue('');
  });

  it('keeps LinkedIn links for manual entry and never sends them to the preview service', () => {
    const onPreview = vi.fn();
    const linkedInUrl = 'https://www.linkedin.com/jobs/view/4461086287/';
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={vi.fn()} onCancel={vi.fn()} />
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: linkedInUrl } });

    expect(screen.getByRole('status')).toHaveTextContent(/Automatic lookup is disabled for LinkedIn links/);
    expect(screen.queryByRole('button', { name: 'Find details' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue manually' }));

    expect(onPreview).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Review opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(linkedInUrl);
  });
  it('rejects malformed and non-HTTP URLs before making a preview request', async () => {
    const onPreview = vi.fn();
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a valid URL starting with http:// or https://.',
    );
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('prefills the editable review form with returned metadata only after the user chooses review', async () => {
    const onPreview = vi.fn().mockResolvedValue(readyPreview());
    const onSave = vi.fn();
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={onSave} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/We found a title/);
    expect(onPreview).toHaveBeenCalledWith(url);
    expect(screen.queryByRole('heading', { name: 'Review opportunity' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));

    expect(screen.getByLabelText(/Title/)).toHaveValue('Frontend Intern');
    expect(screen.getByLabelText(/Company or client/)).toHaveValue('Northwind Labs');
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(url);
    expect(screen.getByLabelText(/Description/)).toHaveValue('Work with the frontend team.');
  });

  it('prefills structured fields and shows per-field evidence until the user edits a value', async () => {
    const onPreview = vi.fn().mockResolvedValue(readyPreview({
      locations: ['Cairo, Egypt'],
      department: 'Engineering',
      team: 'Platform',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      postedDate: '2026-11-05',
      compensationDetails: {
        minAmount: '15000',
        maxAmount: '20000',
        currency: 'EGP',
        interval: 'month',
      },
      fieldEvidence: {
        locations: { source: 'provider-api', confidence: 'high', label: 'Lever Public Postings API' },
        department: { source: 'provider-api', confidence: 'high', label: 'Lever Public Postings API' },
      },
    }));
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));

    expect(screen.getByLabelText('Job locations')).toHaveValue('Cairo, Egypt');
    expect(screen.getByLabelText('Department')).toHaveValue('Engineering');
    expect(screen.getByLabelText('Team')).toHaveValue('Platform');
    expect(screen.getByLabelText('Workplace type')).toHaveValue('Hybrid');
    expect(screen.getByLabelText('Employer employment type')).toHaveValue('Full-time');
    expect(screen.getByLabelText('Posted date')).toHaveValue('2026-11-05');
    expect(screen.getByLabelText('Minimum compensation')).toHaveValue('15000');
    expect(screen.getAllByText('Source: Lever Public Postings API · high confidence')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Job locations'), {
      target: { value: 'Cairo, Egypt\nAlexandria, Egypt' },
    });
    expect(screen.getByText('Edited by you')).toBeInTheDocument();
  });

  it('preserves the pasted URL and allows manual continuation when the server is not ready', async () => {
    const onPreview = vi.fn().mockRejectedValue(
      new Error('Internal upstream details must not be shown'),
    );
    const onSave = vi.fn();
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={onSave} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Automatic lookup could not complete.',
    );
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(url);

    fireEvent.click(screen.getByRole('button', { name: 'Continue manually' }));

    expect(screen.getByRole('heading', { name: 'Review opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(url);
    expect(screen.getByLabelText(/Title/)).toHaveValue('');
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported', "We couldn't find job details on this page"],
    ['blocked', 'The job site declined the automatic request'],
    ['not-found', 'This job posting is no longer available'],
    ['timeout', 'The job site took too long to respond'],
    ['too-large', 'This job page is larger than the supported size'],
    ['unavailable', 'We could not retrieve this job page right now'],
  ] as const)(
    'explains an empty %s result and directs the user to manual adding',
    async (outcome, message) => {
      const onPreview = vi.fn().mockResolvedValue({
        outcome,
        source: 'none',
        title: '',
        company: '',
        description: '',
        compensation: '',
        locations: [],
        department: '',
        team: '',
        workplaceType: '',
        employmentType: '',
        postedDate: '',
        compensationDetails: null,
        fieldEvidence: {},
      } satisfies CapturePreviewResponse);
      const onSave = vi.fn();
      render(
        <QuickCapture mode="api" onPreview={onPreview} onSave={onSave} onCancel={vi.fn()} />,
      );

      fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
      fireEvent.click(screen.getByRole('button', { name: 'Find details' }));

      expect(await screen.findByRole('status')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: 'Continue manually' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Continue manually' }));

      expect(screen.getByRole('heading', { name: 'Review opportunity' })).toBeInTheDocument();
      expect(screen.getByLabelText('Opportunity URL')).toHaveValue(url);
      expect(screen.getByLabelText(/Title/)).toHaveValue('');
      expect(screen.getByLabelText(/Company or client/)).toHaveValue('');
      expect(screen.getByLabelText('Type *')).toHaveValue('');
      expect(screen.getByLabelText(/Job locations/)).toHaveValue('');
      expect(screen.getByLabelText(/Employer employment type/)).toHaveValue('');
      expect(screen.queryByText(/confidence/)).not.toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it('keeps successful preview fields editable and saves only through the shared form callback', async () => {
    const onPreview = vi.fn().mockResolvedValue(readyPreview());
    const onSave = vi.fn();
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={onSave} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));
    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Edited title' } });
    fireEvent.change(screen.getByLabelText(/Company or client/), { target: { value: 'Edited employer' } });
    fireEvent.change(screen.getByLabelText('Type *'), { target: { value: 'Internship' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Edited title',
        company: 'Edited employer',
        url,
        status: 'Saved',
        priority: 'Medium',
        tags: [],
      }),
    );
  });

  it('warns about archived exact duplicates but never prevents an intentional save', async () => {
    const existing = makeOpportunity({
      id: 'archived-match',
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      url,
      archivedAt: '2026-10-01T09:00:00.000Z',
    });
    const onSave = vi.fn();
    render(
      <QuickCapture
        mode="local"
        existingOpportunities={[existing]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));

    expect(screen.getByRole('status')).toHaveTextContent('Possible duplicate');
    expect(screen.getByRole('status')).toHaveTextContent('Archived');
    expect(screen.getByRole('status')).toHaveTextContent('Same opportunity URL');

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Frontend Intern' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Northwind Labs' },
    });
    fireEvent.change(screen.getByLabelText('Type *'), { target: { value: 'Internship' } });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Same opportunity URL and title/company',
    );
    const saveButton = screen.getByRole('button', { name: 'Save opportunity' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Frontend Intern',
      company: 'Northwind Labs',
      url,
    }));
  });

  it('does not allow a preview attempt while another request is in flight', async () => {
    let release: ((value: CapturePreviewResponse) => void) | undefined;
    const onPreview = vi.fn(
      () => new Promise<CapturePreviewResponse>((resolve) => { release = resolve; }),
    );
    render(
      <QuickCapture mode="api" onPreview={onPreview} onSave={vi.fn()} onCancel={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Opportunity URL'), { target: { value: url } });
    fireEvent.click(screen.getByRole('button', { name: 'Find details' }));

    expect(screen.getByRole('button', { name: 'Looking up…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    release?.(readyPreview());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review details' })).toBeEnabled());
  });
});

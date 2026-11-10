import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import { DetailsDialog } from './DetailsDialog';

describe('DetailsDialog structured job details', () => {
  it('shows the job facts and numeric salary beside the original compensation wording', () => {
    const item = makeOpportunity({
      type: 'Full-time',
      locations: ['Cairo, Egypt', 'Remote', 'Remote (Egypt)'],
      department: 'Engineering',
      team: 'Platform',
      workplaceType: '',
      employmentType: 'Remote, Full-time',
      postedDate: '2026-11-05',
      compensation: 'EGP 15,000–20,000 monthly',
      compensationDetails: {
        minAmount: '15000',
        maxAmount: '20000',
        currency: 'EGP',
        interval: 'month',
      },
    });

    render(
      <DetailsDialog
        item={item}
        onEdit={vi.fn()}
        onClose={vi.fn()}
        onArchive={vi.fn().mockResolvedValue({ ok: true, message: 'Archived.' })}
        onRestore={vi.fn().mockResolvedValue({ ok: true, message: 'Restored.' })}
        onAddActivity={vi.fn()}
        onRemoveActivity={vi.fn()}
        onAddInterview={vi.fn()}
        onUpdateInterview={vi.fn()}
        onRemoveInterview={vi.fn()}
        onInterviewStatusChange={vi.fn()}
        onAddContact={vi.fn()}
        onUpdateContact={vi.fn()}
        onRemoveContact={vi.fn()}
        onAddMaterial={vi.fn()}
        onUpdateMaterial={vi.fn()}
        onRemoveMaterial={vi.fn()}
        onMaterialStatusChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Cairo, Egypt · Egypt')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByText('Employment type')).toBeInTheDocument();
    expect(screen.getByText('Work mode')).toBeInTheDocument();
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.getByText('Full-time')).toBeInTheDocument();
    expect(screen.queryByText('Opportunity type')).not.toBeInTheDocument();
    expect(screen.queryByText('Employer employment type')).not.toBeInTheDocument();
    expect(screen.queryByText('Remote, Full-time')).not.toBeInTheDocument();
    expect(screen.getByText('Nov 5, 2026')).toBeInTheDocument();
    expect(screen.getByText('EGP 15,000–20,000 monthly')).toBeInTheDocument();
    expect(screen.getByText('15,000–20,000 EGP /month')).toBeInTheDocument();
  });
});

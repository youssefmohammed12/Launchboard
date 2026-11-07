import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeActivity, makeOpportunity } from '../test/fixtures';
import { Reports } from './Reports';

const noop = () => {};

function summaryCard(label: string): HTMLElement {
  const card = screen.getByText(label).closest('div');
  if (!card) throw new Error(`Summary card for ${label} was not found`);
  return card as HTMLElement;
}

describe('Reports', () => {
  it('uses the existing current-status definitions for its summary cards', () => {
    const items = [
      makeOpportunity({ id: 'saved', status: 'Saved', priority: 'Low' }),
      makeOpportunity({ id: 'applied', status: 'Applied', priority: 'High' }),
      makeOpportunity({ id: 'interview', status: 'Interview', priority: 'High' }),
      makeOpportunity({ id: 'offer', status: 'Offer', priority: 'Medium' }),
      makeOpportunity({ id: 'rejected', status: 'Rejected', priority: 'Low' }),
    ];

    render(<Reports items={items} onOpen={noop} onRestoreBackup={noop} />);

    expect(within(summaryCard('Total Opportunities')).getByText('5')).toBeInTheDocument();
    expect(within(summaryCard('In Progress')).getByText('3')).toBeInTheDocument();
    expect(within(summaryCard('In Interviews')).getByText('1')).toBeInTheDocument();
    expect(within(summaryCard('Offers')).getByText('1')).toBeInTheDocument();
    expect(within(summaryCard('High Priority')).getByText('2')).toBeInTheDocument();
  });

  it('excludes archived opportunities from cards, breakdowns and recent activity', () => {
    const items = [
      makeOpportunity({
        id: 'active',
        title: 'Active Role',
        status: 'Interview',
        priority: 'High',
        activities: [makeActivity({ id: 'active-activity', date: '2026-01-10' })],
      }),
      makeOpportunity({
        id: 'archived',
        title: 'Archived Role',
        status: 'Offer',
        priority: 'High',
        archivedAt: '2026-03-04T09:30:00.000Z',
        activities: [makeActivity({ id: 'archived-activity', date: '2026-01-12' })],
      }),
    ];

    render(<Reports items={items} onOpen={noop} onRestoreBackup={noop} />);

    expect(within(summaryCard('Total Opportunities')).getByText('1')).toBeInTheDocument();
    expect(within(summaryCard('In Interviews')).getByText('1')).toBeInTheDocument();
    expect(within(summaryCard('Offers')).getByText('0')).toBeInTheDocument();
    expect(within(summaryCard('High Priority')).getByText('1')).toBeInTheDocument();

    const heading = screen.getByRole('heading', { name: 'Recent activity' });
    const section = heading.closest('section');
    if (!section) throw new Error('Recent activity section was not found');
    const entries = within(section).getAllByRole('button');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toHaveTextContent('Active Role');
    expect(screen.queryByText('Archived Role')).not.toBeInTheDocument();
  });

  it('keeps export details available in a disclosure instead of expanding the page header', () => {
    render(
      <Reports
        items={[]}
        onOpen={noop}
        onRestoreBackup={noop}
        backupStorageDescription="Export files stay in your browser."
      />,
    );

    const summary = screen.getByText('About CSV and JSON exports');
    const details = summary.closest('details') as HTMLDetailsElement;

    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByText(/CSV is intended for spreadsheets/)).toBeInTheDocument();
    expect(screen.getByText(/JSON backup preserves complete opportunity records/)).toBeInTheDocument();
    expect(screen.getByText('Export files stay in your browser.')).toBeInTheDocument();
  });

  it('orders recent activity by activity date, newest first', () => {
    const items = [
      makeOpportunity({
        id: 'alpha',
        title: 'Alpha Role',
        activities: [
          makeActivity({ id: 'alpha-1', date: '2026-01-10', type: 'Application submitted' }),
        ],
      }),
      makeOpportunity({
        id: 'beta',
        title: 'Beta Role',
        activities: [
          makeActivity({ id: 'beta-1', date: '2026-01-12', type: 'Interview scheduled' }),
        ],
      }),
    ];

    render(<Reports items={items} onOpen={noop} onRestoreBackup={noop} />);

    const heading = screen.getByRole('heading', { name: 'Recent activity' });
    const section = heading.closest('section');
    if (!section) throw new Error('Recent activity section was not found');

    const entries = within(section).getAllByRole('button');

    expect(entries[0]).toHaveTextContent('Beta Role');
    expect(entries[1]).toHaveTextContent('Alpha Role');
  });
});

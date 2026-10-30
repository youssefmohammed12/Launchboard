import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { makeOpportunity } from '../test/fixtures';
import { Opportunities } from './Opportunities';

const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

function makeItems() {
  return [
    makeOpportunity({ id: 'op-1', title: 'Alpha Role', status: 'Applied' }),
    makeOpportunity({ id: 'op-2', title: 'Beta Role', status: 'Interview' }),
    makeOpportunity({ id: 'op-3', title: 'Gamma Role', status: 'Offer' }),
    makeOpportunity({
      id: 'op-4',
      title: 'Archived Role',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    }),
  ];
}

function setup(overrides: Partial<ComponentProps<typeof Opportunities>> = {}) {
  const props: ComponentProps<typeof Opportunities> = {
    items: makeItems(),
    onAdd: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onStatusChange: vi.fn(),
    selectionResetToken: 0,
    onBulkArchive: vi.fn(),
    onBulkRestore: vi.fn(),
    onBulkStatus: vi.fn(),
    onBulkDelete: vi.fn(),
    ...overrides,
  };
  const view = render(<Opportunities {...props} />);
  return { props, ...view };
}

function rowCheckbox(title: string): HTMLElement {
  return screen.getByRole('checkbox', { name: `Select ${title}` });
}

function masterCheckbox(): HTMLInputElement {
  return screen.getByRole('checkbox', {
    name: 'Select all visible opportunities',
  }) as HTMLInputElement;
}

function toolbar(): HTMLElement | null {
  return screen.queryByRole('region', { name: 'Bulk actions' });
}

describe('Opportunities selection', () => {
  it('renders an accessible checkbox for each visible row and no toolbar initially', () => {
    setup();

    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
    expect(rowCheckbox('Beta Role')).not.toBeChecked();
    expect(rowCheckbox('Gamma Role')).not.toBeChecked();
    // Archived records are not visible in the default Active view.
    expect(
      screen.queryByRole('checkbox', { name: 'Select Archived Role' }),
    ).not.toBeInTheDocument();
    expect(masterCheckbox()).not.toBeChecked();
    expect(masterCheckbox().indeterminate).toBe(false);
    expect(toolbar()).toBeNull();
  });

  it('selects individual rows by stable ID and reports the count', () => {
    const { props } = setup();

    fireEvent.click(rowCheckbox('Alpha Role'));
    fireEvent.click(rowCheckbox('Beta Role'));

    expect(rowCheckbox('Alpha Role')).toBeChecked();
    expect(rowCheckbox('Beta Role')).toBeChecked();
    expect(rowCheckbox('Gamma Role')).not.toBeChecked();
    const region = toolbar() as HTMLElement;
    expect(within(region).getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(within(region).getByRole('button', { name: 'Archive selected' }));
    expect(props.onBulkArchive).toHaveBeenCalledWith(['op-1', 'op-2'], expect.anything());
  });

  it('selects all visible rows and clears them again with the master checkbox', () => {
    setup();
    const master = masterCheckbox();

    fireEvent.click(master);

    expect(master).toBeChecked();
    expect(rowCheckbox('Alpha Role')).toBeChecked();
    expect(rowCheckbox('Beta Role')).toBeChecked();
    expect(rowCheckbox('Gamma Role')).toBeChecked();
    expect(within(toolbar() as HTMLElement).getByText('3 selected')).toBeInTheDocument();

    fireEvent.click(master);

    expect(master).not.toBeChecked();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
    expect(toolbar()).toBeNull();
  });

  it('shows an indeterminate master checkbox for a partial selection', () => {
    setup();
    const master = masterCheckbox();

    fireEvent.click(rowCheckbox('Beta Role'));

    expect(master).not.toBeChecked();
    expect(master.indeterminate).toBe(true);

    fireEvent.click(master);

    expect(master).toBeChecked();
    expect(master.indeterminate).toBe(false);
  });

  it('limits select-all to the current search result', () => {
    setup();
    const search = screen.getByLabelText('Search by title or company');

    fireEvent.change(search, { target: { value: 'Alpha' } });
    fireEvent.click(masterCheckbox());

    expect(rowCheckbox('Alpha Role')).toBeChecked();
    expect(
      screen.queryByRole('checkbox', { name: 'Select Beta Role' }),
    ).not.toBeInTheDocument();
    expect(within(toolbar() as HTMLElement).getByText('1 selected')).toBeInTheDocument();

    // Clearing the search changes the result set, so the selection is cleared
    // and the previously hidden rows are still unselected.
    fireEvent.change(search, { target: { value: '' } });
    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
    expect(rowCheckbox('Beta Role')).not.toBeChecked();
  });

  it('clears the selection when a filter or sorting changes', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));

    fireEvent.change(screen.getByLabelText('Filter by priority'), {
      target: { value: 'Medium' },
    });

    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();

    fireEvent.click(rowCheckbox('Alpha Role'));
    fireEvent.click(screen.getByRole('button', { name: /Deadline: earliest first/ }));

    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
  });

  it('clears the selection when the Active/Archived mode changes', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Archived Role')).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
    expect(toolbar()).toBeNull();
  });

  it('clears the selection when switching to Board view', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));

    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));

    expect(toolbar()).toBeNull();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
  });

  it('clears the selection with the toolbar control', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));
    fireEvent.click(rowCheckbox('Beta Role'));

    fireEvent.click(within(toolbar() as HTMLElement).getByRole('button', { name: 'Clear selection' }));

    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
    expect(rowCheckbox('Beta Role')).not.toBeChecked();
  });

  it('ignores selected IDs that are no longer visible', () => {
    const { props, rerender } = setup();
    fireEvent.click(rowCheckbox('Alpha Role'));
    expect(toolbar()).not.toBeNull();

    rerender(
      <Opportunities
        {...props}
        items={props.items.filter((item) => item.id !== 'op-1')}
      />,
    );

    // The stale ID is still in the selection set, but it is not visible and
    // therefore cannot be acted on.
    expect(toolbar()).toBeNull();
    expect(
      screen.queryByRole('checkbox', { name: 'Select Alpha Role' }),
    ).not.toBeInTheDocument();
    expect(masterCheckbox()).not.toBeChecked();
  });

  it('clears the selection when the app reports a committed bulk operation', () => {
    const { props, rerender } = setup();
    fireEvent.click(rowCheckbox('Alpha Role'));
    expect(toolbar()).not.toBeNull();

    rerender(<Opportunities {...props} selectionResetToken={1} />);

    expect(toolbar()).toBeNull();
    expect(rowCheckbox('Alpha Role')).not.toBeChecked();
  });

  it('offers restore-only bulk actions in the Archived view', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(rowCheckbox('Archived Role'));

    const region = toolbar() as HTMLElement;
    expect(within(region).getByRole('button', { name: 'Restore selected' })).toBeInTheDocument();
    expect(
      within(region).queryByRole('button', { name: 'Archive selected' }),
    ).not.toBeInTheDocument();
    expect(
      within(region).queryByLabelText('New status for selected opportunities'),
    ).not.toBeInTheDocument();

    fireEvent.click(within(region).getByRole('button', { name: 'Restore selected' }));
    expect(props.onBulkRestore).toHaveBeenCalledWith(['op-4'], expect.anything());
  });

  it('disables Apply status until a status with eligible targets is chosen', () => {
    const { props } = setup();
    fireEvent.click(rowCheckbox('Alpha Role'));

    const region = toolbar() as HTMLElement;
    const apply = within(region).getByRole('button', { name: 'Apply status' });
    const select = within(region).getByLabelText(
      'New status for selected opportunities',
    ) as HTMLSelectElement;

    expect(apply).toBeDisabled();
    expect(
      within(region).getByText('Choose a status to enable Apply status.'),
    ).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'Offer' } });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(props.onBulkStatus).toHaveBeenCalledWith(['op-1'], 'Offer', expect.anything());
  });

  it('disables Apply status when every selected record already has the target status', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));

    const region = toolbar() as HTMLElement;
    fireEvent.change(
      within(region).getByLabelText('New status for selected opportunities'),
      { target: { value: 'Applied' } },
    );

    expect(within(region).getByRole('button', { name: 'Apply status' })).toBeDisabled();
    expect(
      within(region).getByText('All selected already have this status.'),
    ).toBeInTheDocument();
  });

  it('offers Delete selected in the Active view and passes the active mode', () => {
    const { props } = setup();
    fireEvent.click(rowCheckbox('Alpha Role'));
    fireEvent.click(rowCheckbox('Beta Role'));

    const region = toolbar() as HTMLElement;
    fireEvent.click(within(region).getByRole('button', { name: 'Delete selected' }));

    expect(props.onBulkDelete).toHaveBeenCalledWith(
      ['op-1', 'op-2'],
      'active',
      expect.anything(),
    );
  });

  it('offers Delete selected in the Archived view and passes the archived mode', () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(rowCheckbox('Archived Role'));

    const region = toolbar() as HTMLElement;
    expect(
      within(region).getByRole('button', { name: 'Restore selected' }),
    ).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Delete selected' }));

    expect(props.onBulkDelete).toHaveBeenCalledWith(
      ['op-4'],
      'archived',
      expect.anything(),
    );
  });

  it('does not offer bulk delete in Board view', () => {
    setup();
    fireEvent.click(rowCheckbox('Alpha Role'));
    expect(toolbar()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Board view' }));

    expect(toolbar()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selected' })).not.toBeInTheDocument();
  });
});

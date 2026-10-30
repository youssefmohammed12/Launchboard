import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeOpportunity } from '../test/fixtures';
import { OpportunityBoard } from './OpportunityBoard';

const noop = () => {};

function renderBoard(items = [makeOpportunity()], filtering = false) {
  const onStatusChange = vi.fn();
  render(
    <OpportunityBoard
      items={items}
      filtering={filtering}
      onOpen={noop}
      onEdit={noop}
      onDelete={noop}
      onStatusChange={onStatusChange}
    />,
  );
  return { onStatusChange };
}

describe('OpportunityBoard', () => {
  it('changes status through the accessible selector when a card moves columns', () => {
    const { onStatusChange } = renderBoard();

    const select = screen.getByLabelText('Change status for Frontend Intern');
    expect(select).toHaveValue('Applied');

    fireEvent.change(select, { target: { value: 'Interview' } });

    expect(onStatusChange).toHaveBeenCalledWith('op-1', 'Interview');
  });

  it('explains when filtering leaves a column empty', () => {
    renderBoard([], true);

    expect(screen.getAllByText('No matching opportunities.')).toHaveLength(5);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OpportunityForm } from './OpportunityForm';

function renderForm() {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<OpportunityForm onSave={onSave} onCancel={onCancel} />);
  return { onSave, onCancel };
}

describe('OpportunityForm', () => {
  it('shows the required-field errors and does not save an invalid form', () => {
    const { onSave } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Title is required.')).toBeInTheDocument();
    expect(screen.getByText('Company or client is required.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('trims core text fields and saves valid data', () => {
    const { onSave } = renderForm();

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: '  Frontend Intern  ' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: '  Northwind Labs  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Frontend Intern',
        company: 'Northwind Labs',
        type: 'Internship',
        status: 'Saved',
        priority: 'Medium',
        tags: [],
      }),
    );
  });

  it('keeps the form open and shows an asynchronous server save error', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('This opportunity changed on the server. Reload and try again.');
    });
    render(<OpportunityForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Frontend Intern' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Northwind Labs' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This opportunity changed on the server. Reload and try again.',
    );
    expect(screen.getByRole('heading', { name: 'Add opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Title/)).toHaveValue('Frontend Intern');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('rejects an invalid application URL', () => {
    const { onSave } = renderForm();

    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Frontend Intern' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Northwind Labs' },
    });
    fireEvent.change(screen.getByLabelText(/Application URL/), {
      target: { value: 'not-a-url' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      screen.getByText('Enter a valid URL starting with http:// or https://.'),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

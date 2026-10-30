import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContactEntry, InterviewEntry } from '../types/opportunity';
import { makeContact, makeInterview } from '../test/fixtures';
import { formatDate } from '../utils/dates';
import { MAX_INTERVIEWS } from '../utils/interviews';
import { InterviewSection } from './InterviewSection';

function renderSection(
  interviews: InterviewEntry[] = [makeInterview()],
  contacts: ContactEntry[] = [],
) {
  const onAddInterview = vi.fn();
  const onUpdateInterview = vi.fn();
  const onRemoveInterview = vi.fn();
  const onInterviewStatusChange = vi.fn();

  render(
    <InterviewSection
      interviews={interviews}
      contacts={contacts}
      onAddInterview={onAddInterview}
      onUpdateInterview={onUpdateInterview}
      onRemoveInterview={onRemoveInterview}
      onInterviewStatusChange={onInterviewStatusChange}
    />,
  );

  return { onAddInterview, onUpdateInterview, onRemoveInterview, onInterviewStatusChange };
}

describe('InterviewSection', () => {
  it('shows an empty state and an add action', () => {
    renderSection([]);

    expect(screen.getByRole('heading', { name: 'Interviews' })).toBeInTheDocument();
    expect(screen.getByText(/No interviews yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add interview' })).toBeInTheDocument();
  });

  it('disables adding rounds at the collection limit', () => {
    renderSection(
      Array.from({ length: MAX_INTERVIEWS }, (_, index) =>
        makeInterview({ id: `round-${index}` }),
      ),
    );

    expect(screen.getByRole('button', { name: 'Add interview' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${MAX_INTERVIEWS}-interview limit`))).toBeInTheDocument();
  });

  it('renders interview details, status, outcome, links and notes', () => {
    const scheduled = makeInterview({
      id: 'round-1',
      round: 'Technical Interview',
      date: '2026-02-03',
      time: '14:30',
      mode: 'In person',
      meetingUrl: 'https://meet.example.com/abc',
      location: 'Northwind HQ',
      preparationNotes: 'Review the design system.',
      notes: 'Bring two questions.',
    });
    const completed = makeInterview({
      id: 'round-2',
      round: 'Final Interview',
      date: '2026-02-10',
      time: '',
      status: 'Completed',
      outcome: 'Positive',
    });

    renderSection([scheduled, completed]);

    expect(screen.getByText('Technical Interview')).toBeInTheDocument();
    expect(
      screen.getByText(`${formatDate(scheduled.date)} at ${scheduled.time}`),
    ).toBeInTheDocument();
    expect(screen.getByText('In person')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Positive')).toBeInTheDocument();
    expect(screen.getByText('Northwind HQ')).toBeInTheDocument();
    expect(screen.getByText('Review the design system.')).toBeInTheDocument();
    expect(screen.getByText('Bring two questions.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meeting link for Technical Interview' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    );
  });

  it('shows only the linked contact name and role in interview details', () => {
    const contact = makeContact({
      id: 'contact-1',
      name: 'Jordan Lee',
      role: 'Recruiter',
      email: 'jordan.lee@example.com',
      phone: '+1 555 010 2030',
      notes: 'Private contact note.',
    });
    renderSection([makeInterview({ id: 'round-1', contactId: 'contact-1' })], [contact]);

    expect(screen.getByText('Jordan Lee — Recruiter')).toBeInTheDocument();
    expect(screen.queryByText(contact.email)).not.toBeInTheDocument();
    expect(screen.queryByText(contact.phone)).not.toBeInTheDocument();
    expect(screen.queryByText(contact.notes)).not.toBeInTheDocument();
  });

  it('does not show a contact for an unresolved reference', () => {
    renderSection([makeInterview({ id: 'round-1', contactId: 'missing-contact' })], []);

    expect(screen.queryByText(/^Contact:/)).not.toBeInTheDocument();
  });

  it('associates a contact while creating an interview', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter' });
    const { onAddInterview } = renderSection([], [contact]);

    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Recruiter Screen' },
    });
    fireEvent.change(screen.getByLabelText(/Contact/), {
      target: { value: 'contact-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onAddInterview).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1' }),
    );
  });

  it('changes and clears an interview contact association', () => {
    const first = makeContact({ id: 'contact-1', name: 'Jordan Lee', role: 'Recruiter' });
    const second = makeContact({ id: 'contact-2', name: 'Sam Rivera', role: 'Hiring Manager' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const { onUpdateInterview } = renderSection([interview], [first, second]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Recruiter Screen' }));
    expect(screen.getByLabelText(/Contact/)).toHaveValue('contact-1');
    fireEvent.change(screen.getByLabelText(/Contact/), {
      target: { value: 'contact-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onUpdateInterview).toHaveBeenNthCalledWith(
      1,
      'round-1',
      expect.objectContaining({ contactId: 'contact-2' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Recruiter Screen' }));
    fireEvent.change(screen.getByLabelText(/Contact/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onUpdateInterview).toHaveBeenNthCalledWith(
      2,
      'round-1',
      expect.objectContaining({ contactId: '' }),
    );
  });

  it('validates the add form and saves a new interview', () => {
    const { onAddInterview } = renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));
    expect(screen.getByRole('heading', { name: 'Add interview' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Interview date/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(screen.getByText('Enter a round or name.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid interview date.')).toBeInTheDocument();
    expect(onAddInterview).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: '  Hiring Manager Interview  ' },
    });
    fireEvent.change(screen.getByLabelText(/Interview date/), {
      target: { value: '2026-05-01' },
    });
    fireEvent.change(screen.getByLabelText(/Interview time/), {
      target: { value: '09:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onAddInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        round: 'Hiring Manager Interview',
        date: '2026-05-01',
        time: '09:30',
        mode: 'Video',
        status: 'Scheduled',
        outcome: '',
      }),
    );
  });

  it('edits one round and can cancel without saving', () => {
    const interview = makeInterview({
      id: 'round-1',
      round: 'Recruiter Screen',
      contactId: 'contact-7',
    });
    const contact = makeContact({ id: 'contact-7', name: 'Jordan Lee', role: 'Recruiter' });
    const { onUpdateInterview } = renderSection([interview], [contact]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Recruiter Screen' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Hiring Manager Interview' },
    });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Completed' } });
    fireEvent.change(screen.getByLabelText(/Outcome/), { target: { value: 'Positive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onUpdateInterview).toHaveBeenCalledWith(
      'round-1',
      expect.objectContaining({
        round: 'Hiring Manager Interview',
        status: 'Completed',
        outcome: 'Positive',
        contactId: 'contact-7',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Recruiter Screen' }));
    fireEvent.change(screen.getByLabelText(/Round or name/), {
      target: { value: 'Discarded change' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onUpdateInterview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Edit interview' })).not.toBeInTheDocument();
  });

  it('marks rounds completed, cancels them, and records an outcome', () => {
    const scheduled = makeInterview({ id: 'round-1' });
    const first = renderSection([scheduled]);

    fireEvent.click(screen.getByRole('button', { name: 'Mark completed: Recruiter Screen' }));
    expect(first.onInterviewStatusChange).toHaveBeenCalledWith('round-1', 'Completed');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel interview: Recruiter Screen' }));
    expect(first.onInterviewStatusChange).toHaveBeenCalledWith('round-1', 'Cancelled');

    const second = renderSection([
      makeInterview({ id: 'round-2', round: 'Final Interview', status: 'Completed', outcome: '' }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Record outcome for Final Interview' }));
    fireEvent.change(screen.getByLabelText(/Outcome/), { target: { value: 'Negative' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(second.onUpdateInterview).toHaveBeenCalledWith(
      'round-2',
      expect.objectContaining({ status: 'Completed', outcome: 'Negative' }),
    );
  });

  it('reschedules a cancelled round through the shared form', () => {
    const cancelled = makeInterview({
      id: 'round-1',
      status: 'Cancelled',
      date: '2026-01-10',
      time: '10:00',
    });
    const { onUpdateInterview } = renderSection([cancelled]);

    fireEvent.click(screen.getByRole('button', { name: 'Reschedule: Recruiter Screen' }));
    expect(screen.getByLabelText('Status')).toHaveValue('Scheduled');
    expect(screen.getByLabelText(/Outcome/)).toHaveValue('');

    fireEvent.change(screen.getByLabelText(/Interview date/), {
      target: { value: '2026-04-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));

    expect(onUpdateInterview).toHaveBeenCalledWith(
      'round-1',
      expect.objectContaining({
        date: '2026-04-01',
        status: 'Scheduled',
        outcome: '',
      }),
    );
  });

  it('confirms deletion and allows keeping the interview', () => {
    const { onRemoveInterview } = renderSection([makeInterview({ id: 'round-1' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Recruiter Screen' }));
    expect(screen.getByText(/Delete this interview/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep interview: Recruiter Screen' }));
    expect(onRemoveInterview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Recruiter Screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete interview: Recruiter Screen' }));

    expect(onRemoveInterview).toHaveBeenCalledWith('round-1');
  });

  it('exposes labelled controls and accessible validation errors', () => {
    renderSection([]);
    fireEvent.click(screen.getByRole('button', { name: 'Add interview' }));

    expect(screen.getByLabelText(/Round or name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Interview date/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Interview time/)).toBeInTheDocument();
    expect(screen.getByLabelText('Mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact/)).toBeInTheDocument();
    expect(
      screen.getByText('Add a contact in the Contacts section to link one to this round.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Outcome/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Location/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Meeting URL/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preparation notes/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save interview' }));
    const error = screen.getByText('Enter a round or name.');
    expect(error).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText(/Round or name/)).toHaveAttribute(
      'aria-describedby',
      'interview-round-err',
    );
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ContactEntry, InterviewEntry } from '../types/opportunity';
import { makeContact, makeInterview } from '../test/fixtures';
import { MAX_CONTACTS } from '../utils/contacts';
import { ContactSection } from './ContactSection';

function renderSection(
  contacts: ContactEntry[] = [makeContact()],
  interviews: InterviewEntry[] = [],
) {
  const onAddContact = vi.fn();
  const onUpdateContact = vi.fn();
  const onRemoveContact = vi.fn();

  render(
    <ContactSection
      contacts={contacts}
      interviews={interviews}
      onAddContact={onAddContact}
      onUpdateContact={onUpdateContact}
      onRemoveContact={onRemoveContact}
    />,
  );

  return { onAddContact, onUpdateContact, onRemoveContact };
}

describe('ContactSection', () => {
  it('shows an empty state and an add action', () => {
    renderSection([]);

    expect(screen.getByRole('heading', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByText(/No contacts yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();
  });

  it('disables adding contacts at the collection limit', () => {
    renderSection(
      Array.from({ length: MAX_CONTACTS }, (_, index) =>
        makeContact({ id: `contact-${index}`, name: `Contact ${index}` }),
      ),
    );

    expect(screen.getByRole('button', { name: 'Add contact' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${MAX_CONTACTS}-contact limit`))).toBeInTheDocument();
  });

  it('renders contact details, links, notes and linked interview counts', () => {
    const contact = makeContact({
      id: 'contact-1',
      name: 'Jordan Lee',
      role: 'Recruiter',
      email: 'jordan.lee@example.com',
      phone: '+1 555 010 2030',
      website: 'https://example.com/jordan',
      notes: 'Prefers email.',
    });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });

    renderSection([contact], [interview]);

    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Recruiter')).toBeInTheDocument();
    expect(screen.getByText('Prefers email.')).toBeInTheDocument();
    expect(screen.getByText('Linked to 1 interview.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Email Jordan Lee' })).toHaveAttribute(
      'href',
      'mailto:jordan.lee@example.com',
    );
    expect(screen.getByRole('link', { name: 'Call Jordan Lee' })).toHaveAttribute(
      'href',
      'tel:+15550102030',
    );
    expect(screen.getByRole('link', { name: 'Website for Jordan Lee' })).toHaveAttribute(
      'href',
      'https://example.com/jordan',
    );
    expect(
      screen.getByRole('link', { name: 'Website for Jordan Lee' }),
    ).toHaveAttribute('target', '_blank');
    expect(
      screen.getByRole('link', { name: 'Website for Jordan Lee' }),
    ).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits links for empty optional fields', () => {
    renderSection([makeContact({ email: '', phone: '', website: '' })]);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('validates the add form and saves a trimmed contact', () => {
    const { onAddContact } = renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(screen.getByRole('heading', { name: 'Add contact' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Name/)).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));
    expect(screen.getByText('Enter a contact name.')).toBeInTheDocument();
    expect(onAddContact).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: '  Alex Chen  ' } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText(/Website or profile URL/), {
      target: { value: 'ftp://example.com/profile' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a valid URL starting with http:// or https://.'),
    ).toBeInTheDocument();
    expect(onAddContact).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: '  alex@example.com  ' },
    });
    fireEvent.change(screen.getByLabelText(/Website or profile URL/), {
      target: { value: '  https://example.com/alex  ' },
    });
    fireEvent.change(screen.getByLabelText(/Role or title/), {
      target: { value: '  Engineering Manager  ' },
    });
    fireEvent.change(screen.getByLabelText(/Phone/), {
      target: { value: '  +33 (0)6 12 34 56 78  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    expect(onAddContact).toHaveBeenCalledWith({
      name: 'Alex Chen',
      role: 'Engineering Manager',
      email: 'alex@example.com',
      phone: '+33 (0)6 12 34 56 78',
      website: 'https://example.com/alex',
      notes: '',
    });
  });

  it('edits one contact and can cancel without saving', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const { onUpdateContact } = renderSection([contact]);

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact Jordan Lee' }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Jordan A. Lee' } });
    fireEvent.change(screen.getByLabelText(/Role or title/), {
      target: { value: 'Talent Partner' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save contact' }));

    expect(onUpdateContact).toHaveBeenCalledWith(
      'contact-1',
      expect.objectContaining({ name: 'Jordan A. Lee', role: 'Talent Partner' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit contact Jordan Lee' }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'Discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onUpdateContact).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Edit contact' })).not.toBeInTheDocument();
  });

  it('warns about linked interviews and confirms deletion explicitly', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const interviews = [
      makeInterview({ id: 'round-1', contactId: 'contact-1' }),
      makeInterview({ id: 'round-2', date: '2026-02-01', contactId: 'contact-1' }),
    ];
    const { onRemoveContact } = renderSection([contact], interviews);

    fireEvent.click(screen.getByRole('button', { name: 'Delete contact Jordan Lee' }));
    expect(screen.getByText(/linked to 2 interviews/)).toBeInTheDocument();
    expect(screen.getByText(/keep the interview records/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep contact: Jordan Lee' }));
    expect(onRemoveContact).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete contact Jordan Lee' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete contact: Jordan Lee' }));

    expect(onRemoveContact).toHaveBeenCalledWith('contact-1');
  });

  it('confirms deletion for an unlinked contact', () => {
    const { onRemoveContact } = renderSection([makeContact({ id: 'contact-1' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Delete contact Jordan Lee' }));
    expect(screen.getByText('Delete this contact?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete contact: Jordan Lee' }));
    expect(onRemoveContact).toHaveBeenCalledWith('contact-1');
  });

  it('restores focus to the add button after cancelling the form', async () => {
    renderSection([]);

    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add contact' })).toHaveFocus(),
    );
  });
});

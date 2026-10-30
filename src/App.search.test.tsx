import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeActivity, makeContact, makeInterview, makeMaterial, makeOpportunity } from './test/fixtures';
import App from './App';

const KEY = 'launchboard.opportunities.v1';
const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

function store(items: unknown[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

function openSearch(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Search Launchboard' }));
  return screen.getByRole('combobox', { name: 'Search Launchboard' });
}

function typeQuery(input: HTMLElement, value: string): void {
  fireEvent.change(input, { target: { value } });
}

describe('App global search', () => {
  it('opens with focus in the input and shows empty, no-result and result states', () => {
    store([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]);
    render(<App />);

    const input = openSearch();
    expect(input).toHaveFocus();
    expect(screen.getByText('Search everything in Launchboard')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Type to search across Launchboard.');

    typeQuery(input, 'nothing-matches');
    expect(screen.getByText('No matches for “nothing-matches”.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No results.');

    typeQuery(input, 'frontend');
    const option = screen.getByRole('option', { name: /Frontend Intern/ });
    expect(within(option).getByText('Opportunity')).toBeInTheDocument();
    expect(option).toHaveTextContent('Northwind Labs');

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(screen.getByText('Search everything in Launchboard')).toBeInTheDocument();
  });

  it('opens the matching opportunity from an opportunity result', () => {
    store([
      makeOpportunity({ id: 'op-1', title: 'Frontend Intern' }),
      makeOpportunity({ id: 'op-2', title: 'Junior React Developer', company: 'Acme' }),
    ]);
    render(<App />);

    const input = openSearch();
    typeQuery(input, 'junior react');
    fireEvent.click(screen.getByRole('option', { name: /Junior React Developer/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Junior React Developer' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Search Launchboard' })).not.toBeInTheDocument();
  });

  it('navigates by keyboard and opens the active result with Enter', () => {
    store([
      makeOpportunity({ id: 'op-1', title: 'Frontend Intern' }),
      makeOpportunity({ id: 'op-2', title: 'Frontend Engineer', company: 'Acme' }),
    ]);
    render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('combobox', { name: 'Search Launchboard' });
    typeQuery(input, 'frontend');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(input).toHaveAttribute('aria-activedescendant', options[0].id);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Enter' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Frontend Engineer' })).toBeInTheDocument();
  });

  it('opens the parent opportunity and focuses each kind of child record', async () => {
    store([
      makeOpportunity({
        id: 'op-1',
        title: 'Frontend Intern',
        interviews: [
          makeInterview({ id: 'round-1', round: 'Hiring Manager Interview' }),
        ],
        contacts: [makeContact({ id: 'contact-1', name: 'Jordan Lee' })],
        materials: [makeMaterial({ id: 'material-1', label: 'Frontend Resume' })],
        activities: [
          makeActivity({
            id: 'activity-1',
            type: 'Application submitted',
            note: 'Sent a referral note.',
          }),
        ],
      }),
    ]);
    render(<App />);

    const cases = [
      { query: 'Hiring Manager', option: /Hiring Manager Interview/, focusId: 'details-interview-round-1' },
      { query: 'Jordan Lee', option: /Jordan Lee/, focusId: 'details-contact-contact-1' },
      { query: 'Frontend Resume', option: /Frontend Resume/, focusId: 'details-material-material-1' },
      { query: 'referral note', option: /Application submitted/, focusId: 'details-activity-activity-1' },
    ];

    for (const { query, option, focusId } of cases) {
      const input = openSearch();
      typeQuery(input, query);
      fireEvent.click(screen.getByRole('option', { name: option }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: 'Frontend Intern' })).toBeInTheDocument();
      expect(document.getElementById(focusId)).toHaveFocus();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Search Launchboard' })).toHaveFocus(),
      );
    }
  });

  it('excludes archived opportunities by default and includes them on request without restoring', () => {
    store([
      makeOpportunity({ id: 'op-1', title: 'Active Analyst' }),
      makeOpportunity({ id: 'op-2', title: 'Archived Analyst', archivedAt: ARCHIVED_AT }),
    ]);
    render(<App />);

    const input = openSearch();
    typeQuery(input, 'analyst');

    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: /Active Analyst/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Archived Analyst/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Include archived opportunities'));
    const archivedOption = screen.getByRole('option', { name: /Archived Analyst/ });
    expect(within(archivedOption).getByText('Archived')).toBeInTheDocument();

    fireEvent.click(archivedOption);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Archived Analyst' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Restore' })).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { archivedAt?: string }[];
    expect(stored[1].archivedAt).toBe(ARCHIVED_AT);
  });

  it('reports truncation when more than the result limit match', () => {
    store(
      Array.from({ length: 21 }, (_, index) =>
        makeOpportunity({ id: `op-${index + 1}`, title: `Role ${index + 1}` }),
      ),
    );
    render(<App />);

    const input = openSearch();
    typeQuery(input, 'role');

    expect(screen.getAllByRole('option')).toHaveLength(20);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing the first 20 of 21 matches. Narrow your search to see more.',
    );
  });

  it('restores focus when search closes without a selection', async () => {
    store([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]);
    render(<App />);

    const trigger = screen.getByRole('button', { name: 'Search Launchboard' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');

    // The native close event is what an Escape keypress ultimately fires.
    fireEvent(dialog, new Event('close'));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('opens with Ctrl+K or Cmd+K but not while typing or while a dialog is open', () => {
    store([makeOpportunity({ id: 'op-1', title: 'Frontend Intern' })]);
    render(<App />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('combobox', { name: 'Search Launchboard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.getByRole('combobox', { name: 'Search Launchboard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));

    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    const filter = screen.getByLabelText('Search by title or company');
    filter.focus();
    fireEvent.keyDown(filter, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('combobox', { name: 'Search Launchboard' })).not.toBeInTheDocument();

    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(textarea, select, editable);
    fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(select, { key: 'k', ctrlKey: true });
    fireEvent.keyDown(editable, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('combobox', { name: 'Search Launchboard' })).not.toBeInTheDocument();
    textarea.remove();
    select.remove();
    editable.remove();

    fireEvent.click(screen.getByRole('button', { name: 'View Frontend Intern' }));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('combobox', { name: 'Search Launchboard' })).not.toBeInTheDocument();
  });
});

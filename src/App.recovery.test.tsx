import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { makeOpportunity } from './test/fixtures';

const KEY = 'launchboard.opportunities.v1';
const RECOVERY_KEY = 'launchboard.recovery.raw.v1';

let createdBlobs: Blob[] = [];
let downloadedNames: string[] = [];

beforeEach(() => {
  createdBlobs = [];
  downloadedNames = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return `blob:recovery-${createdBlobs.length}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedNames.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function addOpportunity(title: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add Opportunity' }));
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: title } });
  fireEvent.change(screen.getByLabelText(/Company or client/), { target: { value: 'Acme' } });
  fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Internship' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('App storage recovery', () => {
  it('preserves malformed JSON, explains the state, and downloads the exact raw text', async () => {
    const raw = '{"opportunities": [';
    localStorage.setItem(KEY, raw);

    render(<App />);

    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Saved opportunities could not be read');
    expect(notice).toHaveTextContent('preserved locally as a recovery copy');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
    // Displaying the warning alone must not write a replacement collection.
    expect(localStorage.getItem(KEY)).toBe(raw);

    fireEvent.click(screen.getByRole('button', { name: 'Download recovery copy' }));

    expect(downloadedNames[0]).toMatch(/^launchboard-recovery-raw-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(createdBlobs[0]).toBeDefined();
    expect(createdBlobs[0].type).toBe('text/plain;charset=utf-8');
    expect(await blobText(createdBlobs[0])).toBe(raw);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it('captures a manual URL in LocalStorage mode without sending it to the preview API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick Capture' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Quick Capture does not send your link to a server in this mode',
    );
    fireEvent.change(screen.getByLabelText('Opportunity URL'), {
      target: { value: 'https://jobs.example.org/roles/local-frontend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));

    expect(screen.getByRole('heading', { name: 'Review opportunity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Opportunity URL')).toHaveValue(
      'https://jobs.example.org/roles/local-frontend',
    );
    fireEvent.change(screen.getByLabelText(/Title/), {
      target: { value: 'Local Frontend Intern' },
    });
    fireEvent.change(screen.getByLabelText(/Company or client/), {
      target: { value: 'Northwind Labs' },
    });
    fireEvent.change(screen.getByLabelText(/Type/), { target: { value: 'Internship' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opportunity' }));

    expect(await screen.findByText('Local Frontend Intern')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Array<{
      title: string;
      company: string;
      url: string;
    }>;
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Local Frontend Intern',
        company: 'Northwind Labs',
        url: 'https://jobs.example.org/roles/local-frontend',
      }),
    ]));
  });

  it('passes archived LocalStorage opportunities into Quick Capture duplicate warnings', () => {
    localStorage.clear();
    localStorage.setItem(KEY, JSON.stringify([
      makeOpportunity({
        id: 'archived-local-match',
        title: 'Frontend Intern',
        company: 'Northwind Labs',
        url: 'https://jobs.example.org/roles/frontend-intern',
        archivedAt: '2026-10-20T08:00:00.000Z',
      }),
    ]));

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Quick Capture' }));
    fireEvent.change(screen.getByLabelText('Opportunity URL'), {
      target: { value: 'https://jobs.example.org/roles/frontend-intern' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to details' }));

    expect(screen.getByRole('status')).toHaveTextContent('Possible duplicate');
    expect(screen.getByRole('status')).toHaveTextContent('Frontend Intern');
    expect(screen.getByRole('status')).toHaveTextContent('Archived');
    expect(screen.getByRole('button', { name: 'Save opportunity' })).toBeEnabled();
  });

  it('treats a non-array root the same way instead of as an empty collection', () => {
    const raw = JSON.stringify({ records: [] });
    localStorage.setItem(KEY, raw);

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('Saved opportunities could not be read');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('excludes duplicate IDs deterministically and persists the normalized collection on the next write', () => {
    const raw = JSON.stringify([
      makeOpportunity({ id: 'op-1', title: 'First Role' }),
      makeOpportunity({ id: 'op-1', title: 'Duplicate Role' }),
      makeOpportunity({ id: 'op-2', title: 'Second Role' }),
    ]);
    localStorage.setItem(KEY, raw);

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '1 duplicate opportunity record was excluded from the active collection',
    );
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);

    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    addOpportunity('New Role');

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      id: string;
      title: string;
    }[];
    expect(stored.map((item) => item.title)).toEqual(['First Role', 'Second Role', 'New Role']);
    expect(new Set(stored.map((item) => item.id)).size).toBe(stored.length);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(screen.getByRole('alert')).toHaveTextContent('has since been saved');
  });

  it('blocks every write and keeps the original value when preservation conflicts', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);
    localStorage.setItem(RECOVERY_KEY, 'earlier recovery');

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('saving is disabled to protect');
    expect(screen.queryByRole('button', { name: 'Download recovery copy' })).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier recovery');

    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    addOpportunity('Should Not Save');

    const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '');
    expect(alerts.some((text) => text.includes('Changes could not be saved'))).toBe(true);
    expect(screen.getByRole('heading', { name: 'Add opportunity' })).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier recovery');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('surfaces a retained recovery copy after reload, downloads it exactly, and removes it only after confirmation', async () => {
    const primary = JSON.stringify([makeOpportunity({ id: 'kept', title: 'Kept Role' })]);
    const raw = '{"old":true}';
    localStorage.setItem(KEY, primary);
    localStorage.setItem(RECOVERY_KEY, raw);

    render(<App />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('A recovery copy is available');
    expect(notice).toHaveTextContent('may not be a valid Launchboard backup');

    fireEvent.click(screen.getByRole('button', { name: 'Download recovery copy' }));

    expect(downloadedNames[0]).toMatch(/^launchboard-recovery-raw-\d{4}-\d{2}-\d{2}\.txt$/);
    expect(await blobText(createdBlobs[0])).toBe(raw);

    fireEvent.click(screen.getByRole('button', { name: 'Remove recovery copy' }));
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(
      screen.getByRole('group', { name: 'Confirm recovery copy removal' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove permanently' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBe(primary);
  });

  it('exposes both conflicting payloads and replaces only after acknowledgement and confirmation', async () => {
    const raw = '{not-json';
    const earlier = 'earlier recovery';
    localStorage.setItem(KEY, raw);
    localStorage.setItem(RECOVERY_KEY, earlier);

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('Saved opportunities could not be read');
    expect(
      screen.getByRole('button', { name: 'Download previous recovery copy' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download current unreadable data' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Download previous recovery copy' }));
    expect(await blobText(createdBlobs[0])).toBe(earlier);
    fireEvent.click(screen.getByRole('button', { name: 'Download current unreadable data' }));
    expect(await blobText(createdBlobs[1])).toBe(raw);
    expect(downloadedNames[1]).toMatch(/^launchboard-unreadable-primary-\d{4}-\d{2}-\d{2}\.txt$/);

    const replaceButton = screen.getByRole('button', { name: 'Replace recovery copy' });
    expect(replaceButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I have downloaded or otherwise safely retained the earlier recovery copy/,
      }),
    );
    expect(replaceButton).not.toBeDisabled();

    fireEvent.click(replaceButton);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(earlier);
    expect(
      screen.getByRole('group', { name: 'Resolve conflicting recovery copies' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Replace and unblock saving' }));

    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(screen.getByRole('alert')).toHaveTextContent('preserved locally as a recovery copy');

    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    addOpportunity('New Role');

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored.map((item) => item.title)).toEqual(['New Role']);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it('keeps writes blocked and both payloads unchanged when conflict replacement fails', () => {
    const raw = '{not-json';
    const earlier = 'earlier recovery';
    localStorage.setItem(KEY, raw);
    localStorage.setItem(RECOVERY_KEY, earlier);

    render(<App />);

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /I have downloaded or otherwise safely retained the earlier recovery copy/,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace recovery copy' }));

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === RECOVERY_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        originalSetItem.call(localStorage, key, value);
      });

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Replace and unblock saving' }));

      expect(localStorage.getItem(KEY)).toBe(raw);
      expect(localStorage.getItem(RECOVERY_KEY)).toBe(earlier);
      expect(screen.getByRole('alert')).toHaveTextContent('Saving remains disabled');

      fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
      addOpportunity('Should Not Save');

      const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '');
      expect(alerts.some((text) => text.includes('Changes could not be saved'))).toBe(true);
      expect(screen.getByRole('heading', { name: 'Add opportunity' })).toBeInTheDocument();
      expect(localStorage.getItem(KEY)).toBe(raw);
      expect(localStorage.getItem(RECOVERY_KEY)).toBe(earlier);
    } finally {
      setItem.mockRestore();
    }
  });

  it('retries a failed initial preservation and then saves normally', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === RECOVERY_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        originalSetItem.call(localStorage, key, value);
      });

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('could not be preserved');
    expect(
      screen.getByRole('button', { name: 'Retry preserving recovery copy' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();

    setItem.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Retry preserving recovery copy' }));

    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(screen.getByRole('alert')).toHaveTextContent('preserved locally as a recovery copy');

    fireEvent.click(screen.getByRole('button', { name: 'Opportunities' }));
    addOpportunity('New Role');

    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored.map((item) => item.title)).toEqual(['New Role']);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it('keeps the retained recovery notice and copy when removal fails', () => {
    const primary = JSON.stringify([makeOpportunity({ id: 'kept' })]);
    const raw = 'earlier raw payload';
    localStorage.setItem(KEY, primary);
    localStorage.setItem(RECOVERY_KEY, raw);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove recovery copy' }));

    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Remove permanently' }));

      expect(screen.getByRole('status')).toHaveTextContent('could not be removed');
      expect(localStorage.getItem(KEY)).toBe(primary);
      expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    } finally {
      removeItem.mockRestore();
    }
  });

  it('dismisses the notice for the session without deleting the recovery copy', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss storage recovery notice' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
  });

  it('keeps a valid empty array as an empty collection without seeding or warning', () => {
    localStorage.setItem(KEY, '[]');

    render(<App />);

    expect(screen.queryByText(/could not read/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe('[]');
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reports' }));
    expect(screen.getByText('Total Opportunities').closest('div')).toHaveTextContent('0');
  });

  it('still follows first-run seeding when the key is genuinely absent', async () => {
    render(<App />);

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toHaveLength(6);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });
});

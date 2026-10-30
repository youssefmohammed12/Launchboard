import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageOpportunityRepository } from './opportunityRepository';
import { makeOpportunity } from '../test/fixtures';

const KEY = 'launchboard.opportunities.v1';
const RECOVERY_KEY = 'launchboard.recovery.raw.v1';

const repository = new LocalStorageOpportunityRepository();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocalStorageOpportunityRepository', () => {
  it('loads through the authoritative normalizer and exposes recovery metadata', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Kept' }),
        makeOpportunity({ id: 'op-1', title: 'Duplicate' }),
      ]),
    );

    const result = repository.load();

    // Duplicate repair is storage behaviour; the adapter must not reimplement it.
    expect(result.items.map((item) => item.title)).toEqual(['Kept']);
    expect(result.duplicateCount).toBe(1);
    expect(result.recovery.kind).toBe('duplicates');
    expect(localStorage.getItem(RECOVERY_KEY)).not.toBeNull();
  });

  it('saves the complete candidate collection and reports success', () => {
    const items = [makeOpportunity({ id: 'op-1', title: 'Stored Role' })];

    expect(repository.save(items)).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(items);
  });

  it('reports a storage failure as false without claiming success', () => {
    repository.load();
    const before = localStorage.getItem(KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    expect(repository.save([makeOpportunity()])).toBe(false);

    setItem.mockRestore();
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it('keeps the storage write block authoritative for unreadable primary data', () => {
    const corrupt = '{"not":"an array"}';
    localStorage.setItem(KEY, corrupt);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    const loaded = repository.load();
    expect(loaded.writesBlocked).toBe(true);

    setItem.mockRestore();
    // Preservation failed, so even a now-working write must be refused.
    expect(repository.save([])).toBe(false);
    expect(localStorage.getItem(KEY)).toBe(corrupt);
  });

  it('delegates recovery removal to storage', () => {
    localStorage.setItem(KEY, JSON.stringify([makeOpportunity()]));
    localStorage.setItem(RECOVERY_KEY, 'earlier payload');

    expect(repository.load().recovery.kind).toBe('retained');
    const result = repository.removeRecovery();

    expect(result.ok).toBe(true);
    expect(result.recovery.kind).toBe('none');
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });
});

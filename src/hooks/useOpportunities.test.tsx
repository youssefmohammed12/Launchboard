import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOpportunities } from './useOpportunities';
import { makeOpportunity } from '../test/fixtures';

const KEY = 'launchboard.opportunities.v1';
const RECOVERY_KEY = 'launchboard.recovery.raw.v1';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOpportunities', () => {
  it('persists a candidate before exposing it and keeps storage in sync', () => {
    localStorage.setItem(KEY, JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Before' })]));
    const { result } = renderHook(() => useOpportunities());

    const next = [...result.current.items, makeOpportunity({ id: 'op-2', title: 'After' })];
    let saved: boolean | undefined;
    act(() => {
      saved = result.current.commitCandidate(next);
    });

    expect(saved).toBe(true);
    expect(result.current.items.map((item) => item.title)).toEqual(['Before', 'After']);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored.map((item) => item.title)).toEqual(['Before', 'After']);
  });

  it('leaves the collection and recovery state unchanged when persistence fails', () => {
    localStorage.setItem(KEY, JSON.stringify([makeOpportunity({ id: 'op-1', title: 'Stored' })]));
    const { result } = renderHook(() => useOpportunities());
    const beforeItems = result.current.items;
    const beforeRecovery = result.current.recovery;

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });
    let saved: boolean | undefined;
    act(() => {
      saved = result.current.commitCandidate([
        ...beforeItems,
        makeOpportunity({ id: 'op-2', title: 'Not saved' }),
      ]);
    });
    setItem.mockRestore();

    expect(saved).toBe(false);
    expect(result.current.items).toBe(beforeItems);
    expect(result.current.recovery).toEqual(beforeRecovery);
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { title: string }[];
    expect(stored.map((item) => item.title)).toEqual(['Stored']);
  });

  it('marks a repaired collection as saved only after a successful write', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        makeOpportunity({ id: 'op-1', title: 'Kept' }),
        makeOpportunity({ id: 'op-1', title: 'Duplicate' }),
      ]),
    );
    const { result } = renderHook(() => useOpportunities());

    expect(result.current.recovery.kind).toBe('duplicates');
    expect(result.current.recovery.repairedSaved).toBe(false);

    act(() => {
      expect(result.current.commitCandidate(result.current.items)).toBe(true);
    });

    expect(result.current.recovery.kind).toBe('duplicates');
    expect(result.current.recovery.repairedSaved).toBe(true);
    expect(result.current.recovery.primaryRaw).toBeNull();
  });

  it('reflects a successful recovery action through its recovery state', () => {
    localStorage.setItem(KEY, JSON.stringify([makeOpportunity()]));
    localStorage.setItem(RECOVERY_KEY, 'earlier payload');
    const { result } = renderHook(() => useOpportunities());

    expect(result.current.recovery.kind).toBe('retained');

    act(() => {
      const action = result.current.removeRecovery();
      expect(action.ok).toBe(true);
    });

    expect(result.current.recovery.kind).toBe('none');
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });
});

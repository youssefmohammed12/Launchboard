import { useState } from 'react';
import { opportunityRepository } from '../data/opportunityRepository';
import type { Opportunity } from '../types/opportunity';
import type { RecoveryViewState } from '../types/recovery';
import type { RecoveryActionResult } from '../utils/storage';

export interface UseOpportunitiesResult {
  items: Opportunity[];
  recovery: RecoveryViewState;
  /**
   * Persists a complete candidate collection and updates React state only
   * after a successful write. Returns false and leaves state untouched when
   * the storage layer refuses or fails the write.
   */
  commitCandidate(candidate: Opportunity[]): boolean;
  retryPreservation(): RecoveryActionResult;
  replaceRecovery(): RecoveryActionResult;
  removeRecovery(): RecoveryActionResult;
}

/**
 * Owns the opportunity collection and its localStorage lifecycle.
 *
 * It intentionally does not own dialogs, navigation, Undo entries, selection,
 * or product-specific messages. Those remain in `App.tsx` so the shared commit
 * path stays small and Undo invalidation stays an application decision.
 */
export function useOpportunities(): UseOpportunitiesResult {
  // Synchronous on purpose: localStorage reads are immediate, so startup keeps
  // rendering the real collection with no loading screen or artificial delay.
  const [initialLoad] = useState(() => opportunityRepository.load());
  const [items, setItems] = useState<Opportunity[]>(initialLoad.items);
  const [recovery, setRecovery] = useState<RecoveryViewState>(() => ({
    ...initialLoad.recovery,
    repairedSaved: false,
  }));

  const commitCandidate = (candidate: Opportunity[]): boolean => {
    if (!opportunityRepository.save(candidate)) return false;

    setItems(candidate);
    setRecovery((current) =>
      current.kind === 'none'
        ? current
        : { ...current, repairedSaved: true, primaryRaw: null },
    );
    return true;
  };

  const applyRecoveryResult = (result: RecoveryActionResult): RecoveryActionResult => {
    setRecovery((current) => ({
      ...result.recovery,
      // A clean recovery state has no earlier repair to describe.
      repairedSaved: result.recovery.kind === 'none' ? false : current.repairedSaved,
    }));
    return result;
  };

  return {
    items,
    recovery,
    commitCandidate,
    retryPreservation: () => applyRecoveryResult(opportunityRepository.retryPreservation()),
    replaceRecovery: () => applyRecoveryResult(opportunityRepository.replaceRecovery()),
    removeRecovery: () => applyRecoveryResult(opportunityRepository.removeRecovery()),
  };
}

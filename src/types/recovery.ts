import type { RecoverySnapshot } from '../utils/storage';

/**
 * The recovery snapshot as the UI sees it.
 *
 * `repairedSaved` is view state, not storage state: it records that a normalized
 * collection has replaced the primary value during this session. Keeping it out
 * of `storage.ts` prevents the storage layer from owning presentation concerns.
 */
export interface RecoveryViewState extends RecoverySnapshot {
  /** True after a normalized opportunity collection has been written. */
  repairedSaved: boolean;
}

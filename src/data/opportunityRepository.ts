import type { Opportunity } from '../types/opportunity';
import {
  loadOpportunitiesWithRecovery,
  removeRecoveryCopy,
  replaceRecoveryCopy,
  retryRecoveryPreservation,
  saveOpportunities,
  type OpportunityLoadResult,
  type RecoveryActionResult,
} from '../utils/storage';

/**
 * The persistence boundary for the opportunity collection.
 *
 * This interface deliberately mirrors the current transactional model: callers
 * build a complete candidate collection, persist it once, and only then expose
 * it to React. It is not a general CRUD service.
 *
 * A future server implementation cannot simply copy this shape. It will need
 * request-scoped authentication and ownership checks, optimistic concurrency
 * (for example a version or ETag), and a real transaction boundary around each
 * candidate write. Those concerns are intentionally not implemented here.
 */
export interface OpportunityRepository {
  /** Loads the normalized collection together with its recovery metadata. */
  load(): OpportunityLoadResult;
  /** Persists the complete candidate collection; true only on a verified write. */
  save(items: Opportunity[]): boolean;
  /** Retries preserving the raw primary value after a failed attempt. */
  retryPreservation(): RecoveryActionResult;
  /** Replaces an existing recovery copy after explicit acknowledgement. */
  replaceRecovery(): RecoveryActionResult;
  /** Removes a recovery copy that is no longer protecting primary data. */
  removeRecovery(): RecoveryActionResult;
}

/**
 * Thin adapter over the authoritative localStorage utilities.
 *
 * Every rule - the storage keys, normalization, duplicate repair, recovery
 * preservation, write blocking and failure reporting - stays in
 * `src/utils/storage.ts`. This class only names the boundary.
 */
export class LocalStorageOpportunityRepository implements OpportunityRepository {
  load(): OpportunityLoadResult {
    return loadOpportunitiesWithRecovery();
  }

  save(items: Opportunity[]): boolean {
    return saveOpportunities(items);
  }

  retryPreservation(): RecoveryActionResult {
    return retryRecoveryPreservation();
  }

  replaceRecovery(): RecoveryActionResult {
    return replaceRecoveryCopy();
  }

  removeRecovery(): RecoveryActionResult {
    return removeRecoveryCopy();
  }
}

/** The single repository instance used by the application. */
export const opportunityRepository: OpportunityRepository =
  new LocalStorageOpportunityRepository();

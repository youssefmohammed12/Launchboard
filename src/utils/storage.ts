import {
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  type ActivityEntry,
  type Opportunity,
} from '../types/opportunity';
import { seedOpportunities } from '../data/seed';
import { normalizeArchivedAt } from './archive';
import { normalizeStoredActivities } from './activities';
import {
  normalizeStoredContacts,
  repairInterviewContactReferences,
  sameStoredContacts,
} from './contacts';
import { isValidISODate } from './dates';
import { normalizeStoredInterviews, sameStoredInterviews } from './interviews';
import { normalizeStoredMaterials, sameStoredMaterials } from './materials';
import { normalizeStoredTags } from './opportunities';

const KEY = 'launchboard.opportunities.v1';
export const RECOVERY_KEY = 'launchboard.recovery.raw.v1';

export type RecoveryKind = 'none' | 'unreadable' | 'duplicates' | 'retained';

export type RecoveryFailure =
  | 'conflict'
  | 'write-failed'
  | 'read-back-failed'
  | 'read-failed'
  | 'no-primary'
  | 'no-recovery'
  | 'remove-failed'
  | 'remove-blocked';

/**
 * The canonical recovery condition. Storage owns this snapshot so the UI and
 * the write guard cannot disagree about whether saving is safe.
 */
export interface RecoverySnapshot {
  kind: RecoveryKind;
  /** True when the raw payload that caused the warning is safely stored. */
  preserved: boolean;
  writesBlocked: boolean;
  duplicateCount: number;
  /** Exact value currently under RECOVERY_KEY, if any. */
  recoveryCopy: string | null;
  /** Exact current primary value when it could not be interpreted, if any. */
  primaryRaw: string | null;
  /** Why the most recent preservation/replacement/removal failed, if it did. */
  failure: RecoveryFailure | null;
}

const EMPTY_RECOVERY: RecoverySnapshot = {
  kind: 'none',
  preserved: false,
  writesBlocked: false,
  duplicateCount: 0,
  recoveryCopy: null,
  primaryRaw: null,
  failure: null,
};

export interface RecoveryActionResult {
  ok: boolean;
  recovery: RecoverySnapshot;
}

export type OpportunityNormalizationFailure =
  | 'not-an-object'
  | 'missing-id'
  | 'missing-title'
  | 'missing-company'
  | 'invalid-type'
  | 'invalid-status';

export interface NormalizedOpportunityRecord {
  opportunity: Opportunity | null;
  /** True when a repairable field differed from its normalized value. */
  repaired: boolean;
  /** Why a record could not be normalized; null when it was accepted. */
  failure: OpportunityNormalizationFailure | null;
}

function sameTags(raw: unknown, normalized: string[]): boolean {
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return raw.every((value, index) => value === normalized[index]);
}

function sameActivities(raw: unknown, normalized: ActivityEntry[]): boolean {
  if (!Array.isArray(raw) || raw.length !== normalized.length) return false;
  return normalized.every((entry, index) => {
    const candidate = raw[index];
    if (typeof candidate !== 'object' || candidate === null) return false;
    const record = candidate as Record<string, unknown>;
    if (record.id !== entry.id || record.type !== entry.type || record.date !== entry.date) {
      return false;
    }
    // A missing note is normalized to '' without being malformed. A present
    // non-string note is malformed and should be reported as repaired.
    if (record.note !== undefined && typeof record.note !== 'string') return false;
    return (record.note ?? '') === entry.note;
  });
}

/**
 * Rebuilds a record from stored or imported data. Missing or invalid text
 * fields are restored as empty strings, while missing/invalid priority, tags,
 * deadline, follow-up date, activities, interviews, contacts and materials use
 * safe defaults instead of discarding the whole record.
 *
 * Both date fields use the same rule: a value must be a real YYYY-MM-DD
 * calendar date, otherwise it becomes the canonical absent value ''. This
 * deliberately preserves the parent record when only a date is malformed.
 *
 * `archivedAt` follows the same repair-not-drop policy: only a genuine ISO
 * timestamp is archived, while a missing or malformed value becomes the
 * canonical active state (the property is omitted).
 *
 * A record is dropped only when it cannot be repaired: no id, an unknown
 * type/status, or a missing title/company (the same fields the add/edit form
 * requires). Keeping this check aligned with the form means stored records,
 * imported records and newly created ones follow the same rules.
 *
 * `repaired` also covers safe defaults for optional fields that are absent from
 * legacy data, so an import preview can explain that normalization occurred.
 *
 * Interview contact references are validated after both collections have been
 * normalized. A reference to a contact that is missing or was skipped as
 * malformed is cleared to '', preserving the interview and all of its history.
 */
export function normalizeOpportunityRecord(value: unknown): NormalizedOpportunityRecord {
  if (typeof value !== 'object' || value === null) {
    return { opportunity: null, repaired: false, failure: 'not-an-object' };
  }

  const o = value as Record<string, unknown>;
  const text = (key: string): string => (typeof o[key] === 'string' ? (o[key] as string) : '');
  const id = typeof o.id === 'string' && o.id ? o.id : null;
  const title = text('title');
  const company = text('company');
  const type = OPPORTUNITY_TYPES.find((t) => t === o.type);
  const status = OPPORTUNITY_STATUSES.find((s) => s === o.status);

  if (!id) return { opportunity: null, repaired: false, failure: 'missing-id' };
  if (!title.trim()) return { opportunity: null, repaired: false, failure: 'missing-title' };
  if (!company.trim()) return { opportunity: null, repaired: false, failure: 'missing-company' };
  if (!type) return { opportunity: null, repaired: false, failure: 'invalid-type' };
  if (!status) return { opportunity: null, repaired: false, failure: 'invalid-status' };

  const priority = PRIORITIES.find((p) => p === o.priority) ?? 'Medium';
  const tags = normalizeStoredTags(o.tags);
  const url = text('url');
  const deadline = isValidISODate(text('deadline')) ? text('deadline') : '';
  const followUpDate = isValidISODate(text('followUpDate')) ? text('followUpDate') : '';
  const activities = normalizeStoredActivities(o.activities);
  const contacts = normalizeStoredContacts(o.contacts);
  const materials = normalizeStoredMaterials(o.materials);
  const interviews = repairInterviewContactReferences(
    normalizeStoredInterviews(o.interviews),
    contacts,
  );
  const compensation = text('compensation');
  const description = text('description');
  const notes = text('notes');
  const archivedAt = normalizeArchivedAt(o.archivedAt);
  const isDemo = o.isDemo === true;

  const repaired =
    o.priority !== priority ||
    !sameTags(o.tags, tags) ||
    o.url !== url ||
    o.deadline !== deadline ||
    o.followUpDate !== followUpDate ||
    !sameActivities(o.activities, activities) ||
    !sameStoredInterviews(o.interviews, interviews) ||
    !sameStoredContacts(o.contacts, contacts) ||
    !sameStoredMaterials(o.materials, materials) ||
    o.compensation !== compensation ||
    o.description !== description ||
    o.notes !== notes ||
    o.archivedAt !== archivedAt ||
    (o.isDemo !== undefined && o.isDemo !== true && o.isDemo !== false);

  return {
    opportunity: {
      id,
      title,
      company,
      type,
      status,
      priority,
      tags,
      url,
      deadline,
      followUpDate,
      activities,
      interviews,
      contacts,
      materials,
      compensation,
      description,
      notes,
      ...(archivedAt ? { archivedAt } : {}),
      ...(isDemo ? { isDemo: true } : {}),
    },
    repaired,
    failure: null,
  };
}

/** Canonical normalizer shared by localStorage loading and JSON restoration. */
export function normalizeOpportunity(value: unknown): Opportunity | null {
  return normalizeOpportunityRecord(value).opportunity;
}

/** Writes the complete collection. Returns false when the browser refuses the write. */
export function saveOpportunities(items: Opportunity[]): boolean {
  // A load that found an unreadable value it could not preserve must not let a
  // later mutation overwrite the only copy of that data.
  if (opportunityWritesBlocked) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
    // A verified write replaces the unreadable primary value, so it is no
    // longer available as a separate download. The recovery copy is untouched.
    if (currentRecovery.kind !== 'none' && currentRecovery.primaryRaw !== null) {
      currentRecovery = { ...currentRecovery, primaryRaw: null };
    }
    return true;
  } catch {
    // Storage may be full or disabled; callers that cannot continue in memory
    // (such as restore) must report the failure instead of claiming success.
    return false;
  }
}

export type OpportunityLoadStatus =
  | 'seeded'
  | 'valid'
  | 'repaired'
  | 'duplicates'
  | 'unreadable'
  | 'unavailable';

export interface OpportunityLoadResult {
  items: Opportunity[];
  status: OpportunityLoadStatus;
  /** True when a primary storage value was present. */
  rawPresent: boolean;
  /** True when the present value could not be interpreted as an opportunity array. */
  rawUnreadable: boolean;
  /** True when the exact raw value is safely stored under RECOVERY_KEY. */
  preserved: boolean;
  /** True when saveOpportunities must refuse to overwrite the primary value. */
  writesBlocked: boolean;
  /** Valid normalized records skipped because their ID was already kept. */
  duplicateCount: number;
  /** Records skipped because they could not be normalized. */
  invalidRecordCount: number;
  /** Valid records whose optional fields were repaired during normalization. */
  repairedRecordCount: number;
  /** Exact raw payload available for download, or null when not preserved. */
  recoveryRaw: string | null;
  /** Canonical recovery condition, including retained copies after a repair. */
  recovery: RecoverySnapshot;
}

type PreservationResult =
  | { ok: true; recoveryCopy: string }
  | {
      ok: false;
      reason: 'conflict' | 'write-failed' | 'read-back-failed';
      recoveryCopy: string | null;
    };

/**
 * The central write policy. It is reset by every load so a fresh, readable
 * collection is never blocked by an earlier recovery condition.
 */
let opportunityWritesBlocked = false;
let currentRecovery: RecoverySnapshot = { ...EMPTY_RECOVERY };

function setRecoveryState(next: RecoverySnapshot): RecoverySnapshot {
  currentRecovery = next;
  opportunityWritesBlocked = next.writesBlocked;
  return next;
}

/** Reads the recovery key without throwing when storage is unavailable. */
function readRecoveryCopy(): string | null {
  try {
    return localStorage.getItem(RECOVERY_KEY);
  } catch {
    return null;
  }
}

/** Clears the in-memory write block. Used by tests and explicit recovery flows. */
export function resetOpportunityWriteBlock(): void {
  opportunityWritesBlocked = false;
}

/**
 * Preserves the exact raw primary value under RECOVERY_KEY.
 *
 * An existing recovery copy is never overwritten. A different existing copy is
 * treated as a conflict, because replacing it would destroy the earlier
 * recovery opportunity. The write is verified by reading it back.
 */
function preserveRecoveryPayload(raw: string): PreservationResult {
  let existing: string | null;
  try {
    existing = localStorage.getItem(RECOVERY_KEY);
  } catch {
    return { ok: false, reason: 'write-failed', recoveryCopy: null };
  }

  if (existing === raw) return { ok: true, recoveryCopy: raw };
  if (existing !== null) return { ok: false, reason: 'conflict', recoveryCopy: existing };

  try {
    localStorage.setItem(RECOVERY_KEY, raw);
    const readBack = localStorage.getItem(RECOVERY_KEY);
    if (readBack !== raw) {
      return { ok: false, reason: 'read-back-failed', recoveryCopy: readBack };
    }
    return { ok: true, recoveryCopy: raw };
  } catch {
    return { ok: false, reason: 'write-failed', recoveryCopy: existing };
  }
}

function unreadableResult(raw: string): OpportunityLoadResult {
  const preservation = preserveRecoveryPayload(raw);
  const recovery: RecoverySnapshot = {
    kind: 'unreadable',
    preserved: preservation.ok,
    writesBlocked: !preservation.ok,
    duplicateCount: 0,
    recoveryCopy: preservation.recoveryCopy,
    primaryRaw: raw,
    failure: preservation.ok ? null : preservation.reason,
  };
  setRecoveryState(recovery);
  return {
    items: [],
    status: 'unreadable',
    rawPresent: true,
    rawUnreadable: true,
    preserved: preservation.ok,
    writesBlocked: !preservation.ok,
    duplicateCount: 0,
    invalidRecordCount: 0,
    repairedRecordCount: 0,
    recoveryRaw: preservation.ok ? raw : null,
    recovery,
  };
}

/**
 * Loads stored records and reports how the raw value was interpreted.
 *
 * - Nothing stored yet: seed the demo data once.
 * - A readable array: normalize every record, keep the first valid occurrence
 *   of each ID, and preserve the raw array if duplicates had to be excluded.
 * - Invalid JSON or a non-array root: preserve the exact raw string and do not
 *   seed or treat the value as a normal empty collection.
 * - Unpreservable raw data: block writes until the primary value is protected.
 */
export function loadOpportunitiesWithRecovery(): OpportunityLoadResult {
  resetOpportunityWriteBlock();
  currentRecovery = { ...EMPTY_RECOVERY };

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage disabled (private mode, blocked cookies): run in memory only.
    return {
      items: seedOpportunities(),
      status: 'unavailable',
      rawPresent: false,
      rawUnreadable: false,
      preserved: false,
      writesBlocked: false,
      duplicateCount: 0,
      invalidRecordCount: 0,
      repairedRecordCount: 0,
      recoveryRaw: null,
      recovery: { ...EMPTY_RECOVERY },
    };
  }

  if (raw === null) {
    const seed = seedOpportunities();
    saveOpportunities(seed);
    const recoveryCopy = readRecoveryCopy();
    const retained = recoveryCopy !== null;
    const recovery: RecoverySnapshot = {
      ...EMPTY_RECOVERY,
      kind: retained ? 'retained' : 'none',
      preserved: retained,
      recoveryCopy,
    };
    setRecoveryState(recovery);
    return {
      items: seed,
      status: 'seeded',
      rawPresent: false,
      rawUnreadable: false,
      preserved: retained,
      writesBlocked: false,
      duplicateCount: 0,
      invalidRecordCount: 0,
      repairedRecordCount: 0,
      recoveryRaw: recoveryCopy,
      recovery,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unreadableResult(raw);
  }
  if (!Array.isArray(parsed)) {
    return unreadableResult(raw);
  }

  const items: Opportunity[] = [];
  const seenIds = new Set<string>();
  let duplicateCount = 0;
  let invalidRecordCount = 0;
  let repairedRecordCount = 0;

  parsed.forEach((value) => {
    const normalized = normalizeOpportunityRecord(value);
    if (!normalized.opportunity) {
      // A malformed record never reserves its ID, so a later valid record with
      // the same ID can still be kept.
      invalidRecordCount += 1;
      return;
    }
    if (seenIds.has(normalized.opportunity.id)) {
      duplicateCount += 1;
      return;
    }
    seenIds.add(normalized.opportunity.id);
    if (normalized.repaired) repairedRecordCount += 1;
    items.push(normalized.opportunity);
  });

  if (duplicateCount > 0) {
    const preservation = preserveRecoveryPayload(raw);
    const recovery: RecoverySnapshot = {
      kind: 'duplicates',
      preserved: preservation.ok,
      writesBlocked: !preservation.ok,
      duplicateCount,
      recoveryCopy: preservation.recoveryCopy,
      primaryRaw: raw,
      failure: preservation.ok ? null : preservation.reason,
    };
    setRecoveryState(recovery);
    return {
      items,
      status: 'duplicates',
      rawPresent: true,
      rawUnreadable: false,
      preserved: preservation.ok,
      writesBlocked: !preservation.ok,
      duplicateCount,
      invalidRecordCount,
      repairedRecordCount,
      recoveryRaw: preservation.ok ? raw : null,
      recovery,
    };
  }

  const recoveryCopy = readRecoveryCopy();
  const retained = recoveryCopy !== null;
  const recovery: RecoverySnapshot = {
    ...EMPTY_RECOVERY,
    kind: retained ? 'retained' : 'none',
    preserved: retained,
    recoveryCopy,
  };
  setRecoveryState(recovery);
  return {
    items,
    status: repairedRecordCount > 0 ? 'repaired' : 'valid',
    rawPresent: true,
    rawUnreadable: false,
    preserved: retained,
    writesBlocked: false,
    duplicateCount: 0,
    invalidRecordCount,
    repairedRecordCount,
    recoveryRaw: recoveryCopy,
    recovery,
  };
}

/**
 * Retries preservation after a failed initial attempt. The current primary
 * value is never modified, and writes stay blocked unless the exact raw value
 * is written to RECOVERY_KEY and verified by reading it back.
 */
export function retryRecoveryPreservation(): RecoveryActionResult {
  const kind = currentRecovery.kind === 'none' ? 'unreadable' : currentRecovery.kind;

  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        writesBlocked: true,
        failure: 'read-failed',
      }),
    };
  }

  if (raw === null) {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        writesBlocked: true,
        failure: 'no-primary',
      }),
    };
  }

  const preservation = preserveRecoveryPayload(raw);
  const recovery: RecoverySnapshot = {
    ...currentRecovery,
    kind,
    preserved: preservation.ok,
    writesBlocked: !preservation.ok,
    recoveryCopy: preservation.recoveryCopy,
    primaryRaw: raw,
    failure: preservation.ok ? null : preservation.reason,
  };
  return { ok: preservation.ok, recovery: setRecoveryState(recovery) };
}

/**
 * Explicitly replaces an existing recovery copy with the current unreadable
 * primary value. The UI must collect acknowledgement and a separate
 * confirmation before calling this. The exact primary raw string is written
 * and read back; writes unblock only after that verification succeeds.
 */
export function replaceRecoveryCopy(): RecoveryActionResult {
  const kind = currentRecovery.kind === 'none' ? 'unreadable' : currentRecovery.kind;

  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        writesBlocked: true,
        failure: 'read-failed',
      }),
    };
  }

  if (raw === null) {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        writesBlocked: true,
        failure: 'no-primary',
      }),
    };
  }

  try {
    localStorage.setItem(RECOVERY_KEY, raw);
    const readBack = localStorage.getItem(RECOVERY_KEY);
    if (readBack !== raw) {
      return {
        ok: false,
        recovery: setRecoveryState({
          ...currentRecovery,
          kind,
          preserved: false,
          writesBlocked: true,
          recoveryCopy: readBack,
          primaryRaw: raw,
          failure: 'read-back-failed',
        }),
      };
    }
    return {
      ok: true,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        preserved: true,
        writesBlocked: false,
        recoveryCopy: raw,
        primaryRaw: raw,
        failure: null,
      }),
    };
  } catch {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        kind,
        preserved: false,
        writesBlocked: true,
        recoveryCopy: readRecoveryCopy(),
        primaryRaw: raw,
        failure: 'write-failed',
      }),
    };
  }
}

/**
 * Removes only RECOVERY_KEY after the user has explicitly confirmed. Removal is
 * refused while the copy is still protecting an unreadable primary value or
 * while writes are blocked. The primary opportunity collection is never
 * touched, and the key is read back to verify that it is gone.
 */
export function removeRecoveryCopy(): RecoveryActionResult {
  if (currentRecovery.writesBlocked || currentRecovery.primaryRaw !== null) {
    return {
      ok: false,
      recovery: setRecoveryState({ ...currentRecovery, failure: 'remove-blocked' }),
    };
  }

  let existing: string | null;
  try {
    existing = localStorage.getItem(RECOVERY_KEY);
  } catch {
    return {
      ok: false,
      recovery: setRecoveryState({ ...currentRecovery, failure: 'read-failed' }),
    };
  }

  if (existing === null) {
    return {
      ok: false,
      recovery: setRecoveryState({ ...currentRecovery, failure: 'no-recovery' }),
    };
  }

  try {
    localStorage.removeItem(RECOVERY_KEY);
    if (localStorage.getItem(RECOVERY_KEY) !== null) {
      return {
        ok: false,
        recovery: setRecoveryState({
          ...currentRecovery,
          recoveryCopy: readRecoveryCopy() ?? existing,
          failure: 'remove-failed',
        }),
      };
    }
  } catch {
    return {
      ok: false,
      recovery: setRecoveryState({
        ...currentRecovery,
        recoveryCopy: readRecoveryCopy() ?? existing,
        failure: 'remove-failed',
      }),
    };
  }

  return {
    ok: true,
    recovery: setRecoveryState({ ...EMPTY_RECOVERY }),
  };
}

/**
 * Backwards-compatible array-only loader used by focused storage tests.
 * The application uses loadOpportunitiesWithRecovery() so it can show the
 * recovery state; both share the same implementation.
 */
export function loadOpportunities(): Opportunity[] {
  return loadOpportunitiesWithRecovery().items;
}

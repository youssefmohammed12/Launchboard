import {
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  type MaterialDraft,
  type MaterialEntry,
  type MaterialKind,
  type MaterialStatus,
} from '../types/opportunity';
import {
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_URL_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
} from '@launchboard/domain';
import { isValidUrl } from './opportunities';

export {
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_URL_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
} from '@launchboard/domain';

function limitedText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function knownKind(value: unknown): MaterialKind {
  return MATERIAL_KINDS.find((kind) => kind === value) ?? 'Other';
}

function knownStatus(value: unknown): MaterialStatus {
  return MATERIAL_STATUSES.find((status) => status === value) ?? 'Draft';
}

function normalizedUrl(value: unknown): string {
  const candidate = limitedText(value, MAX_MATERIAL_URL_LENGTH);
  return candidate && isValidUrl(candidate) ? candidate : '';
}

/**
 * Repairs application materials read from storage or a backup. Each child is
 * normalized independently; a malformed material is dropped without discarding
 * its valid parent or siblings.
 *
 * A label is required. Unsupported kinds default to "Other", unsupported
 * statuses default to "Draft", and invalid URLs become empty so drafts without
 * an online link remain valid. Labels are not treated as unique because two
 * materials can legitimately share a label (for example, different versions).
 * IDs are preserved, and the first valid material wins when the same ID appears
 * more than once.
 */
export function normalizeStoredMaterials(value: unknown): MaterialEntry[] {
  if (!Array.isArray(value)) return [];

  const materials: MaterialEntry[] = [];
  const seenIds = new Set<string>();

  for (const raw of value) {
    if (materials.length >= MAX_MATERIALS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;

    if (typeof entry.id !== 'string' || !entry.id) continue;
    const label = limitedText(entry.label, MAX_MATERIAL_LABEL_LENGTH);
    if (!label) continue;
    if (seenIds.has(entry.id)) continue;

    seenIds.add(entry.id);
    materials.push({
      id: entry.id,
      label,
      kind: knownKind(entry.kind),
      url: normalizedUrl(entry.url),
      version: limitedText(entry.version, MAX_MATERIAL_VERSION_LENGTH),
      status: knownStatus(entry.status),
      notes: limitedText(entry.notes, MAX_MATERIAL_NOTES_LENGTH),
    });
  }

  return materials;
}

/**
 * Reports whether stored materials already match their normalized form. A
 * missing collection is accepted as the canonical empty collection so legacy
 * records are not reported as repaired solely because materials are new.
 */
export function sameStoredMaterials(value: unknown, normalized: MaterialEntry[]): boolean {
  if (value === undefined && normalized.length === 0) return true;
  if (!Array.isArray(value) || value.length !== normalized.length) return false;

  return normalized.every((entry, index) => {
    const raw = value[index];
    if (typeof raw !== 'object' || raw === null) return false;
    const candidate = raw as Record<string, unknown>;
    return (
      candidate.id === entry.id &&
      candidate.label === entry.label &&
      candidate.kind === entry.kind &&
      (candidate.url ?? '') === entry.url &&
      (candidate.version ?? '') === entry.version &&
      candidate.status === entry.status &&
      (candidate.notes ?? '') === entry.notes
    );
  });
}

/** Produces a trimmed, length-limited draft with canonical enum values. */
export function cleanMaterialDraft(data: MaterialDraft): MaterialDraft {
  return {
    label: data.label.trim().slice(0, MAX_MATERIAL_LABEL_LENGTH),
    kind: knownKind(data.kind),
    url: data.url.trim().slice(0, MAX_MATERIAL_URL_LENGTH),
    version: data.version.trim().slice(0, MAX_MATERIAL_VERSION_LENGTH),
    status: knownStatus(data.status),
    notes: data.notes.trim().slice(0, MAX_MATERIAL_NOTES_LENGTH),
  };
}

export type MaterialFormErrors = Partial<Record<keyof MaterialDraft, string>>;

/** Inline form validation; storage normalization applies the same limits. */
export function validateMaterialDraft(data: MaterialDraft): MaterialFormErrors {
  const errors: MaterialFormErrors = {};
  const label = data.label.trim();
  const url = data.url.trim();

  if (!label) {
    errors.label = 'Enter a material label.';
  } else if (label.length > MAX_MATERIAL_LABEL_LENGTH) {
    errors.label = `Label must be ${MAX_MATERIAL_LABEL_LENGTH} characters or fewer.`;
  }

  if (data.version.trim().length > MAX_MATERIAL_VERSION_LENGTH) {
    errors.version = `Version must be ${MAX_MATERIAL_VERSION_LENGTH} characters or fewer.`;
  }

  if (url && url.length > MAX_MATERIAL_URL_LENGTH) {
    errors.url = `URL must be ${MAX_MATERIAL_URL_LENGTH} characters or fewer.`;
  } else if (url && !isValidUrl(url)) {
    errors.url = 'Enter a valid URL starting with http:// or https://.';
  }

  if (data.notes.length > MAX_MATERIAL_NOTES_LENGTH) {
    errors.notes = `Notes must be ${MAX_MATERIAL_NOTES_LENGTH} characters or fewer.`;
  }

  return errors;
}

function entryFromDraft(draft: MaterialDraft, id: string): MaterialEntry {
  return { ...cleanMaterialDraft(draft), id };
}

/** Appends a new material without mutating the existing collection. */
export function addMaterial(
  materials: MaterialEntry[],
  draft: MaterialDraft,
  id: string,
): MaterialEntry[] {
  if (materials.length >= MAX_MATERIALS) return [...materials];
  return [...materials, entryFromDraft(draft, id)];
}

/**
 * Replaces one material's editable fields while preserving its stable ID.
 * Other materials and the input array are untouched.
 */
export function updateMaterial(
  materials: MaterialEntry[],
  id: string,
  draft: MaterialDraft,
): MaterialEntry[] {
  return materials.map((entry) =>
    entry.id === id ? { ...entryFromDraft(draft, entry.id), id: entry.id } : entry,
  );
}

/** Removes one material by ID, returning a new array. */
export function removeMaterial(materials: MaterialEntry[], id: string): MaterialEntry[] {
  return materials.filter((entry) => entry.id !== id);
}

/** Changes only one material's status while preserving every other field. */
export function setMaterialStatus(
  materials: MaterialEntry[],
  id: string,
  status: MaterialStatus,
): MaterialEntry[] {
  return materials.map((entry) => (entry.id === id ? { ...entry, status } : entry));
}

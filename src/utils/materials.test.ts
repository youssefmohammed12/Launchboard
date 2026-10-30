import { describe, expect, it } from 'vitest';
import type { MaterialDraft, MaterialEntry } from '../types/opportunity';
import { makeMaterial } from '../test/fixtures';
import {
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
  addMaterial,
  cleanMaterialDraft,
  normalizeStoredMaterials,
  removeMaterial,
  sameStoredMaterials,
  setMaterialStatus,
  updateMaterial,
  validateMaterialDraft,
} from './materials';

function draftFrom(material: MaterialEntry): MaterialDraft {
  const { id: ignored, ...draft } = material;
  void ignored;
  return draft;
}

describe('normalizeStoredMaterials', () => {
  it('treats missing or non-array collections as empty', () => {
    expect(normalizeStoredMaterials(undefined)).toEqual([]);
    expect(normalizeStoredMaterials(null)).toEqual([]);
    expect(normalizeStoredMaterials({})).toEqual([]);
    expect(normalizeStoredMaterials('materials')).toEqual([]);
  });

  it('preserves complete valid materials and their stable IDs', () => {
    const material = makeMaterial({
      id: 'material-7',
      label: 'Portfolio case study',
      kind: 'Portfolio',
      url: 'https://example.com/portfolio',
      version: 'Updated October',
      status: 'Submitted',
      notes: 'Shared with the hiring manager.',
    });

    expect(normalizeStoredMaterials([material])).toEqual([material]);
  });

  it('allows the same label when IDs differ', () => {
    const first = makeMaterial({ id: 'material-1', label: 'Resume', version: 'v1' });
    const second = makeMaterial({ id: 'material-2', label: 'Resume', version: 'v2' });

    expect(normalizeStoredMaterials([first, second])).toEqual([first, second]);
  });

  it('skips materials without an ID or label and keeps the first duplicate ID', () => {
    const first = makeMaterial({ id: 'duplicate', label: 'First material' });
    const second = makeMaterial({ id: 'duplicate', label: 'Second material' });
    const normalized = normalizeStoredMaterials([
      null,
      'not a material',
      { label: 'No ID', kind: 'Resume', status: 'Ready' },
      { id: 'no-label', label: '   ' },
      first,
      second,
      { id: 'after-duplicate', label: 'Valid sibling' },
    ]);

    expect(normalized.map((material) => material.id)).toEqual([
      'duplicate',
      'after-duplicate',
    ]);
    expect(normalized[0].label).toBe('First material');
  });

  it('repairs unknown kind/status values and invalid or empty URLs safely', () => {
    const [unknown] = normalizeStoredMaterials([
      {
        id: 'unknown',
        label: '  Assessment  ',
        kind: 'Take-home',
        url: 'javascript:alert(1)',
        version: '  v3  ',
        status: 'Final',
        notes: 42,
      },
    ]);
    const [draft] = normalizeStoredMaterials([
      { id: 'draft', label: 'Draft resume', kind: 'Resume', status: 'Draft', url: '' },
    ]);

    expect(unknown).toEqual({
      id: 'unknown',
      label: 'Assessment',
      kind: 'Other',
      url: '',
      version: 'v3',
      status: 'Draft',
      notes: '',
    });
    expect(draft.url).toBe('');
    expect(draft.status).toBe('Draft');
  });

  it('caps the collection and each text field at its limit', () => {
    const many = Array.from({ length: MAX_MATERIALS + 3 }, (_, index) =>
      makeMaterial({ id: `material-${index}`, label: `Material ${index}` }),
    );
    expect(normalizeStoredMaterials(many)).toHaveLength(MAX_MATERIALS);

    const [long] = normalizeStoredMaterials([
      makeMaterial({
        id: 'long',
        label: 'L'.repeat(MAX_MATERIAL_LABEL_LENGTH + 10),
        version: 'V'.repeat(MAX_MATERIAL_VERSION_LENGTH + 10),
        notes: 'N'.repeat(MAX_MATERIAL_NOTES_LENGTH + 10),
      }),
    ]);

    expect(long.label).toHaveLength(MAX_MATERIAL_LABEL_LENGTH);
    expect(long.version).toHaveLength(MAX_MATERIAL_VERSION_LENGTH);
    expect(long.notes).toHaveLength(MAX_MATERIAL_NOTES_LENGTH);
  });
});

describe('sameStoredMaterials', () => {
  it('accepts a missing collection as canonical empty data', () => {
    expect(sameStoredMaterials(undefined, [])).toBe(true);
  });

  it('reports malformed or repaired material collections', () => {
    const material = makeMaterial();

    expect(sameStoredMaterials([material], [material])).toBe(true);
    expect(sameStoredMaterials([material, material], [material])).toBe(false);
    expect(
      sameStoredMaterials([{ ...material, kind: 'Unknown kind' }], [material]),
    ).toBe(false);
    expect(sameStoredMaterials([{ ...material, url: 'not-a-url' }], [material])).toBe(false);
    expect(sameStoredMaterials(null, [])).toBe(false);
  });
});

describe('material validation', () => {
  it('requires a label and validates a supplied URL', () => {
    const errors = validateMaterialDraft(
      draftFrom(makeMaterial({ label: '   ', url: 'not-a-url' })),
    );

    expect(errors.label).toBe('Enter a material label.');
    expect(errors.url).toBe('Enter a valid URL starting with http:// or https://.');
  });

  it('permits an empty URL for a draft', () => {
    const errors = validateMaterialDraft(
      draftFrom(makeMaterial({ label: 'Draft resume', url: '', status: 'Draft' })),
    );

    expect(errors).toEqual({});
  });

  it('enforces text limits and accepts a valid draft', () => {
    expect(validateMaterialDraft(draftFrom(makeMaterial()))).toEqual({});

    const errors = validateMaterialDraft(
      draftFrom(
        makeMaterial({
          label: 'L'.repeat(MAX_MATERIAL_LABEL_LENGTH + 1),
          version: 'V'.repeat(MAX_MATERIAL_VERSION_LENGTH + 1),
          notes: 'N'.repeat(MAX_MATERIAL_NOTES_LENGTH + 1),
        }),
      ),
    );

    expect(errors.label).toContain('characters or fewer');
    expect(errors.version).toContain('characters or fewer');
    expect(errors.notes).toContain('characters or fewer');
  });

  it('trims text and canonicalizes controlled values before saving', () => {
    expect(
      cleanMaterialDraft({
        label: '  Cover Letter  ',
        kind: 'Cover Letter',
        url: '  https://example.com/cover.pdf  ',
        version: '  v2  ',
        status: 'Ready',
        notes: '  Tailored for the role.  ',
      }),
    ).toEqual({
      label: 'Cover Letter',
      kind: 'Cover Letter',
      url: 'https://example.com/cover.pdf',
      version: 'v2',
      status: 'Ready',
      notes: 'Tailored for the role.',
    });
  });
});

describe('material operations', () => {
  const first = makeMaterial({ id: 'first', label: 'Resume', status: 'Ready' });
  const second = makeMaterial({
    id: 'second',
    label: 'Cover Letter',
    kind: 'Cover Letter',
    status: 'Draft',
  });

  it('adds a material without mutating the original collection', () => {
    const original = [first];
    const snapshot = [...original];
    const draft = draftFrom(makeMaterial({ label: '  Portfolio  ', kind: 'Portfolio' }));

    const next = addMaterial(original, draft, 'new-material');

    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ ...cleanMaterialDraft(draft), id: 'new-material' });
    expect(original).toEqual(snapshot);
  });

  it('does not exceed the per-opportunity material limit', () => {
    const full = Array.from({ length: MAX_MATERIALS }, (_, index) =>
      makeMaterial({ id: `material-${index}` }),
    );

    const next = addMaterial(full, draftFrom(makeMaterial()), 'one-too-many');

    expect(next).toHaveLength(MAX_MATERIALS);
    expect(next).toEqual(full);
  });

  it('updates one material while preserving its ID and other materials', () => {
    const original = [first, second];
    const draft = draftFrom({
      ...second,
      label: 'Tailored Cover Letter',
      status: 'Ready',
      notes: 'Updated.',
    });

    const next = updateMaterial(original, second.id, draft);

    expect(next[0]).toBe(first);
    expect(next[1]).toMatchObject({
      id: 'second',
      label: 'Tailored Cover Letter',
      status: 'Ready',
      notes: 'Updated.',
    });
    expect(original[1]).toBe(second);
  });

  it('changes only one material status', () => {
    const original = [first, second];
    const next = setMaterialStatus(original, second.id, 'Submitted');

    expect(next[0]).toBe(first);
    expect(next[1]).toMatchObject({ id: 'second', status: 'Submitted' });
    expect(original[1].status).toBe('Draft');
  });

  it('removes one material without touching the others', () => {
    const next = removeMaterial([first, second], first.id);

    expect(next).toEqual([second]);
    expect(next[0]).toBe(second);
  });
});

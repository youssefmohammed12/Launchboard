import { describe, expect, it } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from '../test/fixtures';
import {
  UNDO_WINDOW_MS,
  applyUndo,
  createArchiveUndoEntry,
  createBatchArchiveUndoEntry,
  createBatchDeleteUndoEntry,
  createDeleteUndoEntry,
  describeUndoAction,
  type BatchDeleteUndoEntry,
} from './undo';
import { isArchived } from './archive';

const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

describe('undo window', () => {
  it('offers Undo for ten seconds', () => {
    expect(UNDO_WINDOW_MS).toBe(10_000);
  });
});

describe('describeUndoAction', () => {
  it('names the completed action for the notification', () => {
    const item = makeOpportunity({ title: 'Frontend Intern' });

    expect(
      describeUndoAction({
        kind: 'archive',
        id: 'op-1',
        title: item.title,
        previousArchivedAt: undefined,
        resultingArchivedAt: ARCHIVED_AT,
      }),
    ).toBe('Archived “Frontend Intern”.');
    expect(
      describeUndoAction({
        kind: 'restore',
        id: 'op-1',
        title: item.title,
        previousArchivedAt: ARCHIVED_AT,
        resultingArchivedAt: undefined,
      }),
    ).toBe('Restored “Frontend Intern”.');
    expect(describeUndoAction(createDeleteUndoEntry(item, 0))).toBe(
      'Deleted “Frontend Intern”.',
    );
  });
});

describe('createArchiveUndoEntry', () => {
  it('captures archive and restore directions with both archive states', () => {
    const active = makeOpportunity({ id: 'op-1' });
    const archived = { ...active, archivedAt: ARCHIVED_AT };

    expect(createArchiveUndoEntry(active, archived)).toMatchObject({
      kind: 'archive',
      id: 'op-1',
      previousArchivedAt: undefined,
      resultingArchivedAt: ARCHIVED_AT,
    });
    expect(createArchiveUndoEntry(archived, active)).toMatchObject({
      kind: 'restore',
      previousArchivedAt: ARCHIVED_AT,
      resultingArchivedAt: undefined,
    });
  });

  it('creates no entry when the archive state did not change', () => {
    const active = makeOpportunity();

    expect(createArchiveUndoEntry(active, { ...active })).toBeNull();
    expect(
      createArchiveUndoEntry(
        makeOpportunity({ archivedAt: ARCHIVED_AT }),
        makeOpportunity({ archivedAt: '2026-05-01T00:00:00.000Z' }),
      ),
    ).toBeNull();
  });
});

describe('createDeleteUndoEntry', () => {
  it('deep-copies the record and keeps its original position', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this.' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'op-1',
      status: 'Interview',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
    });

    const entry = createDeleteUndoEntry(item, 2);
    item.notes = 'Changed after the snapshot';
    item.activities.push(makeActivity({ id: 'activity-2' }));

    expect(entry.index).toBe(2);
    expect(entry.snapshot.notes).toBe('');
    expect(entry.snapshot.activities).toEqual([activity]);
    expect(entry.snapshot.contacts).toEqual([contact]);
    expect(entry.snapshot.interviews).toEqual([interview]);
    expect(entry.snapshot).not.toBe(item);
  });
});

describe('applyUndo for archive and restore', () => {
  it('undoes an archive, restoring active state without changing other fields', () => {
    const activity = makeActivity({ id: 'activity-1' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const archived = makeOpportunity({
      id: 'op-1',
      status: 'Interview',
      priority: 'High',
      notes: 'Keep these notes.',
      archivedAt: ARCHIVED_AT,
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
    });
    const entry = {
      kind: 'archive' as const,
      id: 'op-1',
      title: archived.title,
      previousArchivedAt: undefined,
      resultingArchivedAt: ARCHIVED_AT,
    };
    const items = [archived];

    const result = applyUndo(items, entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.items[0];
    expect(isArchived(restored)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(restored, 'archivedAt')).toBe(false);
    expect(restored.status).toBe('Interview');
    expect(restored.priority).toBe('High');
    expect(restored.notes).toBe('Keep these notes.');
    expect(restored.activities).toEqual([activity]);
    expect(restored.contacts).toEqual([contact]);
    expect(restored.interviews).toEqual([interview]);
    expect(result.message).toBe('“Frontend Intern” is active again.');
    // The original collection is untouched.
    expect(items[0]).toBe(archived);
    expect(isArchived(archived)).toBe(true);
  });

  it('undoes a restore, putting the same archive timestamp back', () => {
    const active = makeOpportunity({ id: 'op-1', status: 'Offer', notes: 'Current notes.' });
    const entry = {
      kind: 'restore' as const,
      id: 'op-1',
      title: active.title,
      previousArchivedAt: ARCHIVED_AT,
      resultingArchivedAt: undefined,
    };

    const result = applyUndo([active], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].archivedAt).toBe(ARCHIVED_AT);
    expect(result.items[0].status).toBe('Offer');
    expect(result.items[0].notes).toBe('Current notes.');
    expect(result.message).toBe('“Frontend Intern” is archived again.');
  });

  it('keeps unrelated edits made after the archive action', () => {
    const edited = makeOpportunity({
      id: 'op-1',
      status: 'Offer',
      notes: 'Edited while archived',
      archivedAt: ARCHIVED_AT,
    });
    const entry = {
      kind: 'archive' as const,
      id: 'op-1',
      title: edited.title,
      previousArchivedAt: undefined,
      resultingArchivedAt: ARCHIVED_AT,
    };

    const result = applyUndo([edited], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].status).toBe('Offer');
    expect(result.items[0].notes).toBe('Edited while archived');
    expect(isArchived(result.items[0])).toBe(false);
    expect(result.items[0].activities).toEqual([]);
  });

  it('fails safely when the record is gone or its archive state changed', () => {
    const missing = applyUndo(
      [],
      {
        kind: 'archive',
        id: 'op-1',
        title: 'Frontend Intern',
        previousArchivedAt: undefined,
        resultingArchivedAt: ARCHIVED_AT,
      },
    );
    expect(missing).toMatchObject({ ok: false, reason: 'missing' });
    if (!missing.ok) expect(missing.message).toContain('no longer in your opportunities');

    const stale = applyUndo(
      [makeOpportunity({ id: 'op-1' })],
      {
        kind: 'archive',
        id: 'op-1',
        title: 'Frontend Intern',
        previousArchivedAt: undefined,
        resultingArchivedAt: ARCHIVED_AT,
      },
    );
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    if (!stale.ok) expect(stale.message).toContain('archive state');
  });
});

describe('applyUndo for deletion', () => {
  it('restores the complete record at its original position', () => {
    const activity = makeActivity({ id: 'activity-1' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const deleted = makeOpportunity({
      id: 'op-2',
      title: 'Deleted Role',
      status: 'Interview',
      priority: 'High',
      tags: ['remote'],
      deadline: '2026-02-01',
      followUpDate: '2026-01-20',
      compensation: '$2,000 / month',
      url: 'https://example.com/job',
      description: 'Description',
      notes: 'Notes',
      activities: [activity],
      interviews: [interview],
      contacts: [contact],
      materials: [material],
    });
    const entry = createDeleteUndoEntry(deleted, 1);
    const remaining = [
      makeOpportunity({ id: 'op-1' }),
      makeOpportunity({ id: 'op-3' }),
    ];

    const result = applyUndo(remaining, entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(result.items[1]).toEqual(deleted);
    expect(result.items[1]).not.toBe(entry.snapshot);
    expect(result.items[1].activities).toEqual([activity]);
    expect(result.items[1].contacts).toEqual([contact]);
    expect(result.items[1].interviews).toEqual([interview]);
    expect(result.items[1].materials).toEqual([material]);
    expect(result.items[1].interviews[0].contactId).toBe('contact-1');
    expect(result.message).toBe('“Deleted Role” was restored to the Active view.');
    expect(remaining.map((item) => item.id)).toEqual(['op-1', 'op-3']);
  });

  it('preserves archive state when undoing the deletion of an archived record', () => {
    const archived = makeOpportunity({
      id: 'op-1',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });

    const result = applyUndo([], createDeleteUndoEntry(archived, 0));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].archivedAt).toBe(ARCHIVED_AT);
    expect(result.items[0].status).toBe('Rejected');
    expect(result.message).toBe(
      '“Frontend Intern” was restored to the Archived view.',
    );
  });

  it('refuses to overwrite a record that now uses the same ID', () => {
    const replacement = makeOpportunity({ id: 'op-1', title: 'Newer Role' });
    const entry = createDeleteUndoEntry(makeOpportunity({ id: 'op-1' }), 0);

    const result = applyUndo([replacement], entry);

    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    if (!result.ok) expect(result.message).toContain('already exists');
  });

  it('clamps the stored position when the collection shrank', () => {
    const entry = createDeleteUndoEntry(makeOpportunity({ id: 'op-9' }), 8);

    const result = applyUndo([makeOpportunity({ id: 'op-1' })], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-1', 'op-9']);
  });
});

describe('createBatchArchiveUndoEntry', () => {
  it('captures one entry for a whole archive batch', () => {
    const first = makeOpportunity({ id: 'op-1', title: 'Alpha Role' });
    const second = makeOpportunity({ id: 'op-2', title: 'Beta Role' });
    const entry = createBatchArchiveUndoEntry(
      [first, second],
      [
        { ...first, archivedAt: ARCHIVED_AT },
        { ...second, archivedAt: ARCHIVED_AT },
      ],
    );

    expect(entry).toMatchObject({ kind: 'batch-archive' });
    expect(entry?.items).toEqual([
      {
        id: 'op-1',
        title: 'Alpha Role',
        previousArchivedAt: undefined,
        resultingArchivedAt: ARCHIVED_AT,
      },
      {
        id: 'op-2',
        title: 'Beta Role',
        previousArchivedAt: undefined,
        resultingArchivedAt: ARCHIVED_AT,
      },
    ]);
    expect(describeUndoAction(entry as NonNullable<typeof entry>)).toBe(
      'Archived 2 opportunities.',
    );
  });

  it('captures the restore direction and its original timestamps', () => {
    const first = makeOpportunity({ id: 'op-1', archivedAt: ARCHIVED_AT });
    const second = makeOpportunity({
      id: 'op-2',
      archivedAt: '2026-05-01T00:00:00.000Z',
    });
    const entry = createBatchArchiveUndoEntry(
      [first, second],
      [{ ...first, archivedAt: undefined }, { ...second, archivedAt: undefined }],
    );

    expect(entry).toMatchObject({ kind: 'batch-restore' });
    expect(entry?.items.map((item) => item.previousArchivedAt)).toEqual([
      ARCHIVED_AT,
      '2026-05-01T00:00:00.000Z',
    ]);
    expect(describeUndoAction(entry as NonNullable<typeof entry>)).toBe(
      'Restored 2 opportunities.',
    );
  });

  it('returns null when the batch changed no archive state', () => {
    const active = makeOpportunity();

    expect(createBatchArchiveUndoEntry([active], [{ ...active }])).toBeNull();
    expect(
      createBatchArchiveUndoEntry(
        [makeOpportunity({ archivedAt: ARCHIVED_AT })],
        [makeOpportunity({ archivedAt: ARCHIVED_AT })],
      ),
    ).toBeNull();
  });

  it('skips records that were already in the requested state', () => {
    const active = makeOpportunity({ id: 'op-1' });
    const already = makeOpportunity({ id: 'op-2', archivedAt: ARCHIVED_AT });
    const entry = createBatchArchiveUndoEntry(
      [active, already],
      [{ ...active, archivedAt: ARCHIVED_AT }, already],
    );

    expect(entry?.items.map((item) => item.id)).toEqual(['op-1']);
  });
});

describe('applyUndo for a batch', () => {
  const batchEntry = (previousArchivedAt: string | undefined, resultingArchivedAt: string | undefined) =>
    createBatchArchiveUndoEntry(
      [makeOpportunity({ id: 'op-1', archivedAt: previousArchivedAt })],
      [makeOpportunity({ id: 'op-1', archivedAt: resultingArchivedAt })],
    );

  it('reverses a batch archive atomically and keeps later unrelated edits', () => {
    const activity = makeActivity({ id: 'activity-1' });
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const entry = createBatchArchiveUndoEntry(
      [
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ],
      [
        makeOpportunity({ id: 'op-1', title: 'Alpha Role', archivedAt: ARCHIVED_AT }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role', archivedAt: ARCHIVED_AT }),
      ],
    ) as NonNullable<ReturnType<typeof createBatchArchiveUndoEntry>>;
    const current = [
      makeOpportunity({
        id: 'op-1',
        title: 'Alpha Role',
        status: 'Offer',
        notes: 'Edited after archiving',
        archivedAt: ARCHIVED_AT,
        activities: [activity],
        contacts: [contact],
        interviews: [interview],
      }),
      makeOpportunity({ id: 'op-2', title: 'Beta Role', archivedAt: ARCHIVED_AT }),
      makeOpportunity({ id: 'op-3', title: 'Untouched Role' }),
    ];

    const result = applyUndo(current, entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(result.items[0]).toMatchObject({
      status: 'Offer',
      notes: 'Edited after archiving',
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
    });
    expect(result.items[0].archivedAt).toBeUndefined();
    expect(result.items[1].archivedAt).toBeUndefined();
    expect(result.items[2]).toBe(current[2]);
    expect(result.message).toBe('2 opportunities are active again.');
    // The input collection and its records are untouched.
    expect(current[0].archivedAt).toBe(ARCHIVED_AT);
    expect(current[1].archivedAt).toBe(ARCHIVED_AT);
  });

  it('reverses a batch restore, putting every original timestamp back', () => {
    const firstTimestamp = ARCHIVED_AT;
    const secondTimestamp = '2026-05-01T00:00:00.000Z';
    const entry = createBatchArchiveUndoEntry(
      [
        makeOpportunity({ id: 'op-1', archivedAt: firstTimestamp }),
        makeOpportunity({ id: 'op-2', archivedAt: secondTimestamp }),
      ],
      [makeOpportunity({ id: 'op-1' }), makeOpportunity({ id: 'op-2' })],
    ) as NonNullable<ReturnType<typeof createBatchArchiveUndoEntry>>;
    const current = [
      makeOpportunity({ id: 'op-1', status: 'Applied' }),
      makeOpportunity({ id: 'op-2', status: 'Rejected' }),
    ];

    const result = applyUndo(current, entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0].archivedAt).toBe(firstTimestamp);
    expect(result.items[1].archivedAt).toBe(secondTimestamp);
    expect(result.items[0].status).toBe('Applied');
    expect(result.items[1].status).toBe('Rejected');
    expect(result.message).toBe('2 opportunities are archived again.');
  });

  it('refuses the entire batch when one record is missing', () => {
    const entry = createBatchArchiveUndoEntry(
      [
        makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      ],
      [
        makeOpportunity({ id: 'op-1', title: 'Alpha Role', archivedAt: ARCHIVED_AT }),
        makeOpportunity({ id: 'op-2', title: 'Beta Role', archivedAt: ARCHIVED_AT }),
      ],
    ) as NonNullable<ReturnType<typeof createBatchArchiveUndoEntry>>;

    const result = applyUndo(
      [makeOpportunity({ id: 'op-1', title: 'Alpha Role', archivedAt: ARCHIVED_AT })],
      entry,
    );

    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    if (!result.ok) {
      expect(result.message).toContain('“Beta Role”');
      expect(result.message).toContain('Nothing was changed.');
    }
  });

  it('refuses the entire batch when one archive state changed', () => {
    const entry = createBatchArchiveUndoEntry(
      [makeOpportunity({ id: 'op-1' }), makeOpportunity({ id: 'op-2' })],
      [
        makeOpportunity({ id: 'op-1', archivedAt: ARCHIVED_AT }),
        makeOpportunity({ id: 'op-2', archivedAt: ARCHIVED_AT }),
      ],
    ) as NonNullable<ReturnType<typeof createBatchArchiveUndoEntry>>;

    const result = applyUndo(
      [
        makeOpportunity({ id: 'op-1', archivedAt: ARCHIVED_AT }),
        makeOpportunity({ id: 'op-2' }),
      ],
      entry,
    );

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    if (!result.ok) expect(result.message).toContain('Nothing was changed.');
  });

  it('reports a single-record batch in the singular', () => {
    const entry = batchEntry(undefined, ARCHIVED_AT) as NonNullable<
      ReturnType<typeof createBatchArchiveUndoEntry>
    >;

    const result = applyUndo(
      [makeOpportunity({ id: 'op-1', archivedAt: ARCHIVED_AT })],
      entry,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('1 opportunity is active again.');
    expect(describeUndoAction(entry)).toBe('Archived 1 opportunity.');
  });
});

describe('createBatchDeleteUndoEntry', () => {
  it('captures every requested record with its original index and snapshot', () => {
    const collection = [
      makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
      makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      makeOpportunity({ id: 'op-3', title: 'Gamma Role' }),
      makeOpportunity({ id: 'op-4', title: 'Delta Role' }),
    ];

    const entry = createBatchDeleteUndoEntry(collection, ['op-4', 'op-2']);

    expect(entry).toMatchObject({ kind: 'batch-delete' });
    if (!entry) return;
    expect(entry.items.map((item) => item.id)).toEqual(['op-2', 'op-4']);
    expect(entry.items.map((item) => item.title)).toEqual(['Beta Role', 'Delta Role']);
    expect(entry.items.map((item) => item.index)).toEqual([1, 3]);
    expect(entry.items[0].snapshot).toEqual(collection[1]);
    expect(entry.items[1].snapshot).toEqual(collection[3]);
    expect(describeUndoAction(entry)).toBe('Deleted 2 opportunities.');
  });

  it('keeps each snapshot independent from later mutations of the live record', () => {
    const contact = makeContact();
    const live = makeOpportunity({
      id: 'op-1',
      notes: 'Original notes',
      activities: [makeActivity()],
      contacts: [contact],
      interviews: [makeInterview({ contactId: contact.id })],
      materials: [makeMaterial()],
    });
    const entry = createBatchDeleteUndoEntry([live], ['op-1']) as BatchDeleteUndoEntry;

    live.notes = 'Changed later';
    live.activities.push(makeActivity({ id: 'activity-2' }));
    live.contacts[0].name = 'Changed Name';
    live.interviews[0].contactId = '';

    expect(entry.items[0].snapshot.notes).toBe('Original notes');
    expect(entry.items[0].snapshot.activities).toHaveLength(1);
    expect(entry.items[0].snapshot.contacts[0].name).toBe('Jordan Lee');
    expect(entry.items[0].snapshot.interviews[0].contactId).toBe('contact-1');
  });

  it('captures archive state and every supported field', () => {
    const archived = makeOpportunity({
      id: 'op-9',
      title: 'Archived Role',
      company: 'Olive & Co.',
      type: 'Freelance',
      status: 'Rejected',
      priority: 'High',
      tags: ['remote', 'design'],
      url: 'https://example.com/role',
      deadline: '2026-04-01',
      followUpDate: '2026-04-05',
      compensation: '$900 fixed',
      description: 'Design a landing page.',
      notes: 'Keep the source files.',
      archivedAt: ARCHIVED_AT,
      activities: [makeActivity({ id: 'activity-9' })],
      contacts: [makeContact({ id: 'contact-9' })],
      interviews: [makeInterview({ id: 'round-9', contactId: 'contact-9' })],
      materials: [makeMaterial({ id: 'material-9' })],
    });

    const entry = createBatchDeleteUndoEntry([archived], ['op-9']) as BatchDeleteUndoEntry;

    expect(entry.items[0].snapshot).toEqual(archived);
    expect(entry.items[0].snapshot.archivedAt).toBe(ARCHIVED_AT);
    expect(entry.items[0].snapshot.interviews[0].contactId).toBe('contact-9');
  });

  it('returns null when the request matches no stored record', () => {
    const collection = [makeOpportunity({ id: 'op-1' })];

    expect(createBatchDeleteUndoEntry(collection, [])).toBeNull();
    expect(createBatchDeleteUndoEntry(collection, ['missing'])).toBeNull();
  });

  it('uses the singular notification for one deleted opportunity', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;

    expect(describeUndoAction(entry)).toBe('Deleted 1 opportunity.');
  });
});

describe('applyUndo for a batch delete', () => {
  it('restores separated records at their original positions', () => {
    const collection = [
      makeOpportunity({ id: 'op-1', title: 'Alpha Role' }),
      makeOpportunity({ id: 'op-2', title: 'Beta Role' }),
      makeOpportunity({ id: 'op-3', title: 'Gamma Role' }),
      makeOpportunity({ id: 'op-4', title: 'Delta Role' }),
      makeOpportunity({ id: 'op-5', title: 'Epsilon Role' }),
    ];
    const entry = createBatchDeleteUndoEntry(collection, [
      'op-2',
      'op-4',
    ]) as BatchDeleteUndoEntry;
    const remaining = collection.filter(
      (item) => item.id !== 'op-2' && item.id !== 'op-4',
    );

    const result = applyUndo(remaining, entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual([
      'op-1',
      'op-2',
      'op-3',
      'op-4',
      'op-5',
    ]);
    expect(result.message).toBe('All 2 opportunities were restored.');
    // The input collection is untouched.
    expect(remaining.map((item) => item.id)).toEqual(['op-1', 'op-3', 'op-5']);
  });

  it('restores adjacent records in their original order', () => {
    const collection = [
      makeOpportunity({ id: 'op-1' }),
      makeOpportunity({ id: 'op-2' }),
      makeOpportunity({ id: 'op-3' }),
      makeOpportunity({ id: 'op-4' }),
    ];
    const entry = createBatchDeleteUndoEntry(collection, [
      'op-2',
      'op-3',
    ]) as BatchDeleteUndoEntry;

    const result = applyUndo([collection[0], collection[3]], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual([
      'op-1',
      'op-2',
      'op-3',
      'op-4',
    ]);
  });

  it('restores a fully deleted collection in its original order', () => {
    const collection = [
      makeOpportunity({ id: 'op-1' }),
      makeOpportunity({ id: 'op-2' }),
      makeOpportunity({ id: 'op-3' }),
    ];
    const entry = createBatchDeleteUndoEntry(collection, [
      'op-1',
      'op-2',
      'op-3',
    ]) as BatchDeleteUndoEntry;

    const result = applyUndo([], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
  });

  it('preserves active and archived state, IDs and nested records', () => {
    const contact = makeContact({ id: 'contact-1' });
    const interview = makeInterview({ id: 'round-1', contactId: contact.id });
    const material = makeMaterial({ id: 'material-1' });
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this note.' });
    const active = makeOpportunity({
      id: 'op-1',
      title: 'Alpha Role',
      status: 'Offer',
      notes: 'Active notes',
      tags: ['remote'],
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    const archived = makeOpportunity({
      id: 'op-2',
      title: 'Beta Role',
      status: 'Rejected',
      archivedAt: ARCHIVED_AT,
    });
    const survivor = makeOpportunity({ id: 'op-3', title: 'Gamma Role' });
    const collection = [active, archived, survivor];
    const entry = createBatchDeleteUndoEntry(collection, [
      'op-1',
      'op-2',
    ]) as BatchDeleteUndoEntry;

    const result = applyUndo([survivor], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(result.items[0]).toMatchObject({
      status: 'Offer',
      notes: 'Active notes',
      tags: ['remote'],
      activities: [activity],
      contacts: [contact],
      interviews: [interview],
      materials: [material],
    });
    expect(result.items[0].archivedAt).toBeUndefined();
    expect(result.items[1].archivedAt).toBe(ARCHIVED_AT);
    expect(result.items[1].status).toBe('Rejected');
    expect(result.items[0].interviews[0].contactId).toBe('contact-1');
    // Undo never fabricates activity entries or changes status history.
    expect(result.items[0].activities).toHaveLength(1);
    expect(result.items[1].activities).toEqual([]);
    expect(result.items[2]).toBe(survivor);
  });

  it('refuses the entire batch when a restored ID already exists', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1', title: 'Alpha Role' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;
    const replacement = makeOpportunity({ id: 'op-1', title: 'Replacement Role' });

    const result = applyUndo([replacement], entry);

    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    if (!result.ok) {
      expect(result.message).toContain('already exists');
      expect(result.message).toContain('Nothing was changed.');
    }
  });

  it('refuses a batch whose snapshots repeat one ID', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1', title: 'Alpha Role' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;
    const corrupted: BatchDeleteUndoEntry = {
      kind: 'batch-delete',
      items: [entry.items[0], { ...entry.items[0], title: 'Copy Role' }],
    };

    const result = applyUndo([], corrupted);

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    if (!result.ok) expect(result.message).toContain('appears more than once');
  });

  it('refuses a snapshot whose ID does not match its entry', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;
    const corrupted = {
      kind: 'batch-delete',
      items: [
        { ...entry.items[0], snapshot: makeOpportunity({ id: 'op-other' }) },
      ],
    } as BatchDeleteUndoEntry;

    const result = applyUndo([], corrupted);

    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    if (!result.ok) expect(result.message).toContain('Nothing was changed.');
  });

  it('refuses unusable original positions instead of guessing', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;
    const corrupted: BatchDeleteUndoEntry = {
      kind: 'batch-delete',
      items: [{ ...entry.items[0], index: -1 }],
    };

    const result = applyUndo([], corrupted);

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    if (!result.ok) expect(result.message).toContain('positions are invalid');
  });

  it('clamps an original position beyond the current collection', () => {
    const entry = createBatchDeleteUndoEntry(
      [
        makeOpportunity({ id: 'op-1' }),
        makeOpportunity({ id: 'op-2' }),
        makeOpportunity({ id: 'op-3' }),
        makeOpportunity({ id: 'op-4' }),
      ],
      ['op-4'],
    ) as BatchDeleteUndoEntry;
    const survivor = makeOpportunity({ id: 'op-9' });

    const result = applyUndo([survivor], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items.map((item) => item.id)).toEqual(['op-9', 'op-4']);
  });

  it('refuses an empty batch entry', () => {
    const result = applyUndo([], { kind: 'batch-delete', items: [] });

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('reports a single restored opportunity in the singular', () => {
    const entry = createBatchDeleteUndoEntry(
      [makeOpportunity({ id: 'op-1' })],
      ['op-1'],
    ) as BatchDeleteUndoEntry;

    const result = applyUndo([], entry);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('1 opportunity was restored.');
  });
});

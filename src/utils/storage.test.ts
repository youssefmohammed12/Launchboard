import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeActivity,
  makeContact,
  makeInterview,
  makeMaterial,
  makeOpportunity,
} from '../test/fixtures';
import {
  loadOpportunities,
  loadOpportunitiesWithRecovery,
  normalizeOpportunityRecord,
  RECOVERY_KEY,
  removeRecoveryCopy,
  replaceRecoveryCopy,
  resetOpportunityWriteBlock,
  retryRecoveryPreservation,
  saveOpportunities,
} from './storage';

const KEY = 'launchboard.opportunities.v1';

const minimalRecord = {
  id: 'legacy-1',
  title: 'Legacy Role',
  company: 'Legacy Co.',
  type: 'Full-time',
  status: 'Saved',
};

function store(value: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(value));
}

function readStored(): unknown {
  return JSON.parse(localStorage.getItem(KEY) ?? 'null');
}

beforeEach(() => {
  localStorage.clear();
  resetOpportunityWriteBlock();
});

describe('loadOpportunities', () => {
  it('seeds demonstration records the first time storage is empty', () => {
    const items = loadOpportunities();

    expect(items).toHaveLength(6);
    expect(items.every((item) => item.isDemo === true)).toBe(true);
    expect(readStored()).toHaveLength(6);
  });

  it('repairs a legacy record that has only the required fields', () => {
    store([minimalRecord]);

    const [item] = loadOpportunities();

    expect(item).toMatchObject({
      ...minimalRecord,
      priority: 'Medium',
      tags: [],
      url: '',
      deadline: '',
      followUpDate: '',
      activities: [],
      interviews: [],
      contacts: [],
      materials: [],
      tasks: [],
      locations: [],
      department: '',
      team: '',
      workplaceType: '',
      employmentType: '',
      postedDate: '',
      compensationDetails: null,
      compensation: '',
      description: '',
      notes: '',
    });
    expect(item.isDemo).toBeUndefined();
  });

  it('repairs malformed structured job details without discarding the opportunity', () => {
    store([{
      ...minimalRecord,
      id: 'job-details-repair',
      locations: [' Cairo ', 'cairo', 42, 'Berlin'],
      department: ' Engineering ',
      team: 'T'.repeat(200),
      workplaceType: 'Fully remote',
      employmentType: ' Full-time ',
      postedDate: '2026-02-30',
      compensation: 'EGP 15,000–20,000 monthly',
      compensationDetails: {
        minAmount: '20000',
        maxAmount: '15000',
        currency: 'egp',
        interval: 'month',
      },
    }]);

    const [item] = loadOpportunities();
    expect(item).toMatchObject({
      locations: ['Cairo', 'Berlin'],
      department: 'Engineering',
      team: 'T'.repeat(160),
      workplaceType: '',
      employmentType: 'Full-time',
      postedDate: '',
      compensation: 'EGP 15,000–20,000 monthly',
      compensationDetails: null,
    });
  });

  it('normalizes legacy tasks to an empty collection and safely repairs malformed task children', () => {
    const task = {
      id: 'task-1',
      title: 'Prepare for interview',
      notes: 'Review the role',
      priority: 'High',
      dueDate: '2026-11-08',
      completed: false,
      completedOn: '',
    };
    store([{
      ...minimalRecord,
      id: 'with-tasks',
      tasks: [
        task,
        { ...task, id: 'task-2', title: '  Follow up  ', priority: 'Urgent' },
        { ...task, id: 'task-3', title: '   ' },
        { ...task, id: 'task-4', completed: true, completedOn: '' },
        task,
      ],
    }]);

    const loaded = loadOpportunities();
    expect(loaded[0]?.tasks).toEqual([
      task,
      {
        ...task,
        id: 'task-2',
        title: 'Follow up',
        priority: 'Medium',
      },
      {
        ...task,
        id: 'task-4',
        completed: false,
        completedOn: '',
      },
    ]);

    store([{ ...minimalRecord, id: 'legacy-without-tasks' }]);
    expect(loadOpportunities()[0]?.tasks).toEqual([]);
  });

  it('preserves a valid record, including nested activities and demo metadata', () => {
    const activity = makeActivity({
      id: 'activity-1',
      type: 'Interview scheduled',
      date: '2026-01-12',
      note: 'Technical screen',
    });
    const contact = makeContact({ id: 'contact-7', name: 'Jordan Lee' });
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    const interview = makeInterview({
      id: 'interview-1',
      round: 'Technical Interview',
      preparationNotes: 'Review the design system.',
      contactId: 'contact-7',
    });
    const record = makeOpportunity({
      id: 'op-valid',
      title: 'Frontend Engineer',
      company: 'Northwind Labs',
      type: 'Full-time',
      status: 'Interview',
      priority: 'High',
      tags: ['Remote', 'React'],
      url: 'https://example.com/jobs/1',
      deadline: '2026-02-01',
      followUpDate: '2026-01-20',
      activities: [activity],
      interviews: [interview],
      contacts: [contact],
      materials: [material],
      compensation: '$70,000',
      description: 'Build the design system.',
      notes: 'Referral from Sam.',
      isDemo: true,
    });
    store([record]);

    const [item] = loadOpportunities();

    expect(item).toEqual(record);
  });

  it('repairs malformed optional fields without discarding the record', () => {
    const validActivity = makeActivity({ id: 'valid-activity' });
    store([
      {
        ...minimalRecord,
        priority: 'Urgent',
        tags: [' Remote ', 'remote', 42, '', '  '],
        url: 42,
        deadline: 42,
        followUpDate: '2026-02-30',
        activities: [validActivity, { id: '', type: 'Other', date: '2026-01-01' }],
        compensation: null,
        description: 42,
        notes: null,
        isDemo: 'yes',
      },
    ]);

    const [item] = loadOpportunities();

    expect(item.priority).toBe('Medium');
    expect(item.tags).toEqual(['Remote']);
    expect(item.url).toBe('');
    expect(item.deadline).toBe('');
    expect(item.followUpDate).toBe('');
    expect(item.activities).toEqual([validActivity]);
    expect(item.compensation).toBe('');
    expect(item.description).toBe('');
    expect(item.notes).toBe('');
    expect(item.isDemo).toBeUndefined();
  });

  it('repairs or skips interviews without discarding the parent opportunity', () => {
    const validInterview = makeInterview({ id: 'valid-interview' });
    store([
      {
        ...minimalRecord,
        id: 'interview-parent',
        notes: 'Keep this note.',
        interviews: [
          validInterview,
          { id: 'bad-date', round: 'Bad date', date: '2026-02-30' },
          { id: 'valid-interview', round: 'Duplicate ID', date: '2026-01-16' },
          {
            id: 'repaired-interview',
            round: '  Final Interview  ',
            date: '2026-02-01',
            time: '9:00',
            mode: 'Zoom',
            status: 'Ghosted',
          },
          null,
        ],
      },
    ]);

    const [item] = loadOpportunities();

    expect(item).toMatchObject({
      id: 'interview-parent',
      notes: 'Keep this note.',
      interviews: [
        validInterview,
        {
          id: 'repaired-interview',
          round: 'Final Interview',
          date: '2026-02-01',
          time: '',
          mode: 'Other',
          status: 'Scheduled',
        },
      ],
    });
  });

  it('repairs or skips contacts and materials without discarding the parent opportunity', () => {
    const validContact = makeContact({ id: 'valid-contact' });
    const validMaterial = makeMaterial({ id: 'valid-material' });
    store([
      {
        ...minimalRecord,
        id: 'workspace-parent',
        notes: 'Keep this note.',
        contacts: [
          validContact,
          null,
          { id: 'no-name', name: '   ', role: 'Recruiter' },
          { id: 'valid-contact', name: 'Duplicate contact' },
          {
            id: 'repaired-contact',
            name: '  Sam Rivera  ',
            email: 'not-an-email',
            website: 'javascript:alert(1)',
          },
        ],
        materials: [
          validMaterial,
          { id: 'no-label', label: '   ', kind: 'Resume', status: 'Ready' },
          { id: 'valid-material', label: 'Duplicate material' },
          {
            id: 'repaired-material',
            label: '  Draft resume  ',
            kind: 'Take-home',
            status: 'Final',
            url: 'not-a-url',
          },
        ],
      },
    ]);

    const [item] = loadOpportunities();

    expect(item).toMatchObject({
      id: 'workspace-parent',
      notes: 'Keep this note.',
      contacts: [
        validContact,
        {
          id: 'repaired-contact',
          name: 'Sam Rivera',
          email: '',
          website: '',
        },
      ],
      materials: [
        validMaterial,
        {
          id: 'repaired-material',
          label: 'Draft resume',
          kind: 'Other',
          status: 'Draft',
          url: '',
        },
      ],
    });
  });

  it('clears interview references to missing contacts and preserves the interviews', () => {
    const linkedContact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const linkedInterview = makeInterview({
      id: 'linked',
      round: 'Recruiter Screen',
      contactId: 'contact-1',
    });
    const orphanedInterview = makeInterview({
      id: 'orphaned',
      round: 'Technical Interview',
      date: '2026-02-01',
      contactId: 'missing-contact',
      status: 'Completed',
      outcome: 'Positive',
      notes: 'Keep this history.',
    });
    const result = normalizeOpportunityRecord({
      ...minimalRecord,
      contacts: [linkedContact],
      interviews: [linkedInterview, orphanedInterview],
    });

    expect(result.failure).toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.opportunity?.interviews).toEqual([
      linkedInterview,
      {
        ...orphanedInterview,
        contactId: '',
      },
    ]);
  });

  it('persists and reloads interviews, contacts, materials and their links', () => {
    const contact = makeContact({ id: 'contact-1', name: 'Jordan Lee' });
    const material = makeMaterial({ id: 'material-1', label: 'Frontend Resume' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'workspace',
      interviews: [interview],
      contacts: [contact],
      materials: [material],
    });

    expect(saveOpportunities([item])).toBe(true);

    const [loaded] = loadOpportunities();
    expect(loaded).toEqual(item);
    expect(loaded.interviews[0].contactId).toBe('contact-1');
    expect(loaded.contacts[0].id).toBe('contact-1');
    expect(loaded.materials[0].id).toBe('material-1');
  });

  it('caps too many stored tags at ten', () => {
    const tags = Array.from({ length: 12 }, (_, index) => `tag-${index}`);
    store([{ ...minimalRecord, tags }]);

    const [item] = loadOpportunities();

    expect(item.tags).toHaveLength(10);
    expect(item.tags).toEqual(tags.slice(0, 10));
  });

  it('drops only records that cannot be repaired', () => {
    store([
      null,
      'not a record',
      { ...minimalRecord, id: '' },
      { ...minimalRecord, title: '   ' },
      { ...minimalRecord, company: '' },
      { ...minimalRecord, type: 'Contract' },
      { ...minimalRecord, status: 'Ghosted' },
      { ...minimalRecord, id: 'kept' },
    ]);

    const items = loadOpportunities();

    expect(items.map((item) => item.id)).toEqual(['kept']);
  });

  it('preserves unreadable JSON and non-array values instead of treating them as empty data', () => {
    localStorage.setItem(KEY, '{not-json');
    const invalidJson = loadOpportunitiesWithRecovery();

    expect(invalidJson.items).toEqual([]);
    expect(invalidJson.status).toBe('unreadable');
    expect(invalidJson.rawPresent).toBe(true);
    expect(invalidJson.preserved).toBe(true);
    expect(invalidJson.writesBlocked).toBe(false);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('{not-json');
    expect(localStorage.getItem(KEY)).toBe('{not-json');

    localStorage.removeItem(RECOVERY_KEY);
    const objectRaw = JSON.stringify({ records: [] });
    localStorage.setItem(KEY, objectRaw);
    const objectValue = loadOpportunitiesWithRecovery();

    expect(objectValue.items).toEqual([]);
    expect(objectValue.status).toBe('unreadable');
    expect(objectValue.preserved).toBe(true);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(objectRaw);
    expect(localStorage.getItem(KEY)).toBe(objectRaw);
  });

  it('runs in memory when storage access is blocked', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is blocked');
    });

    const items = loadOpportunities();

    expect(items).toHaveLength(6);
    getItem.mockRestore();
  });

  it('repairs malformed deadlines using the same policy as follow-up dates', () => {
    store([
      {
        ...minimalRecord,
        deadline: 'next Friday',
        followUpDate: '2026-02-30',
        id: 'bad-dates',
      },
      {
        ...minimalRecord,
        deadline: 20260201,
        followUpDate: '2026-13-01',
        id: 'wrong-types',
      },
    ]);

    const items = loadOpportunities();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'bad-dates', deadline: '', followUpDate: '' });
    expect(items[1]).toMatchObject({ id: 'wrong-types', deadline: '', followUpDate: '' });
  });

  it('keeps valid ISO dates, including leap days, and preserves other fields', () => {
    store([
      {
        ...minimalRecord,
        title: 'Leap Day Role',
        company: 'Calendar Co.',
        deadline: '2028-02-29',
        followUpDate: '2028-03-01',
        notes: 'Keep this note.',
      },
    ]);

    const [item] = loadOpportunities();

    expect(item).toMatchObject({
      title: 'Leap Day Role',
      company: 'Calendar Co.',
      deadline: '2028-02-29',
      followUpDate: '2028-03-01',
      notes: 'Keep this note.',
    });
  });

  it('treats empty and missing optional dates as the canonical absent value', () => {
    store([
      { ...minimalRecord, id: 'empty-dates', deadline: '', followUpDate: '' },
      { ...minimalRecord, id: 'missing-dates' },
    ]);

    const items = loadOpportunities();

    expect(items.every((item) => item.deadline === '' && item.followUpDate === '')).toBe(true);
  });
});

describe('storage recovery', () => {
  it('distinguishes absent, valid-empty, and unique arrays from unreadable values', () => {
    const seeded = loadOpportunitiesWithRecovery();
    expect(seeded.status).toBe('seeded');
    expect(seeded.rawPresent).toBe(false);
    expect(seeded.items).toHaveLength(6);

    localStorage.clear();
    localStorage.setItem(KEY, '[]');
    const empty = loadOpportunitiesWithRecovery();
    expect(empty.status).toBe('valid');
    expect(empty.rawPresent).toBe(true);
    expect(empty.items).toEqual([]);
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();

    localStorage.clear();
    const raw = JSON.stringify([
      makeOpportunity({ id: 'legacy-1' }),
      makeOpportunity({ id: 'legacy-2' }),
    ]);
    localStorage.setItem(KEY, raw);
    const valid = loadOpportunitiesWithRecovery();
    expect(valid.status).toBe('valid');
    expect(valid.items.map((item) => item.id)).toEqual(['legacy-1', 'legacy-2']);
    expect(valid.duplicateCount).toBe(0);
    expect(valid.writesBlocked).toBe(false);
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('keeps the first valid duplicate and does not let a malformed record reserve its ID', () => {
    const raw = JSON.stringify([
      { ...minimalRecord, id: 'dup', title: '' },
      { ...minimalRecord, id: 'dup', title: 'First valid' },
      { ...minimalRecord, id: 'dup', title: 'Later valid' },
      minimalRecord,
    ]);
    localStorage.setItem(KEY, raw);

    const result = loadOpportunitiesWithRecovery();

    expect(result.status).toBe('duplicates');
    expect(result.items.map((item) => item.title)).toEqual(['First valid', 'Legacy Role']);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(result.items.length);
    expect(result.duplicateCount).toBe(1);
    expect(result.invalidRecordCount).toBe(1);
    expect(result.preserved).toBe(true);
    expect(result.writesBlocked).toBe(false);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    // Loading alone must not rewrite the primary collection.
    expect(localStorage.getItem(KEY)).toBe(raw);

    expect(saveOpportunities(result.items)).toBe(true);
    expect(readStored()).toHaveLength(2);
    // The recovery copy survives the normalized write.
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
  });

  it('refuses to overwrite a different existing recovery copy and blocks writes', () => {
    localStorage.setItem(RECOVERY_KEY, 'earlier recovery');
    localStorage.setItem(KEY, '{not-json');

    const result = loadOpportunitiesWithRecovery();

    expect(result.status).toBe('unreadable');
    expect(result.preserved).toBe(false);
    expect(result.writesBlocked).toBe(true);
    expect(result.recoveryRaw).toBeNull();
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier recovery');
    expect(localStorage.getItem(KEY)).toBe('{not-json');

    expect(saveOpportunities([makeOpportunity({ id: 'new' })])).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('{not-json');
  });

  it('blocks writes when the recovery copy cannot be written', () => {
    localStorage.setItem(KEY, '{not-json');
    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === RECOVERY_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        originalSetItem.call(localStorage, key, value);
      });

    try {
      const result = loadOpportunitiesWithRecovery();

      expect(result.status).toBe('unreadable');
      expect(result.preserved).toBe(false);
      expect(result.writesBlocked).toBe(true);
      expect(result.recoveryRaw).toBeNull();
      expect(localStorage.getItem(KEY)).toBe('{not-json');
      expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
      expect(saveOpportunities([])).toBe(false);
      expect(localStorage.getItem(KEY)).toBe('{not-json');
    } finally {
      setItem.mockRestore();
    }
  });
});

describe('recovery management', () => {
  it('discovers a retained recovery copy with a valid primary collection and removes only that key', () => {
    const primary = JSON.stringify([makeOpportunity({ id: 'kept', title: 'Kept Role' })]);
    localStorage.setItem(KEY, primary);
    localStorage.setItem(RECOVERY_KEY, 'earlier raw payload');

    const result = loadOpportunitiesWithRecovery();

    expect(result.status).toBe('valid');
    expect(result.recovery).toMatchObject({
      kind: 'retained',
      preserved: true,
      writesBlocked: false,
      recoveryCopy: 'earlier raw payload',
      primaryRaw: null,
      failure: null,
    });
    expect(result.recoveryRaw).toBe('earlier raw payload');

    const storedBeforeRemoval = localStorage.getItem(KEY);
    const removal = removeRecoveryCopy();

    expect(removal.ok).toBe(true);
    expect(removal.recovery.kind).toBe('none');
    expect(removal.recovery.recoveryCopy).toBeNull();
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBe(storedBeforeRemoval);
  });

  it('refuses removal while the recovery copy still protects unreadable or duplicate data', () => {
    const raw = JSON.stringify([
      makeOpportunity({ id: 'dup', title: 'First Role' }),
      makeOpportunity({ id: 'dup', title: 'Duplicate Role' }),
    ]);
    localStorage.setItem(KEY, raw);

    const result = loadOpportunitiesWithRecovery();
    expect(result.recovery.kind).toBe('duplicates');
    expect(result.recovery.primaryRaw).toBe(raw);

    const blockedRemoval = removeRecoveryCopy();
    expect(blockedRemoval.ok).toBe(false);
    expect(blockedRemoval.recovery.failure).toBe('remove-blocked');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);

    expect(saveOpportunities(result.items)).toBe(true);
    const removal = removeRecoveryCopy();
    expect(removal.ok).toBe(true);
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
  });

  it('requires explicit replacement to resolve a conflicting recovery copy and unblocks writes only after verification', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);
    localStorage.setItem(RECOVERY_KEY, 'earlier recovery');

    const result = loadOpportunitiesWithRecovery();
    expect(result.recovery).toMatchObject({
      kind: 'unreadable',
      preserved: false,
      writesBlocked: true,
      recoveryCopy: 'earlier recovery',
      primaryRaw: raw,
      failure: 'conflict',
    });
    expect(saveOpportunities([])).toBe(false);

    // Retrying ordinary preservation must not silently replace the earlier copy.
    const retry = retryRecoveryPreservation();
    expect(retry.ok).toBe(false);
    expect(retry.recovery.failure).toBe('conflict');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier recovery');

    const replacement = replaceRecoveryCopy();

    expect(replacement.ok).toBe(true);
    expect(replacement.recovery).toMatchObject({
      preserved: true,
      writesBlocked: false,
      recoveryCopy: raw,
      primaryRaw: raw,
      failure: null,
    });
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(saveOpportunities([makeOpportunity({ id: 'new' })])).toBe(true);
  });

  it('keeps writes blocked and the primary value unchanged when replacement fails', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);
    localStorage.setItem(RECOVERY_KEY, 'earlier recovery');
    loadOpportunitiesWithRecovery();

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === RECOVERY_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        originalSetItem.call(localStorage, key, value);
      });

    try {
      const replacement = replaceRecoveryCopy();

      expect(replacement.ok).toBe(false);
      expect(replacement.recovery).toMatchObject({
        preserved: false,
        writesBlocked: true,
        recoveryCopy: 'earlier recovery',
        primaryRaw: raw,
        failure: 'write-failed',
      });
      expect(localStorage.getItem(KEY)).toBe(raw);
      expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier recovery');
      expect(saveOpportunities([])).toBe(false);
      expect(localStorage.getItem(KEY)).toBe(raw);
    } finally {
      setItem.mockRestore();
    }
  });

  it('retries a failed initial preservation and unblocks writes only after read-back verification', () => {
    const raw = '{not-json';
    localStorage.setItem(KEY, raw);

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key: string, value: string) => {
        if (key === RECOVERY_KEY) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        originalSetItem.call(localStorage, key, value);
      });

    const failed = loadOpportunitiesWithRecovery();
    expect(failed.recovery).toMatchObject({
      preserved: false,
      writesBlocked: true,
      recoveryCopy: null,
      primaryRaw: raw,
      failure: 'write-failed',
    });
    expect(localStorage.getItem(KEY)).toBe(raw);

    setItem.mockRestore();

    const retried = retryRecoveryPreservation();

    expect(retried.ok).toBe(true);
    expect(retried.recovery).toMatchObject({
      preserved: true,
      writesBlocked: false,
      recoveryCopy: raw,
      primaryRaw: raw,
      failure: null,
    });
    expect(localStorage.getItem(KEY)).toBe(raw);
    expect(localStorage.getItem(RECOVERY_KEY)).toBe(raw);
    expect(saveOpportunities([makeOpportunity({ id: 'new' })])).toBe(true);
  });

  it('keeps the recovery copy and reports failure when removal is refused by storage', () => {
    const primary = JSON.stringify([makeOpportunity({ id: 'kept' })]);
    localStorage.setItem(KEY, primary);
    localStorage.setItem(RECOVERY_KEY, 'earlier raw payload');
    loadOpportunitiesWithRecovery();

    const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });

    try {
      const removal = removeRecoveryCopy();

      expect(removal.ok).toBe(false);
      expect(removal.recovery.failure).toBe('remove-failed');
      expect(removal.recovery.recoveryCopy).toBe('earlier raw payload');
      expect(localStorage.getItem(KEY)).toBe(primary);
      expect(localStorage.getItem(RECOVERY_KEY)).toBe('earlier raw payload');
    } finally {
      removeItem.mockRestore();
    }
  });
});

describe('normalizeOpportunityRecord', () => {
  it('reports repair metadata and rejection reasons without discarding valid fields', () => {
    const repaired = normalizeOpportunityRecord({
      ...minimalRecord,
      deadline: '2026-02-30',
      followUpDate: 'not-a-date',
      notes: 42,
    });

    expect(repaired.failure).toBeNull();
    expect(repaired.repaired).toBe(true);
    expect(repaired.opportunity).toMatchObject({
      ...minimalRecord,
      deadline: '',
      followUpDate: '',
      notes: '',
    });

    expect(normalizeOpportunityRecord({ ...minimalRecord, id: '' })).toMatchObject({
      opportunity: null,
      failure: 'missing-id',
    });
    expect(normalizeOpportunityRecord({ ...minimalRecord, type: 'Contract' })).toMatchObject({
      opportunity: null,
      failure: 'invalid-type',
    });
    expect(normalizeOpportunityRecord(null)).toMatchObject({
      opportunity: null,
      failure: 'not-an-object',
    });
  });

  it('reports repaired interviews while preserving valid parents and unrelated fields', () => {
    const clean = makeInterview({ id: 'clean-interview' });
    const result = normalizeOpportunityRecord({
      ...minimalRecord,
      notes: 'Keep this note.',
      interviews: [clean, { id: 'bad', round: 'Bad', date: 'not-a-date' }],
    });

    expect(result.failure).toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.opportunity).toMatchObject({
      ...minimalRecord,
      notes: 'Keep this note.',
      interviews: [clean],
    });
  });

  it('reports repaired contacts and materials while preserving valid parents', () => {
    const cleanContact = makeContact({ id: 'clean-contact' });
    const cleanMaterial = makeMaterial({ id: 'clean-material' });
    const result = normalizeOpportunityRecord({
      ...minimalRecord,
      notes: 'Keep this note.',
      contacts: [cleanContact, { id: 'bad-contact', name: '' }],
      materials: [cleanMaterial, { id: 'bad-material', label: '' }],
    });

    expect(result.failure).toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.opportunity).toMatchObject({
      ...minimalRecord,
      notes: 'Keep this note.',
      contacts: [cleanContact],
      materials: [cleanMaterial],
    });
  });

  it('does not report a fully normalized record as repaired', () => {
    const contact = makeContact({ id: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const item = makeOpportunity({
      id: 'clean',
      deadline: '2026-01-15',
      followUpDate: '2026-01-20',
      interviews: [makeInterview({ contactId: 'contact-1' })],
      contacts: [contact],
      materials: [material],
    });

    expect(normalizeOpportunityRecord(item)).toEqual({
      opportunity: item,
      repaired: false,
      failure: null,
    });
  });
});

describe('archive metadata normalization', () => {
  const ARCHIVED_AT = '2026-03-04T09:30:00.000Z';

  it('keeps legacy records without archive metadata active', () => {
    store([minimalRecord]);

    const [item] = loadOpportunities();

    expect(item.archivedAt).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(item, 'archivedAt')).toBe(false);
  });

  it('preserves a valid archive timestamp and every nested record through reload', () => {
    const activity = makeActivity({ id: 'activity-1', note: 'Keep this.' });
    const contact = makeContact({ id: 'contact-1' });
    const material = makeMaterial({ id: 'material-1' });
    const interview = makeInterview({ id: 'round-1', contactId: 'contact-1' });
    const item = makeOpportunity({
      id: 'archived-op',
      status: 'Interview',
      archivedAt: ARCHIVED_AT,
      activities: [activity],
      contacts: [contact],
      materials: [material],
      interviews: [interview],
    });

    expect(saveOpportunities([item])).toBe(true);
    const [loaded] = loadOpportunities();

    expect(loaded).toEqual(item);
    expect(loaded.archivedAt).toBe(ARCHIVED_AT);
    expect(loaded.status).toBe('Interview');
    expect(loaded.activities).toEqual([activity]);
    expect(loaded.contacts).toEqual([contact]);
    expect(loaded.materials).toEqual([material]);
    expect(loaded.interviews).toEqual([interview]);
  });

  it('repairs malformed archive metadata to active without discarding the record', () => {
    store([
      { ...minimalRecord, id: 'bad-string', archivedAt: 'archived yesterday' },
      { ...minimalRecord, id: 'bad-date', archivedAt: '2026-02-30T09:30:00.000Z' },
      { ...minimalRecord, id: 'wrong-type', archivedAt: 42 },
      { ...minimalRecord, id: 'null-value', archivedAt: null },
    ]);

    const items = loadOpportunities();

    expect(items.map((item) => item.id)).toEqual([
      'bad-string',
      'bad-date',
      'wrong-type',
      'null-value',
    ]);
    expect(items.every((item) => item.archivedAt === undefined)).toBe(true);
  });

  it('reports archive repair metadata without changing valid timestamps', () => {
    const complete = makeOpportunity();
    const valid = normalizeOpportunityRecord({
      ...complete,
      archivedAt: ARCHIVED_AT,
    });
    const repaired = normalizeOpportunityRecord({
      ...complete,
      archivedAt: 'not-a-timestamp',
    });

    expect(valid.repaired).toBe(false);
    expect(valid.opportunity?.archivedAt).toBe(ARCHIVED_AT);
    expect(repaired.repaired).toBe(true);
    expect(repaired.failure).toBeNull();
    expect(repaired.opportunity?.archivedAt).toBeUndefined();
  });
});

describe('saveOpportunities', () => {
  it('writes the complete opportunity list to the existing storage key', () => {
    const items = [
      makeOpportunity({ id: 'saved-1', interviews: [makeInterview()] }),
      makeOpportunity({ id: 'saved-2', status: 'Interview' }),
    ];

    expect(saveOpportunities(items)).toBe(true);

    expect(readStored()).toEqual(items);
  });

  it('reports a failed write and leaves the stored collection unchanged', () => {
    const previous = [makeOpportunity({ id: 'previous' })];
    store(previous);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota exceeded');
    });

    expect(() => saveOpportunities([makeOpportunity()])).not.toThrow();
    expect(saveOpportunities([makeOpportunity()])).toBe(false);
    expect(readStored()).toEqual(previous);
    setItem.mockRestore();
  });
});

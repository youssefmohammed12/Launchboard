import {
  ACTIVITY_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  MAX_CONTACTS,
  MAX_CONTACT_NAME_LENGTH,
  MAX_CONTACT_NOTES_LENGTH,
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_TAGS,
  MAX_TASKS,
  MAX_TASK_NOTES_LENGTH,
  MAX_TASK_TITLE_LENGTH,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
} from '@launchboard/domain';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { formatIssuePath } from '../middleware/validateBody.js';
import {
  createOpportunityBodySchema,
  importedOpportunitySchema,
  updateOpportunityBodySchema,
} from '../validation/opportunitySchemas.js';
import {
  createBody,
  updateBody,
  validActivity,
  validContact,
  validInterview,
  validMaterial,
  validOpportunity,
} from './helpers/fixtures.js';

type ParseResult =
  | { success: true; data: unknown }
  | { success: false; error: z.ZodError };

function issuePaths(result: ParseResult): string[] {
  return result.success ? [] : result.error.issues.map((issue) => formatIssuePath(issue.path));
}

function expectCreateRejected(overrides: Record<string, unknown>): void {
  const result = createOpportunityBodySchema.safeParse(createBody(overrides));
  expect(result.success, JSON.stringify(overrides)).toBe(false);
}

describe('opportunity create/update schemas', () => {
  it('accepts a complete create aggregate and normalizes tags', () => {
    const result = createOpportunityBodySchema.safeParse(
      createBody({ tags: [' Remote ', 'remote', 'React'] }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.opportunity.tags).toEqual(['Remote', 'React']);
    }
  });

  it('accepts a client-supplied ID on create and requires one on update', () => {
    expect(
      createOpportunityBodySchema.safeParse(createBody({ id: 'opportunity-1' })).success,
    ).toBe(true);
    expect(updateOpportunityBodySchema.safeParse(updateBody()).success).toBe(true);
    expect(
      updateOpportunityBodySchema.safeParse({ opportunity: { ...validOpportunity } }).success,
    ).toBe(false);
  });

  it('accepts isDemo:false and rejects isDemo:true on normal writes', () => {
    expect(createOpportunityBodySchema.safeParse(createBody({ isDemo: false })).success).toBe(
      true,
    );
    expect(createOpportunityBodySchema.safeParse(createBody({ isDemo: true })).success).toBe(
      false,
    );
  });

  it('rejects missing, blank or wrongly typed title and company', () => {
    for (const overrides of [
      { title: '' },
      { title: '   ' },
      { title: 42 },
      { company: '' },
      { company: '   ' },
      { company: null },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('rejects unknown controlled values', () => {
    for (const overrides of [
      { type: 'Unsupported' },
      { status: 'Pending' },
      { priority: 'Urgent' },
      { activities: [{ ...validActivity, type: 'Unknown activity' }] },
      { interviews: [{ ...validInterview, mode: 'Onsite' }] },
      { interviews: [{ ...validInterview, status: 'Pending' }] },
      { interviews: [{ ...validInterview, outcome: 'Maybe' }] },
      { materials: [{ ...validMaterial, kind: 'Video' }] },
      { materials: [{ ...validMaterial, status: 'Published' }] },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('accepts every shared controlled value', () => {
    for (const type of OPPORTUNITY_TYPES) {
      expect(createOpportunityBodySchema.safeParse(createBody({ type })).success).toBe(true);
    }
    for (const status of OPPORTUNITY_STATUSES) {
      expect(createOpportunityBodySchema.safeParse(createBody({ status })).success).toBe(true);
    }
    for (const priority of PRIORITIES) {
      expect(createOpportunityBodySchema.safeParse(createBody({ priority })).success).toBe(true);
    }
    for (const mode of INTERVIEW_MODES) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ interviews: [{ ...validInterview, mode }] }),
        ).success,
      ).toBe(true);
    }
    for (const status of INTERVIEW_STATUSES) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ interviews: [{ ...validInterview, status }] }),
        ).success,
      ).toBe(true);
    }
    for (const outcome of INTERVIEW_OUTCOMES) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ interviews: [{ ...validInterview, outcome }] }),
        ).success,
      ).toBe(true);
    }
    for (const kind of MATERIAL_KINDS) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ materials: [{ ...validMaterial, kind }] }),
        ).success,
      ).toBe(true);
    }
    for (const status of MATERIAL_STATUSES) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ materials: [{ ...validMaterial, status }] }),
        ).success,
      ).toBe(true);
    }
    for (const type of ACTIVITY_TYPES) {
      expect(
        createOpportunityBodySchema.safeParse(
          createBody({ activities: [{ ...validActivity, type }] }),
        ).success,
      ).toBe(true);
    }
  });

  it('rejects impossible or malformed dates', () => {
    for (const overrides of [
      { deadline: '2026-02-30' },
      { followUpDate: '2026-13-01' },
      { interviews: [{ ...validInterview, date: '2026-04-31' }] },
      { activities: [{ ...validActivity, date: 'not-a-date' }] },
      { interviews: [{ ...validInterview, date: '' }] },
      { activities: [{ ...validActivity, date: '' }] },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('accepts optional structured job details and rejects malformed values', () => {
    const legacy = { ...validOpportunity } as Record<string, unknown>;
    delete legacy.locations;
    delete legacy.department;
    delete legacy.team;
    delete legacy.workplaceType;
    delete legacy.employmentType;
    delete legacy.postedDate;
    delete legacy.compensationDetails;

    expect(createOpportunityBodySchema.safeParse({ opportunity: legacy }).success).toBe(true);
    expect(updateOpportunityBodySchema.safeParse({ opportunity: { id: 'opportunity-1', ...legacy } }).success).toBe(true);

    expect(createOpportunityBodySchema.safeParse(createBody({
      locations: ['Cairo', 'Berlin'],
      department: 'Engineering',
      team: 'Platform',
      workplaceType: 'Hybrid',
      employmentType: 'Full-time',
      postedDate: '2026-11-05',
      compensationDetails: {
        minAmount: '15000.25',
        maxAmount: '20000',
        currency: 'EGP',
        interval: 'month',
      },
    })).success).toBe(true);

    for (const overrides of [
      { locations: Array.from({ length: 11 }, (_unused, index) => 'City ' + index) },
      { locations: ['x'.repeat(161)] },
      { workplaceType: 'Anywhere' },
      { postedDate: '2026-02-30' },
      { compensationDetails: { minAmount: '-1', maxAmount: '', currency: 'EGP', interval: 'month' } },
      { compensationDetails: { minAmount: '20000', maxAmount: '15000', currency: 'EGP', interval: 'month' } },
      { compensationDetails: { minAmount: '1e5', maxAmount: '', currency: 'USD', interval: 'month' } },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('accepts empty optional dates', () => {
    expect(
      createOpportunityBodySchema.safeParse(
        createBody({ deadline: '', followUpDate: '' }),
      ).success,
    ).toBe(true);
  });

  it('rejects invalid interview times, URLs and contact emails', () => {
    for (const overrides of [
      { interviews: [{ ...validInterview, time: '9:30' }] },
      { interviews: [{ ...validInterview, time: '24:00' }] },
      { interviews: [{ ...validInterview, meetingUrl: 'ftp://example.com' }] },
      { url: 'javascript:alert(1)' },
      { contacts: [{ ...validContact, email: 'not-an-email' }] },
      { contacts: [{ ...validContact, website: 'not a url' }] },
      { materials: [{ ...validMaterial, url: 'mailto:someone@example.com' }] },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('accepts empty optional time, URL and email fields', () => {
    expect(
      createOpportunityBodySchema.safeParse(
        createBody({
          url: '',
          interviews: [{ ...validInterview, time: '', meetingUrl: '' }],
          contacts: [{ ...validContact, email: '', website: '' }],
          materials: [{ ...validMaterial, url: '' }],
        }),
      ).success,
    ).toBe(true);
  });

  it('enforces nested collection and field caps', () => {
    const manyInterviews = Array.from({ length: MAX_INTERVIEWS + 1 }, (_, index) => ({
      ...validInterview,
      id: `interview-${index}`,
    }));
    const manyContacts = Array.from({ length: MAX_CONTACTS + 1 }, (_, index) => ({
      ...validContact,
      id: `contact-${index}`,
    }));
    const manyMaterials = Array.from({ length: MAX_MATERIALS + 1 }, (_, index) => ({
      ...validMaterial,
      id: `material-${index}`,
    }));
    const manyTags = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `tag-${index}`);

    for (const overrides of [
      { interviews: manyInterviews },
      { contacts: manyContacts },
      { materials: manyMaterials },
      { tags: manyTags },
      { contacts: [{ ...validContact, name: 'x'.repeat(MAX_CONTACT_NAME_LENGTH + 1) }] },
      { interviews: [{ ...validInterview, round: 'x'.repeat(MAX_INTERVIEW_ROUND_LENGTH + 1) }] },
      { materials: [{ ...validMaterial, label: 'x'.repeat(MAX_MATERIAL_LABEL_LENGTH + 1) }] },
      { interviews: [{ ...validInterview, notes: 'x'.repeat(MAX_INTERVIEW_NOTES_LENGTH + 1) }] },
      { contacts: [{ ...validContact, notes: 'x'.repeat(MAX_CONTACT_NOTES_LENGTH + 1) }] },
      { materials: [{ ...validMaterial, notes: 'x'.repeat(MAX_MATERIAL_NOTES_LENGTH + 1) }] },
      {
        interviews: [
          {
            ...validInterview,
            contactId: 'x'.repeat(MAX_INTERVIEW_CONTACT_ID_LENGTH + 1),
          },
        ],
      },
    ]) {
      expectCreateRejected(overrides);
    }
  });

  it('accepts the exact nested caps', () => {
    const interviews = Array.from({ length: MAX_INTERVIEWS }, (_, index) => ({
      ...validInterview,
      id: `interview-${index}`,
      contactId: '',
    }));
    const contacts = Array.from({ length: MAX_CONTACTS }, (_, index) => ({
      ...validContact,
      id: `contact-${index}`,
    }));
    const materials = Array.from({ length: MAX_MATERIALS }, (_, index) => ({
      ...validMaterial,
      id: `material-${index}`,
    }));
    const tags = Array.from({ length: MAX_TAGS }, (_, index) => `tag-${index}`);

    expect(
      createOpportunityBodySchema.safeParse(
        createBody({ interviews, contacts, materials, tags }),
      ).success,
    ).toBe(true);
  });

  it('validates task fields, completion invariants, duplicate IDs and collection limits', () => {
    const validTask = {
      id: 'task-1',
      title: 'Prepare for interview',
      notes: 'Review the job description',
      priority: 'High',
      dueDate: '2026-11-08',
      completed: false,
      completedOn: '',
    };
    expect(createOpportunityBodySchema.safeParse(createBody({ tasks: [validTask] })).success)
      .toBe(true);
    expect(createOpportunityBodySchema.safeParse(createBody({
      tasks: [{ ...validTask, completed: true, completedOn: '2026-11-07' }],
    })).success).toBe(true);

    for (const task of [
      { ...validTask, id: '   ' },
      { ...validTask, title: '   ' },
      { ...validTask, title: 'x'.repeat(MAX_TASK_TITLE_LENGTH + 1) },
      { ...validTask, notes: 'x'.repeat(MAX_TASK_NOTES_LENGTH + 1) },
      { ...validTask, priority: 'Urgent' },
      { ...validTask, dueDate: '2026-02-30' },
      { ...validTask, completed: true },
      { ...validTask, completedOn: '2026-11-07' },
    ]) {
      expectCreateRejected({ tasks: [task] });
    }

    expectCreateRejected({ tasks: [validTask, { ...validTask }] });
    expectCreateRejected({
      tasks: Array.from({ length: MAX_TASKS + 1 }, (_, index) => ({
        ...validTask,
        id: `task-${index}`,
      })),
    });
  });

  it('validates interview contact references inside the aggregate', () => {
    expect(
      createOpportunityBodySchema.safeParse(
        createBody({ interviews: [{ ...validInterview, contactId: '' }] }),
      ).success,
    ).toBe(true);

    const result = createOpportunityBodySchema.safeParse(
      createBody({ interviews: [{ ...validInterview, contactId: 'missing-contact' }] }),
    );
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('opportunity.interviews[0].contactId');
  });

  it('rejects duplicate child IDs within one opportunity', () => {
    for (const overrides of [
      { activities: [validActivity, { ...validActivity }] },
      { interviews: [validInterview, { ...validInterview }] },
      { contacts: [validContact, { ...validContact }] },
      { materials: [validMaterial, { ...validMaterial }] },
    ]) {
      expectCreateRejected(overrides);
    }

    // The same ID in two different child collections is valid.
    expect(
      createOpportunityBodySchema.safeParse(
        createBody({
          contacts: [{ ...validContact, id: 'shared-id' }],
          materials: [{ ...validMaterial, id: 'shared-id' }],
          interviews: [{ ...validInterview, contactId: 'shared-id' }],
        }),
      ).success,
    ).toBe(true);
  });

  it('rejects server-managed and unknown properties', () => {
    for (const overrides of [
      { archivedAt: '2026-10-27T10:00:00.000Z' },
      { version: 2 },
      { createdAt: '2026-10-27T10:00:00.000Z' },
      { updatedAt: '2026-10-27T10:00:00.000Z' },
      { deletedAt: '2026-10-27T10:00:00.000Z' },
      { interviews: [{ ...validInterview, unexpected: true }] },
    ]) {
      expectCreateRejected(overrides);
    }

    expect(
      createOpportunityBodySchema.safeParse({
        ...createBody(),
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('allows statusActivityDate only on update and validates it', () => {
    expect(
      updateOpportunityBodySchema.safeParse({
        ...updateBody(),
        statusActivityDate: '2026-10-27',
      }).success,
    ).toBe(true);
    expect(
      updateOpportunityBodySchema.safeParse({
        ...updateBody(),
        statusActivityDate: '2026-02-30',
      }).success,
    ).toBe(false);
    expect(
      updateOpportunityBodySchema.safeParse({
        ...createBody(),
        statusActivityDate: '2026-10-27',
      }).success,
    ).toBe(false);
  });
});

describe('imported record schema', () => {
  it('accepts a canonical record with archive and demo metadata', () => {
    const result = importedOpportunitySchema.safeParse({
      id: 'opportunity-1',
      ...validOpportunity,
      archivedAt: '2026-10-27T10:00:00.000Z',
      isDemo: true,
      legacyField: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('legacyField' in result.data).toBe(false);
    }
  });

  it('rejects invalid controlled values, dates and metadata types', () => {
    for (const overrides of [
      { type: 'Unsupported' },
      { deadline: '2026-02-30' },
      { archivedAt: '2026-02-30T00:00:00Z' },
      { archivedAt: 'yesterday' },
      { isDemo: 'yes' },
    ]) {
      expect(
        importedOpportunitySchema.safeParse({
          id: 'opportunity-1',
          ...validOpportunity,
          ...overrides,
        }).success,
      ).toBe(false);
    }
  });

  it('leaves duplicate child IDs for import-time repair and counting', () => {
    expect(
      importedOpportunitySchema.safeParse({
        id: 'opportunity-1',
        ...validOpportunity,
        contacts: [validContact, { ...validContact }],
      }).success,
    ).toBe(true);
  });
});

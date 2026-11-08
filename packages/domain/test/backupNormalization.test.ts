import { describe, expect, it } from 'vitest';
import { normalizeBackupOpportunityRecord } from '../src/index.js';

const validOpportunity = {
  id: 'opportunity-1',
  title: 'Software Engineering Intern',
  company: 'Acme',
  type: 'Internship',
  status: 'Applied',
  priority: 'Medium',
  tags: ['Remote', 'React'],
  url: 'https://example.com/jobs/1',
  deadline: '2026-11-01',
  followUpDate: '',
  activities: [{
    id: 'activity-1',
    type: 'Application submitted',
    date: '2026-10-01',
    note: 'Applied through the careers page.',
  }],
  interviews: [{
    id: 'interview-1',
    round: 'Recruiter Screen',
    date: '2026-10-05',
    time: '09:30',
    mode: 'Video',
    status: 'Scheduled',
    outcome: '',
    meetingUrl: 'https://meet.example.com/abc',
    location: '',
    preparationNotes: '',
    notes: '',
    contactId: 'contact-1',
  }],
  contacts: [{
    id: 'contact-1',
    name: 'Jordan Lee',
    role: 'Recruiter',
    email: 'jordan.lee@example.com',
    phone: '',
    website: '',
    notes: '',
  }],
  materials: [{
    id: 'material-1',
    label: 'Resume',
    kind: 'Resume',
    url: '',
    version: 'v1',
    status: 'Ready',
    notes: '',
  }],
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
};

describe('versioned backup record normalization', () => {
  it('keeps a complete canonical record unchanged', () => {
    const result = normalizeBackupOpportunityRecord(validOpportunity);
    expect(result).toEqual({
      opportunity: validOpportunity,
      repaired: false,
      failure: null,
    });
  });

  it.each([
    [null, 'not-an-object'],
    [42, 'not-an-object'],
    [{ ...validOpportunity, id: '' }, 'missing-id'],
    [{ ...validOpportunity, id: 'x'.repeat(129) }, 'invalid-id'],
    [{ ...validOpportunity, title: '   ' }, 'missing-title'],
    [{ ...validOpportunity, company: '' }, 'missing-company'],
    [{ ...validOpportunity, type: 'Unknown' }, 'invalid-type'],
    [{ ...validOpportunity, status: 'Unknown' }, 'invalid-status'],
  ] as const)('rejects an unrecoverable record', (record, failure) => {
    expect(normalizeBackupOpportunityRecord(record)).toMatchObject({
      opportunity: null,
      failure,
    });
  });

  it('repairs optional fields and drops malformed or duplicate children while preserving valid siblings', () => {
    const result = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      priority: 'Urgent',
      tags: [' Remote ', 'remote', '', 'React', 'x'.repeat(40)],
      deadline: '2026-02-30',
      followUpDate: null,
      archivedAt: 'not-a-timestamp',
      contacts: [
        validOpportunity.contacts[0],
        { ...validOpportunity.contacts[0], name: 'Duplicate contact' },
        { id: 'bad-contact', name: '   ' },
      ],
      interviews: [
        validOpportunity.interviews[0],
        { ...validOpportunity.interviews[0], round: 'Duplicate interview' },
        { ...validOpportunity.interviews[0], id: 'interview-2', contactId: 'missing-contact', time: '25:00' },
      ],
      materials: [
        validOpportunity.materials[0],
        { ...validOpportunity.materials[0], label: 'Duplicate material' },
        { id: 'bad-material', label: '' },
      ],
      activities: [
        validOpportunity.activities[0],
        { ...validOpportunity.activities[0], note: 'Duplicate activity' },
        { id: 'bad-activity', type: 'Unsupported', date: '2026-10-01', note: '' },
      ],
    });

    expect(result.failure).toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.opportunity).toMatchObject({
      priority: 'Medium',
      tags: ['Remote', 'React', 'x'.repeat(24)],
      deadline: '',
      followUpDate: '',
      contacts: [validOpportunity.contacts[0]],
      interviews: [
        validOpportunity.interviews[0],
        { ...validOpportunity.interviews[0], id: 'interview-2', contactId: '', time: '' },
      ],
      materials: [validOpportunity.materials[0]],
      activities: [validOpportunity.activities[0]],
    });
    expect(result.opportunity).not.toHaveProperty('archivedAt');
  });

  it('normalizes legacy v1 and v2 records with safe empty job-detail defaults', () => {
    const legacy = {
      id: validOpportunity.id,
      title: validOpportunity.title,
      company: validOpportunity.company,
      type: validOpportunity.type,
      status: validOpportunity.status,
      tasks: [],
    };

    for (const version of [1, 2]) {
      const result = normalizeBackupOpportunityRecord(legacy, version);
      expect(result.opportunity).toMatchObject({
        locations: [],
        department: '',
        team: '',
        workplaceType: '',
        employmentType: '',
        postedDate: '',
        compensationDetails: null,
      });
      expect(result.repaired).toBe(true);
    }
  });

  it('repairs invalid optional job details independently from a valid backup record', () => {
    const result = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      locations: [' Cairo ', 'cairo', 'Berlin'],
      workplaceType: 'Global',
      postedDate: '2026-02-30',
      compensationDetails: {
        minAmount: '22000',
        maxAmount: '12000',
        currency: 'EGP',
        interval: 'month',
      },
    });

    expect(result.failure).toBeNull();
    expect(result.repaired).toBe(true);
    expect(result.opportunity).toMatchObject({
      locations: ['Cairo', 'Berlin'],
      workplaceType: '',
      postedDate: '',
      compensationDetails: null,
      compensation: '',
    });
  });

  it('imports version-1 records without tasks, ignoring any unversioned task field', () => {
    const legacyTask = {
      id: 'legacy-task',
      title: 'Should not be imported from v1',
      notes: '',
      priority: 'High',
      dueDate: '',
      completed: false,
      completedOn: '',
    };
    const result = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      tasks: [legacyTask],
    }, 1);

    expect(result.opportunity?.tasks).toEqual([]);
    expect(result.repaired).toBe(true);
  });

  it('normalizes valid version-2 tasks and reports missing or repaired task data', () => {
    const task = {
      id: 'task-1',
      title: 'Prepare for interview',
      notes: 'Review the role',
      priority: 'High',
      dueDate: '2026-11-08',
      completed: false,
      completedOn: '',
    };
    const valid = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      tasks: [task],
    }, 2);
    expect(valid.opportunity?.tasks).toEqual([task]);
    expect(valid.repaired).toBe(false);

    const { tasks: _omittedTasks, ...recordWithoutTasks } = validOpportunity;
    const missing = normalizeBackupOpportunityRecord(recordWithoutTasks, 2);
    expect(missing.opportunity?.tasks).toEqual([]);
    expect(missing.repaired).toBe(true);

    const repaired = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      tasks: [task, { ...task, id: 'task-2', priority: 'Urgent' }],
    }, 2);
    expect(repaired.opportunity?.tasks).toHaveLength(2);
    expect(repaired.opportunity?.tasks[1]?.priority).toBe('Medium');
    expect(repaired.repaired).toBe(true);
  });

  it('preserves valid archive instants and demo markers', () => {
    const result = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      archivedAt: '2026-10-31T12:00:00+02:00',
      isDemo: true,
    });

    expect(result.repaired).toBe(false);
    expect(result.opportunity?.archivedAt).toBe('2026-10-31T12:00:00+02:00');
    expect(result.opportunity?.isDemo).toBe(true);
  });

  it('clears a dangling contact reference and counts the parent as repaired', () => {
    const result = normalizeBackupOpportunityRecord({
      ...validOpportunity,
      interviews: [{
        ...validOpportunity.interviews[0],
        contactId: 'missing-contact',
      }],
    });

    expect(result.repaired).toBe(true);
    expect(result.opportunity?.interviews[0]?.contactId).toBe('');
  });
});

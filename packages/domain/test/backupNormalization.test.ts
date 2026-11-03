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
  compensation: '',
  description: '',
  notes: '',
};

describe('version-1 backup record normalization', () => {
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

/**
 * Complete, valid nested records and a complete aggregate. Tests override one
 * field at a time. The override helpers accept `unknown` values so invalid
 * payloads can be constructed without casts.
 */
export const validActivity = {
  id: 'activity-1',
  type: 'Application submitted',
  date: '2026-10-01',
  note: 'Applied through the careers page.',
};

export const validInterview = {
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
};

export const validContact = {
  id: 'contact-1',
  name: 'Jordan Lee',
  role: 'Recruiter',
  email: 'jordan.lee@example.com',
  phone: '',
  website: '',
  notes: '',
};

export const validMaterial = {
  id: 'material-1',
  label: 'Resume',
  kind: 'Resume',
  url: '',
  version: 'v1',
  status: 'Ready',
  notes: '',
};

export const validOpportunity = {
  title: 'Software Engineering Intern',
  company: 'Acme',
  type: 'Internship',
  status: 'Applied',
  priority: 'Medium',
  tags: ['Remote', 'React'],
  url: 'https://example.com/jobs/1',
  deadline: '2026-11-01',
  followUpDate: '',
  activities: [validActivity],
  interviews: [validInterview],
  contacts: [validContact],
  materials: [validMaterial],
  compensation: '',
  description: '',
  notes: '',
};

export function createBody(
  opportunityOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    opportunity: {
      ...validOpportunity,
      ...opportunityOverrides,
    },
  };
}

export function updateBody(
  opportunityOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    opportunity: {
      id: 'opportunity-1',
      ...validOpportunity,
      ...opportunityOverrides,
    },
  };
}

export function backupEnvelope(
  opportunities: readonly unknown[] = [],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    format: 'launchboard-backup',
    schemaVersion: 1,
    exportedAt: '2026-10-27T10:00:00.000Z',
    opportunities,
    ...overrides,
  };
}

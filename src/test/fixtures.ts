import type {
  ActivityEntry,
  ContactEntry,
  InterviewEntry,
  MaterialEntry,
  Opportunity,
} from '../types/opportunity';

/** A complete, valid opportunity with predictable values for focused tests. */
export function makeOpportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'op-1',
    title: 'Frontend Intern',
    company: 'Northwind Labs',
    type: 'Internship',
    status: 'Applied',
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
    compensation: '',
    description: '',
    notes: '',
    ...overrides,
  };
}

export function makeActivity(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'activity-1',
    type: 'Application submitted',
    date: '2026-01-10',
    note: '',
    ...overrides,
  };
}

/** A complete, valid interview with predictable values for focused tests. */
export function makeInterview(overrides: Partial<InterviewEntry> = {}): InterviewEntry {
  return {
    id: 'interview-1',
    round: 'Recruiter Screen',
    date: '2026-01-15',
    time: '10:00',
    mode: 'Video',
    status: 'Scheduled',
    outcome: '',
    meetingUrl: '',
    location: '',
    preparationNotes: '',
    notes: '',
    contactId: '',
    ...overrides,
  };
}

/** A complete, valid contact with predictable values for focused tests. */
export function makeContact(overrides: Partial<ContactEntry> = {}): ContactEntry {
  return {
    id: 'contact-1',
    name: 'Jordan Lee',
    role: 'Recruiter',
    email: 'jordan.lee@example.com',
    phone: '+1 555 010 2030',
    website: 'https://example.com/jordan',
    notes: '',
    ...overrides,
  };
}

/** A complete, valid application material with predictable values. */
export function makeMaterial(overrides: Partial<MaterialEntry> = {}): MaterialEntry {
  return {
    id: 'material-1',
    label: 'Frontend Resume',
    kind: 'Resume',
    url: 'https://example.com/resume.pdf',
    version: 'v1',
    status: 'Ready',
    notes: '',
    ...overrides,
  };
}

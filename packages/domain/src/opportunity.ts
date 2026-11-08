export const OPPORTUNITY_TYPES = ['Internship', 'Full-time', 'Part-time', 'Freelance'] as const;
export const OPPORTUNITY_STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected'] as const;
export const PRIORITIES = ['Low', 'Medium', 'High'] as const;
export const WORKPLACE_TYPES = ['Remote', 'Hybrid', 'On-site'] as const;
export const COMPENSATION_INTERVALS = ['hour', 'day', 'week', 'month', 'year', 'one-time'] as const;
export const INTERVIEW_MODES = ['Phone', 'Video', 'In person', 'Assessment', 'Other'] as const;
export const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled'] as const;
export const INTERVIEW_OUTCOMES = ['Positive', 'Negative', 'No decision'] as const;
export const MATERIAL_KINDS = ['Resume', 'Cover Letter', 'Portfolio', 'Assessment', 'Other'] as const;
export const MATERIAL_STATUSES = ['Draft', 'Ready', 'Submitted', 'Superseded'] as const;

export const USER_ACTIVITY_TYPES = [
  'Application submitted',
  'Recruiter contacted',
  'Interview scheduled',
  'Interview completed',
  'Follow-up sent',
  'Other',
] as const;
export const SYSTEM_ACTIVITY_TYPE = 'Status changed' as const;
export const ACTIVITY_TYPES = [...USER_ACTIVITY_TYPES, SYSTEM_ACTIVITY_TYPE] as const;

export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
export type CompensationInterval = (typeof COMPENSATION_INTERVALS)[number];

/** Exact optional numeric compensation details, represented as decimal strings. */
export interface CompensationDetails {
  minAmount: string;
  maxAmount: string;
  currency: string;
  interval: CompensationInterval | '';
}
export type UserActivityType = (typeof USER_ACTIVITY_TYPES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type InterviewMode = (typeof INTERVIEW_MODES)[number];
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];
export type InterviewOutcome = (typeof INTERVIEW_OUTCOMES)[number];
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
  note: string;
}

export type ActivityDraft = Omit<ActivityEntry, 'id'>;

export interface InterviewEntry {
  id: string;
  /** Round or name, for example "Recruiter Screen" or "Final Interview". */
  round: string;
  /** Local calendar date as YYYY-MM-DD. */
  date: string;
  /** Optional local time as HH:mm, or '' when no time is set. */
  time: string;
  mode: InterviewMode;
  status: InterviewStatus;
  /** Optional result, or '' when no outcome has been recorded. */
  outcome: InterviewOutcome | '';
  /** Optional HTTP(S) meeting URL, or ''. */
  meetingUrl: string;
  location: string;
  preparationNotes: string;
  notes: string;
  /** ID of a contact in the same opportunity, or '' when unassigned. */
  contactId: string;
}

export type InterviewDraft = Omit<InterviewEntry, 'id'>;

export interface ContactEntry {
  id: string;
  name: string;
  /** Role or job title, or ''. */
  role: string;
  /** Optional email address, or ''. */
  email: string;
  /** Optional phone number in any practical international format, or ''. */
  phone: string;
  /** Optional HTTP(S) profile/website URL, or ''. */
  website: string;
  notes: string;
}

export type ContactDraft = Omit<ContactEntry, 'id'>;

export interface MaterialEntry {
  id: string;
  /** User-defined title such as "Resume" or "Portfolio case study". */
  label: string;
  kind: MaterialKind;
  /** Optional HTTP(S) link to an externally hosted file or page, or ''. */
  url: string;
  /** Optional user-defined version label, or ''. */
  version: string;
  status: MaterialStatus;
  notes: string;
}

export type MaterialDraft = Omit<MaterialEntry, 'id'>;

/**
 * A concrete action owned by one opportunity. Due and completion dates are
 * local calendar dates in YYYY-MM-DD form; '' represents an unset date.
 */
export interface TaskEntry {
  id: string;
  title: string;
  notes: string;
  priority: Priority;
  dueDate: string;
  completed: boolean;
  /** Local calendar date on which the task was completed, or '' while open. */
  completedOn: string;
}

/** Editable task content; completion state is changed through explicit lifecycle operations. */
export type TaskDraft = Pick<TaskEntry, 'title' | 'notes' | 'priority' | 'dueDate'>;

export interface Opportunity {
  id: string;
  title: string;
  company: string;
  type: OpportunityType;
  status: OpportunityStatus;
  /** User-defined priority. Older stored records default to Medium. */
  priority: Priority;
  /** User-defined labels, normalized and capped by the storage/form helpers. */
  tags: string[];
  url: string;
  /** Local calendar date as YYYY-MM-DD, or '' when there is no deadline. */
  deadline: string;
  /** Local calendar date as YYYY-MM-DD, or '' when no follow-up is scheduled. */
  followUpDate: string;
  /** Activity history in insertion order; display code sorts newest first. */
  activities: ActivityEntry[];
  /** Interview rounds in insertion order; display code sorts chronologically. */
  interviews: InterviewEntry[];
  /** People associated with this opportunity, in insertion order. */
  contacts: ContactEntry[];
  /** Application materials associated with this opportunity, in insertion order. */
  materials: MaterialEntry[];
  /** Opportunity-owned tasks; normalized records always provide an array. */
  tasks: TaskEntry[];
  /** Ordered job locations with the primary location first. */
  locations: string[];
  department: string;
  team: string;
  /** Employer workplace mode; blank when it was not explicitly supplied. */
  workplaceType: WorkplaceType | '';
  /** Employer's contract type, distinct from Launchboard's tracking type. */
  employmentType: string;
  /** Publication date from the job posting, or '' when unknown. */
  postedDate: string;
  /** Optional parsed numeric salary range; free-text compensation remains canonical. */
  compensationDetails: CompensationDetails | null;
  compensation: string;
  description: string;
  notes: string;
  /**
   * ISO 8601 timestamp recorded when the opportunity was archived.
   * Missing means active. This is deliberately separate from `status`.
   */
  archivedAt?: string;
  /** True only for seeded demonstration records. */
  isDemo?: boolean;
}

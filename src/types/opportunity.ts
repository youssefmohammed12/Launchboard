import type { Opportunity, OpportunityType } from '@launchboard/domain';

/**
 * The domain types and controlled values live in `@launchboard/domain` so the
 * future API can share them. This module re-exports the public surface that the
 * frontend already imports and keeps the form-only types that are not domain
 * contracts.
 */
export {
  ACTIVITY_TYPES,
  INTERVIEW_MODES,
  INTERVIEW_OUTCOMES,
  INTERVIEW_STATUSES,
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
  WORKPLACE_TYPES,
  COMPENSATION_INTERVALS,
  SYSTEM_ACTIVITY_TYPE,
  USER_ACTIVITY_TYPES,
} from '@launchboard/domain';

export type {
  ActivityDraft,
  ActivityEntry,
  ActivityType,
  CompensationDetails,
  CompensationInterval,
  WorkplaceType,
  ContactDraft,
  ContactEntry,
  InterviewDraft,
  InterviewEntry,
  InterviewMode,
  InterviewOutcome,
  InterviewStatus,
  MaterialDraft,
  MaterialEntry,
  TaskDraft,
  TaskEntry,
  MaterialKind,
  MaterialStatus,
  Opportunity,
  OpportunityStatus,
  OpportunityType,
  Priority,
  UserActivityType,
} from '@launchboard/domain';

export type OpportunityFormData = Omit<
  Opportunity,
  'id' | 'isDemo' | 'archivedAt' | 'activities' | 'interviews' | 'contacts' | 'materials' | 'tasks' | 'type'
> & {
  /** Empty until the user explicitly chooses an opportunity type. */
  type: OpportunityType | '';
};
export type FormErrors = Partial<Record<keyof OpportunityFormData, string>>;
export type View = 'dashboard' | 'opportunities' | 'action-center' | 'calendar' | 'deadlines' | 'reports' | 'settings';

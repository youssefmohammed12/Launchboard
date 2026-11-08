import type { CompensationDetails, WorkplaceType } from './opportunity.js';

export type CaptureFieldSource =
  | 'provider-api'
  | 'job-posting-jsonld'
  | 'job-posting-microdata'
  | 'semantic-html'
  | 'page-metadata';

export type CaptureConfidence = 'high' | 'medium' | 'low';

export interface CaptureFieldEvidence {
  source: CaptureFieldSource;
  confidence: CaptureConfidence;
  label: string;
}

/** Evidence is attached to each preview value and is not part of saved Opportunity data. */
export type CaptureFieldEvidenceMap = Partial<Record<
  | 'title'
  | 'company'
  | 'description'
  | 'locations'
  | 'department'
  | 'team'
  | 'workplaceType'
  | 'employmentType'
  | 'postedDate'
  | 'compensation'
  | 'compensationDetails',
  CaptureFieldEvidence
>>;

export interface CaptureStructuredFields {
  locations: string[];
  department: string;
  team: string;
  workplaceType: WorkplaceType | '';
  employmentType: string;
  postedDate: string;
  compensationDetails: CompensationDetails | null;
}

export const EMPTY_CAPTURE_STRUCTURED_FIELDS: CaptureStructuredFields = {
  locations: [],
  department: '',
  team: '',
  workplaceType: '',
  employmentType: '',
  postedDate: '',
  compensationDetails: null,
};

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
  MAX_CONTACT_PHONE_LENGTH,
  MAX_CONTACT_ROLE_LENGTH,
  MAX_CONTACT_WEBSITE_LENGTH,
  MAX_INTERVIEWS,
  MAX_INTERVIEW_CONTACT_ID_LENGTH,
  MAX_INTERVIEW_LOCATION_LENGTH,
  MAX_INTERVIEW_NOTES_LENGTH,
  MAX_INTERVIEW_ROUND_LENGTH,
  MAX_INTERVIEW_URL_LENGTH,
  MAX_MATERIALS,
  MAX_MATERIAL_LABEL_LENGTH,
  MAX_MATERIAL_NOTES_LENGTH,
  MAX_MATERIAL_URL_LENGTH,
  MAX_MATERIAL_VERSION_LENGTH,
  OPPORTUNITY_STATUSES,
  OPPORTUNITY_TYPES,
  PRIORITIES,
} from '@launchboard/domain';
import { z } from 'zod';
import {
  dateSchema,
  idSchema,
  optionalDateSchema,
  optionalEmailSchema,
  optionalTextSchema,
  optionalTimeSchema,
  optionalUncappedUrlSchema,
  optionalUrlSchema,
  requiredTextSchema,
  tagListSchema,
} from './common.js';

export const activitySchema = z.strictObject({
  id: idSchema,
  type: z.enum(ACTIVITY_TYPES),
  date: dateSchema,
  note: z.string(),
});

export const interviewSchema = z.strictObject({
  id: idSchema,
  round: requiredTextSchema(MAX_INTERVIEW_ROUND_LENGTH),
  date: dateSchema,
  time: optionalTimeSchema,
  mode: z.enum(INTERVIEW_MODES),
  status: z.enum(INTERVIEW_STATUSES),
  outcome: z.union([z.literal(''), z.enum(INTERVIEW_OUTCOMES)]),
  meetingUrl: optionalUrlSchema(MAX_INTERVIEW_URL_LENGTH),
  location: optionalTextSchema(MAX_INTERVIEW_LOCATION_LENGTH),
  preparationNotes: optionalTextSchema(MAX_INTERVIEW_NOTES_LENGTH),
  notes: optionalTextSchema(MAX_INTERVIEW_NOTES_LENGTH),
  contactId: z
    .string()
    .max(
      MAX_INTERVIEW_CONTACT_ID_LENGTH,
      `must be at most ${MAX_INTERVIEW_CONTACT_ID_LENGTH} characters`,
    ),
});

export const contactSchema = z.strictObject({
  id: idSchema,
  name: requiredTextSchema(MAX_CONTACT_NAME_LENGTH),
  role: optionalTextSchema(MAX_CONTACT_ROLE_LENGTH),
  email: optionalEmailSchema,
  phone: optionalTextSchema(MAX_CONTACT_PHONE_LENGTH),
  website: optionalUrlSchema(MAX_CONTACT_WEBSITE_LENGTH),
  notes: optionalTextSchema(MAX_CONTACT_NOTES_LENGTH),
});

export const materialSchema = z.strictObject({
  id: idSchema,
  label: requiredTextSchema(MAX_MATERIAL_LABEL_LENGTH),
  kind: z.enum(MATERIAL_KINDS),
  url: optionalUrlSchema(MAX_MATERIAL_URL_LENGTH),
  version: optionalTextSchema(MAX_MATERIAL_VERSION_LENGTH),
  status: z.enum(MATERIAL_STATUSES),
  notes: optionalTextSchema(MAX_MATERIAL_NOTES_LENGTH),
});

/**
 * Fields that are writable through normal create/update requests. Server-managed
 * fields (`archivedAt`, versions, audit timestamps) are deliberately absent so a
 * strict object rejects them.
 *
 * `title`, `company`, `compensation`, `description`, `notes` and the opportunity
 * `url` intentionally have no length cap yet: the backend contract leaves those
 * caps unresolved. The global JSON limit is not a substitute for a field rule.
 */
const opportunityFields = {
  title: requiredTextSchema(),
  company: requiredTextSchema(),
  type: z.enum(OPPORTUNITY_TYPES),
  status: z.enum(OPPORTUNITY_STATUSES),
  priority: z.enum(PRIORITIES),
  tags: tagListSchema,
  url: optionalUncappedUrlSchema,
  deadline: optionalDateSchema,
  followUpDate: optionalDateSchema,
  activities: z.array(activitySchema),
  interviews: z
    .array(interviewSchema)
    .max(MAX_INTERVIEWS, `must contain at most ${MAX_INTERVIEWS} interviews`),
  contacts: z
    .array(contactSchema)
    .max(MAX_CONTACTS, `must contain at most ${MAX_CONTACTS} contacts`),
  materials: z
    .array(materialSchema)
    .max(MAX_MATERIALS, `must contain at most ${MAX_MATERIALS} materials`),
  compensation: z.string(),
  description: z.string(),
  notes: z.string(),
};

type ChildCollection = 'activities' | 'interviews' | 'contacts' | 'materials';

/** The inferred writable aggregate shape, used by the cross-field checks. */
const opportunityFieldsSchema = z.strictObject(opportunityFields);
type OpportunityFields = z.infer<typeof opportunityFieldsSchema>;

function addDuplicateIdIssues(
  ctx: z.RefinementCtx,
  entries: readonly { id: string }[],
  collection: ChildCollection,
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [collection, index, 'id'],
        message: 'must be unique within this opportunity',
      });
    }
    seen.add(entry.id);
  });
}

function validateAggregate(
  value: OpportunityFields,
  ctx: z.RefinementCtx,
): void {
  addDuplicateIdIssues(ctx, value.activities, 'activities');
  addDuplicateIdIssues(ctx, value.interviews, 'interviews');
  addDuplicateIdIssues(ctx, value.contacts, 'contacts');
  addDuplicateIdIssues(ctx, value.materials, 'materials');

  const contactIds = new Set(value.contacts.map((contact) => contact.id));
  value.interviews.forEach((interview, index) => {
    if (interview.contactId !== '' && !contactIds.has(interview.contactId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['interviews', index, 'contactId'],
        message: 'must reference a contact in the same opportunity',
      });
    }
  });
}

/** A create aggregate. The client may preserve its own ID or let the server generate one. */
export const opportunityCreateSchema = z
  .strictObject({
    id: idSchema.optional(),
    ...opportunityFields,
    isDemo: z.literal(false).optional(),
  })
  .superRefine(validateAggregate);

export const createOpportunityBodySchema = z.strictObject({
  opportunity: opportunityCreateSchema,
});

/** An update aggregate. The ID is required and must match the path ID in the route. */
export const opportunityUpdateSchema = z
  .strictObject({
    id: idSchema,
    ...opportunityFields,
    isDemo: z.literal(false).optional(),
  })
  .superRefine(validateAggregate);

export const updateOpportunityBodySchema = z.strictObject({
  opportunity: opportunityUpdateSchema,
  statusActivityDate: dateSchema.optional(),
});

/**
 * Canonical record shape used by the future import service after the envelope
 * has been accepted. Import applies the contract's repair/skip rules, so this
 * schema deliberately does not enforce child-ID uniqueness or contact
 * references; those are repaired and counted during import.
 *
 * Unknown legacy properties on the record itself are ignored here, matching the
 * frontend normalizer, while every known field still has a strict type and
 * value rule. Nested entries keep the strict shape so a malformed child is
 * rejected and counted for the import service rather than silently dropped.
 */
export const importedOpportunitySchema = z.object({
  id: idSchema,
  ...opportunityFields,
  archivedAt: z.iso.datetime({ offset: true }).optional(),
  isDemo: z.boolean().optional(),
});

export type ActivityInput = z.infer<typeof activitySchema>;
export type InterviewInput = z.infer<typeof interviewSchema>;
export type ContactInput = z.infer<typeof contactSchema>;
export type MaterialInput = z.infer<typeof materialSchema>;
export type OpportunityCreateInput = z.infer<typeof opportunityCreateSchema>;
export type OpportunityUpdateInput = z.infer<typeof opportunityUpdateSchema>;
export type CreateOpportunityBody = z.infer<typeof createOpportunityBodySchema>;
export type UpdateOpportunityBody = z.infer<typeof updateOpportunityBodySchema>;
export type ImportedOpportunity = z.infer<typeof importedOpportunitySchema>;

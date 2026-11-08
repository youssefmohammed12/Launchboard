/**
 * Field and collection limits that both the browser and the future API must
 * enforce. They are domain constants, not storage policy: the frontend applies
 * them while normalizing and validating, and the server will apply them while
 * validating requests.
 */

/** Maximum tags stored on one opportunity. */
export const MAX_TAGS = 10;

/** Maximum distinct job/work locations stored on one opportunity. */
export const MAX_OPPORTUNITY_LOCATIONS = 10;
export const MAX_OPPORTUNITY_LOCATION_LENGTH = 160;
export const MAX_OPPORTUNITY_DEPARTMENT_LENGTH = 160;
export const MAX_OPPORTUNITY_TEAM_LENGTH = 160;
export const MAX_OPPORTUNITY_EMPLOYMENT_TYPE_LENGTH = 80;
export const MAX_COMPENSATION_AMOUNT_LENGTH = 24;
/** Maximum characters in one tag. */
export const MAX_TAG_LENGTH = 24;

/** Maximum interview rounds on one opportunity. */
export const MAX_INTERVIEWS = 25;
export const MAX_INTERVIEW_ROUND_LENGTH = 80;
export const MAX_INTERVIEW_LOCATION_LENGTH = 160;
export const MAX_INTERVIEW_NOTES_LENGTH = 2000;
export const MAX_INTERVIEW_URL_LENGTH = 2048;
export const MAX_INTERVIEW_CONTACT_ID_LENGTH = 120;

/** Maximum contacts on one opportunity. */
export const MAX_CONTACTS = 25;
export const MAX_CONTACT_NAME_LENGTH = 120;
export const MAX_CONTACT_ROLE_LENGTH = 120;
/** 254 characters is the practical maximum for an email address. */
export const MAX_CONTACT_EMAIL_LENGTH = 254;
/** Any international format is accepted; only the stored length is limited. */
export const MAX_CONTACT_PHONE_LENGTH = 40;
export const MAX_CONTACT_WEBSITE_LENGTH = 2048;
export const MAX_CONTACT_NOTES_LENGTH = 2000;

/** Maximum tasks stored on one opportunity. */
export const MAX_TASKS = 100;
export const MAX_TASK_ID_LENGTH = 128;
export const MAX_TASK_TITLE_LENGTH = 160;
export const MAX_TASK_NOTES_LENGTH = 1000;

/** Maximum materials on one opportunity. */
export const MAX_MATERIALS = 25;
export const MAX_MATERIAL_LABEL_LENGTH = 120;
export const MAX_MATERIAL_VERSION_LENGTH = 80;
export const MAX_MATERIAL_URL_LENGTH = 2048;
export const MAX_MATERIAL_NOTES_LENGTH = 2000;

/** Conservative guards against accidental or hostile backup input. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 20_000;

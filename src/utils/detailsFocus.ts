/**
 * Stable DOM ids for nested Details records.
 *
 * Global search opens the existing Details dialog and needs to focus the
 * matched interview/contact/material/activity. Keeping the id scheme in one
 * place prevents the dialog and its sections from drifting apart.
 */
export type DetailsFocusCategory = 'interview' | 'contact' | 'material' | 'activity';

export interface DetailsFocusTarget {
  category: DetailsFocusCategory;
  id: string;
}

export function detailsRecordId(category: DetailsFocusCategory, id: string): string {
  return `details-${category}-${id}`;
}

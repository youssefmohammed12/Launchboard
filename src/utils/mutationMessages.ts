/**
 * Shared failure copy for ordinary mutations that persist before updating the
 * interface. `false` from a mutation callback means the write did not happen.
 */
export const SAVE_FAILURE_MESSAGE =
  'Changes could not be saved. Your previous data is unchanged. Please try again.';

export type MutationOutcome = boolean | void;

export const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmailAddress(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_EMAIL_LENGTH &&
    EMAIL_PATTERN.test(value)
  );
}

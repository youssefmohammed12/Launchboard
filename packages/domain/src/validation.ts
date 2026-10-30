import { MAX_CONTACT_EMAIL_LENGTH } from './limits.js';

/** Shared HTTP(S) URL check used by forms, stored-data normalization and the API. */
export function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True only for a valid 24-hour local time in HH:mm format. */
export function isValidInterviewTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/**
 * A deliberately practical email check: one local part, one domain and at
 * least one dot in the domain. It is not intended to implement the full email
 * standard, which would reject addresses browsers and mail servers accept.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidContactEmail(value: string): boolean {
  return value.length <= MAX_CONTACT_EMAIL_LENGTH && EMAIL_PATTERN.test(value);
}

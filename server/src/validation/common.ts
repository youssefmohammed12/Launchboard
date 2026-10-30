import {
  MAX_TAG_LENGTH,
  MAX_TAGS,
  isValidContactEmail,
  isValidInterviewTime,
  isValidISODate,
  isValidUrl,
  normalizeTagList,
} from '@launchboard/domain';
import { z } from 'zod';

/**
 * The backend contract stores stable public IDs as `VARCHAR(128)`. This is a
 * transport/storage bound, not one of the unresolved opportunity text caps.
 */
export const MAX_ID_LENGTH = 128;

export const idSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(MAX_ID_LENGTH, `must be at most ${MAX_ID_LENGTH} characters`);

/** A required string that must contain at least one non-whitespace character. */
export function requiredTextSchema(maxLength?: number) {
  const base = z.string().min(1, 'must not be empty');
  const capped =
    maxLength === undefined
      ? base
      : base.max(maxLength, `must be at most ${maxLength} characters`);
  return capped.refine((value) => value.trim().length > 0, 'must not be blank');
}

/** An optional string field. `''` is the canonical absent value. */
export function optionalTextSchema(maxLength: number) {
  return z.string().max(maxLength, `must be at most ${maxLength} characters`);
}

/** A real `YYYY-MM-DD` calendar date. `''` is not accepted here. */
export const dateSchema = z
  .string()
  .refine(isValidISODate, 'must be a real YYYY-MM-DD calendar date');

/** A date field where `''` means "not set". */
export const optionalDateSchema = z.union([z.literal(''), dateSchema]);

/** `HH:mm` local time, or `''` when no time is set. */
export const optionalTimeSchema = z.union([
  z.literal(''),
  z.string().refine(isValidInterviewTime, 'must be a valid 24-hour HH:mm time'),
]);

/** An HTTP(S) URL, or `''` when the field is not set. */
export function optionalUrlSchema(maxLength: number) {
  return z.union([
    z.literal(''),
    z
      .string()
      .max(maxLength, `must be at most ${maxLength} characters`)
      .refine(isValidUrl, 'must be an HTTP(S) URL'),
  ]);
}

/** An HTTP(S) URL with no field-level cap, used only where the contract has none. */
export const optionalUncappedUrlSchema = z.union([
  z.literal(''),
  z.string().refine(isValidUrl, 'must be an HTTP(S) URL'),
]);

/** A practical email address, or `''` when not set. */
export const optionalEmailSchema = z.union([
  z.literal(''),
  z.string().refine(isValidContactEmail, 'must be a valid email address'),
]);

/**
 * Tags are canonicalized with the shared rule (trim, drop empties, dedupe
 * case-insensitively, cap each tag) after the request has passed the count and
 * length checks. This is a documented domain rule, not silent repair of an
 * invalid type.
 */
export const tagListSchema = z
  .array(
    z
      .string()
      .min(1, 'must not be empty')
      .max(MAX_TAG_LENGTH, `must be at most ${MAX_TAG_LENGTH} characters`)
      .refine((value) => value.trim().length > 0, 'must not be blank'),
  )
  .max(MAX_TAGS, `must contain at most ${MAX_TAGS} tags`)
  .transform((tags) => normalizeTagList(tags));

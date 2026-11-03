import { z } from 'zod';
import {
  isValidEmailAddress,
  MAX_EMAIL_LENGTH,
  normalizeEmailAddress,
} from '../auth/accountIdentifier.js';
import { validateRegistrationPassword } from '../auth/passwordPolicy.js';

const email = z
  .string()
  .min(1)
  .max(MAX_EMAIL_LENGTH)
  .transform(normalizeEmailAddress)
  .refine(isValidEmailAddress, 'must be a valid email address');

export const emailActionSchema = z.object({ email }).strict();

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(128),
}).strict();

export const passwordResetSchema = z.object({
  token: z.string().min(1).max(128),
  password: z.string().refine(
    (value) => validateRegistrationPassword(value).ok,
    'password does not meet policy',
  ),
}).strict();

export type EmailActionInput = z.infer<typeof emailActionSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

import { z } from 'zod';
import {
  isValidEmailAddress,
  MAX_EMAIL_LENGTH,
  normalizeEmailAddress,
} from '../auth/accountIdentifier.js';
import { validateLoginPassword, validateRegistrationPassword } from '../auth/passwordPolicy.js';

export const registerSchema = z
  .object({
    email: z
      .string()
      .min(1, 'must not be empty')
      .max(MAX_EMAIL_LENGTH, 'must be at most 254 characters')
      .transform(normalizeEmailAddress)
      .refine(isValidEmailAddress, 'must be a valid email address'),
    password: z.string().refine((value) => validateRegistrationPassword(value).ok, 'password does not meet policy'),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z
      .string()
      .min(1, 'must not be empty')
      .max(MAX_EMAIL_LENGTH, 'must be at most 254 characters')
      .transform(normalizeEmailAddress)
      .refine(isValidEmailAddress, 'must be a valid email address'),
    password: z.string().refine((value) => validateLoginPassword(value).ok, 'password does not meet policy'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

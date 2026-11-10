import { z } from 'zod';
import { validateLoginPassword, validateRegistrationPassword } from '../auth/passwordPolicy.js';

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(80, 'Display name must be 80 characters or fewer.')
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Display name contains unsupported characters.'),
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).refine(
    (value) => validateLoginPassword(value).ok,
    'Current password is invalid.',
  ),
  newPassword: z.string().refine(
    (value) => validateRegistrationPassword(value).ok,
    'New password does not meet the password policy.',
  ),
}).strict();

export const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).refine(
    (value) => validateLoginPassword(value).ok,
    'Current password is invalid.',
  ),
  confirmation: z.literal('DELETE'),
}).strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

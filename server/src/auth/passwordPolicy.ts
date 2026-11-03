export const PASSWORD_MIN_CODE_POINTS = 15;
export const PASSWORD_MAX_CODE_POINTS = 128;
export const PASSWORD_MAX_UTF8_BYTES = 1024;

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 >= value.length) {
        return true;
      }
      const next = value.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

export function countCodePoints(value: string): number {
  return [...value].length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function validateRegistrationPassword(password: string): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { ok: false, reason: 'password must be a string' };
  }
  if (hasUnpairedSurrogate(password)) {
    return { ok: false, reason: 'password contains invalid unicode' };
  }
  const codePoints = countCodePoints(password);
  if (codePoints < PASSWORD_MIN_CODE_POINTS) {
    return { ok: false, reason: 'password must be at least 15 characters' };
  }
  if (codePoints > PASSWORD_MAX_CODE_POINTS) {
    return { ok: false, reason: 'password must be at most 128 characters' };
  }
  const bytes = utf8ByteLength(password);
  if (bytes > PASSWORD_MAX_UTF8_BYTES) {
    return { ok: false, reason: 'password exceeds maximum byte size' };
  }
  return { ok: true };
}

export function validateLoginPassword(password: string): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { ok: false, reason: 'password must be a string' };
  }
  if (hasUnpairedSurrogate(password)) {
    return { ok: false, reason: 'password contains invalid unicode' };
  }
  const codePoints = countCodePoints(password);
  if (codePoints > PASSWORD_MAX_CODE_POINTS) {
    return { ok: false, reason: 'password must be at most 128 characters' };
  }
  const bytes = utf8ByteLength(password);
  if (bytes > PASSWORD_MAX_UTF8_BYTES) {
    return { ok: false, reason: 'password exceeds maximum byte size' };
  }
  return { ok: true };
}

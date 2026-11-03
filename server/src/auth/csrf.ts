import { createHmac, timingSafeEqual } from 'node:crypto';

const CTX_PRE_AUTH = 'launchboard:csrf:pre-auth:v1';
const CTX_AUTHENTICATED = 'launchboard:csrf:authenticated:v1';

export function deriveCsrfToken(secret: string, context: 'pre-auth' | 'authenticated', sessionToken: string): string {
  const ctx = context === 'pre-auth' ? CTX_PRE_AUTH : CTX_AUTHENTICATED;
  const h = createHmac('sha256', secret).update(ctx).update(':').update(sessionToken).digest();
  return Buffer.from(h).toString('base64url');
}

export function verifyCsrfToken(secret: string, context: 'pre-auth' | 'authenticated', sessionToken: string, submitted: string): boolean {
  try {
    const expected = deriveCsrfToken(secret, context, sessionToken);
    const a = Buffer.from(expected);
    const b = Buffer.from(submitted);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

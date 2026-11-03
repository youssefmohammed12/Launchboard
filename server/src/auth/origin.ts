export function parseTrustedOrigins(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isExactOriginAllowed(origin: string | undefined | null, allowlist: string[]): boolean {
  if (!origin || origin === 'null') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password || url.hostname.includes('*')) return false;
    if (url.pathname !== '/' || url.search || url.hash) return false;
    const exact = `${url.protocol}//${url.host}`;
    return allowlist.includes(exact);
  } catch {
    return false;
  }
}

export function validateOriginHeader(origin: string | undefined | null, allowlist: string[]): void {
  if (!isExactOriginAllowed(origin, allowlist)) {
    const err = new Error('origin not allowed') as Error & { code?: string };
    err.code = 'FORBIDDEN';
    throw err;
  }
}

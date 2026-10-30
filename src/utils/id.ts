/**
 * Generates an id for a new record or activity. crypto.randomUUID() is only
 * available in secure contexts, so a fallback is used when it is missing (for
 * example when the app is served over plain http from a LAN address).
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

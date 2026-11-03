export function parseUtcDateTime(value: string | Date | null | undefined): Date {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? new Date(Number.NaN) : new Date(value.getTime());
  }
  if (typeof value !== 'string' || value.length === 0) {
    return new Date(Number.NaN);
  }

  const sql = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const match = sql ?? iso;
  if (!match) return new Date(Number.NaN);

  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const millisecond = fraction ? Number(fraction.padEnd(3, '0')) : 0;

  if (
    year < 1000 || year > 9999 ||
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59 ||
    millisecond > 999
  ) return new Date(Number.NaN);

  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) return new Date(Number.NaN);

  if (sql) {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  }

  if (!zone) return new Date(Number.NaN);
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (
      offsetHour > 14 || offsetMinute > 59 ||
      (offsetHour === 14 && offsetMinute !== 0)
    ) return new Date(Number.NaN);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(Number.NaN) : parsed;
}

/** Invalid expiry or comparison time is expired, never active. */
export function isUtcExpired(
  expiresAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const expires = parseUtcDateTime(expiresAt);
  if (Number.isNaN(expires.getTime()) || Number.isNaN(now.getTime())) return true;
  return expires.getTime() <= now.getTime();
}

/** Invalid timestamps and invalid idle windows never authenticate a session. */
export function isWithinIdleWindow(
  lastSeenAt: string | Date | null | undefined,
  idleMs: number,
  now: Date = new Date(),
): boolean {
  const lastSeen = parseUtcDateTime(lastSeenAt);
  if (Number.isNaN(lastSeen.getTime()) || Number.isNaN(now.getTime())) return false;
  if (!Number.isFinite(idleMs) || idleMs < 0) return false;

  const elapsed = now.getTime() - lastSeen.getTime();
  return elapsed >= 0 && elapsed <= idleMs;
}

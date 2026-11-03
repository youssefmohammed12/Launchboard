import cookie from 'cookie';

const IS_PROD = process.env.NODE_ENV === 'production';

export const SESSION_COOKIE_NAME = IS_PROD ? '__Host-launchboard_session' : 'launchboard_session';
export const PRE_SESSION_COOKIE_NAME = IS_PROD ? '__Host-launchboard_pre_session' : 'launchboard_pre_session';

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const FIFTEEN_MIN = 15 * 60;

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: IS_PROD,
    maxAge: SEVEN_DAYS,
  };
}

export function preSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: IS_PROD,
    maxAge: FIFTEEN_MIN,
  };
}

export function clearSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: IS_PROD,
  };
}

export function clearPreSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: IS_PROD,
  };
}

export function serializeCookie(name: string, value: string, options: any) {
  return cookie.serialize(name, value, options);
}

export function parseCookies(header?: string) {
  return cookie.parse(header || '');
}

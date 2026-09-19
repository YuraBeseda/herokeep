/** The `hk_session` cookie (ADR-012 §Sessions exact flags): `HttpOnly; Secure; SameSite=Lax;
 * Path=/`, 180-day sliding `Max-Age`. Centralized here so every route that sets/reads/clears it
 * uses the exact same flags — never re-specified ad hoc at a call site. */
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../auth/sessions.ts';

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

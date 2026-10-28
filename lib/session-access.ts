import { timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { getSessionAccessToken } from '@/lib/db';

// Ariza (audit sessiya) raqami INN va sanadan tuziladi — taxmin qilish oson. Shuning uchun arizaning
// API'lari faqat pasport to'ldirilgan brauzerga ochiq: kirish kaliti HttpOnly cookie'da saqlanadi.
const COOKIE_PREFIX = 'clamo_ariza_';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

function cookieName(sessionId: string) {
  return COOKIE_PREFIX + sessionId.replace(/[^0-9A-Za-z_-]/g, '');
}

function isSecureRequest(request: Request): boolean {
  const host = request.headers.get('host') || '';
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function hasSessionAccess(request: Request, sessionId: string): boolean {
  const expected = getSessionAccessToken(sessionId);
  const provided = readCookie(request, cookieName(sessionId));
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Kirish huquqi bo'lmasa — 403 javob, bo'lsa — null
export function denySessionAccess(request: Request, sessionId: string): NextResponse | null {
  if (hasSessionAccess(request, sessionId)) return null;
  return NextResponse.json(
    { error: "Arizaga kirish huquqi yo'q. Pasport sahifasidan INN orqali qayta kiring.", code: 'NO_ACCESS' },
    { status: 403 }
  );
}

export function setSessionAccessCookie(response: NextResponse, request: Request, sessionId: string, token: string) {
  response.cookies.set(cookieName(sessionId), token, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

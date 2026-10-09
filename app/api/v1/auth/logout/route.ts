import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/backoffice-auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json({ status: 'OK' });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}

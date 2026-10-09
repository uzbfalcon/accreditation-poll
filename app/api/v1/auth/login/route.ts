import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionToken,
  getBackofficeConfig,
  safeEqual,
} from '@/lib/backoffice-auth';

export const dynamic = 'force-dynamic';

// Parol tanlashdan himoya: bitta IP'dan 15 daqiqada 10 ta muvaffaqiyatsiz urinish
const MAX_FAILED = 10;
const WINDOW_MS = 15 * 60 * 1000;
const failedAttempts = new Map<string, { count: number; firstAt: number }>();

// Mijoz IP'si: X-Real-IP'ni oldidagi nginx (Plesk) o'zi qo'yadi; X-Forwarded-For'ning birinchi qiymatini
// mijoz soxtalashtirishi mumkin, shuning uchun undan faqat proksi qo'shgan oxirgi qiymat olinadi.
function clientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean);
  return forwarded?.[forwarded.length - 1] || 'unknown';
}

function isSecureRequest(request: Request): boolean {
  const host = request.headers.get('host') || '';
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

export async function POST(request: Request) {
  const config = getBackofficeConfig();
  if (!config) {
    return NextResponse.json({ error: 'Backoffice paroli sozlanmagan' }, { status: 503 });
  }

  const ip = clientIp(request);
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (entry && now - entry.firstAt < WINDOW_MS && entry.count >= MAX_FAILED) {
    const minutes = Math.ceil((WINDOW_MS - (now - entry.firstAt)) / 60000);
    return NextResponse.json(
      { error: `Juda ko'p urinish. ${minutes} daqiqadan keyin qayta urinib ko'ring.` },
      { status: 429 }
    );
  }

  let username = '';
  let password = '';
  try {
    const body = await request.json();
    username = String(body.username || '');
    password = String(body.password || '');
  } catch {
    return NextResponse.json({ error: "Noto'g'ri so'rov" }, { status: 400 });
  }

  // Ikkala taqqoslash ham doim bajariladi (qisqa tutashuvsiz) — login to'g'riligi vaqtdan bilinmasin
  const userOk = safeEqual(username, config.user);
  const passwordOk = safeEqual(password, config.password);
  if (!userOk || !passwordOk) {
    const fresh = !entry || now - entry.firstAt >= WINDOW_MS;
    failedAttempts.set(ip, { count: fresh ? 1 : entry.count + 1, firstAt: fresh ? now : entry.firstAt });
    return NextResponse.json({ error: "Login yoki parol noto'g'ri" }, { status: 401 });
  }

  failedAttempts.delete(ip);
  const response = NextResponse.json({ status: 'OK' });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(config), {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

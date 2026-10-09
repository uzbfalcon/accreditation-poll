import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, getBackofficeConfig, verifySessionToken } from '@/lib/backoffice-auth';

// Backoffice (komissiya/auditor paneli) va uning API'lari login sessiyasi bilan himoyalanadi.
// Parol sozlanmagan bo'lsa — kirish yopiq (503).
export const config = {
  matcher: ['/backoffice/:path*', '/api/v1/backoffice/:path*'],
};

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/backoffice/login') {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  const boConfig = getBackofficeConfig();
  if (!boConfig) {
    return isApi
      ? NextResponse.json({ error: 'Backoffice paroli sozlanmagan' }, { status: 503 })
      : new NextResponse('Backoffice paroli sozlanmagan (BACKOFFICE_PASSWORD).', { status: 503 });
  }

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, boConfig)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: 'Avtorizatsiya talab qilinadi' }, { status: 401 });
  }
  const loginUrl = new URL('/backoffice/login', request.url);
  loginUrl.searchParams.set('next', pathname + search);
  return NextResponse.redirect(loginUrl);
}

import { NextResponse } from 'next/server';
import { getBackofficeClinics } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'all';
    const district = searchParams.get('district') || 'all';
    const level = searchParams.get('level') || 'all';
    const status = searchParams.get('status') || 'all';
    const search = searchParams.get('search') || '';

    const clinics = getBackofficeClinics({ region, district, level, status, search });
    return NextResponse.json(clinics);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

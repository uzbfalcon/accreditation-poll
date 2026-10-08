import { NextResponse } from 'next/server';
import { getClinicPassport } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const data = getClinicPassport(params.sessionId);
    if (!data) {
      return NextResponse.json({ error: 'Klinika topilmadi' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

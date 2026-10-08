import { NextResponse } from 'next/server';
import { getChecklist } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const data = getChecklist(params.sessionId);
    if (!data) {
      return NextResponse.json({ error: 'Sessiya topilmadi' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

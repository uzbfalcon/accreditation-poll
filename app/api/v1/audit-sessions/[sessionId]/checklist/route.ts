import { NextResponse } from 'next/server';
import { denySessionAccess } from '@/lib/session-access';
import { getChecklist } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const denied = denySessionAccess(request, params.sessionId);
    if (denied) return denied;

    const data = getChecklist(params.sessionId);
    if (!data) {
      return NextResponse.json({ error: 'Sessiya topilmadi' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

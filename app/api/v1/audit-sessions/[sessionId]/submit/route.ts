import { NextResponse } from 'next/server';
import { denySessionAccess } from '@/lib/session-access';
import { submitSession, FlowError, AlreadySubmittedError } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const denied = denySessionAccess(request, params.sessionId);
    if (denied) return denied;

    const result = submitSession(params.sessionId);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AlreadySubmittedError) {
      return NextResponse.json(
        { error: error.message, code: 'ALREADY_SUBMITTED', submitted_at: error.submittedAt },
        { status: 409 }
      );
    }
    const status = error instanceof FlowError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

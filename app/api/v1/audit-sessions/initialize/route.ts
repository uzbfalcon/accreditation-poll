import { NextResponse } from 'next/server';
import { initializeSession, FlowError, AlreadySubmittedError, InputError } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = initializeSession(body);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error instanceof AlreadySubmittedError) {
      return NextResponse.json(
        { error: error.message, code: 'ALREADY_SUBMITTED', submitted_at: error.submittedAt },
        { status: 409 }
      );
    }
    const status = error instanceof InputError ? 400 : error instanceof FlowError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

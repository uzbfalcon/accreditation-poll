import { NextResponse } from 'next/server';
import { enterFinalStage, FlowError } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const result = enterFinalStage(params.sessionId);
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof FlowError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

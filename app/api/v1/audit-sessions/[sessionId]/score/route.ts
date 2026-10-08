import { NextResponse } from 'next/server';
import { calculateSessionScore } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const score = calculateSessionScore(params.sessionId);
    return NextResponse.json(score);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

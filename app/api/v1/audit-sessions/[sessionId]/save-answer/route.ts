import { NextResponse } from 'next/server';
import { saveAnswer, FlowError } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const body = await request.json();
    const { criterion_id, answer_value, note } = body;

    if (!criterion_id || !answer_value) {
      return NextResponse.json(
        { error: 'criterion_id va answer_value majburiy' },
        { status: 400 }
      );
    }

    const result = saveAnswer(params.sessionId, Number(criterion_id), answer_value, note || '');
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error instanceof FlowError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

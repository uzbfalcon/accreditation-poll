import { NextResponse } from 'next/server';
import { advanceSection, FlowError } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Joriy bo'limni yakunlab keyingisiga o'tish. Body: { from_section: number }
export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const body = await request.json().catch(() => ({}));
    const fromSection = Number(body.from_section);
    if (!Number.isInteger(fromSection) || fromSection < 1) {
      return NextResponse.json({ error: "from_section noto'g'ri" }, { status: 400 });
    }
    return NextResponse.json(advanceSection(params.sessionId, fromSection));
  } catch (error: any) {
    const status = error instanceof FlowError ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  }
}

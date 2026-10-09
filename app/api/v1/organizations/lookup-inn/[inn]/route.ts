import { NextResponse } from 'next/server';
import { lookupInnOnline } from '@/lib/inn-scraper';
import { getSubmittedSessionByInn } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { inn: string } }
) {
  try {
    const inn = params.inn.trim();
    if (!/^\d{9}$/.test(inn)) {
      return NextResponse.json(
        { error: "INN 9 xonali raqam bo'lishi kerak", found: false },
        { status: 400 }
      );
    }

    const data = await lookupInnOnline(inn);
    // Ariza allaqachon topshirilgan bo'lsa — portal boshlash tugmasini bloklaydi
    const submitted = getSubmittedSessionByInn(inn);
    return NextResponse.json({ ...data, already_submitted: Boolean(submitted), submitted_at: submitted?.submitted_at ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, found: false }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { lookupInnOnline } from '@/lib/inn-scraper';
import { getSubmittedSessionByInn } from '@/lib/db';
import { matchDistrict, matchRegion } from '@/lib/regions';

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

    const raw = await lookupInnOnline(inn);
    // Manbadagi erkin matn («Samarqand sh.») passport ro'yxatidagi nomga moslanadi; moslik bo'lmasa — bo'sh
    const region = matchRegion(raw.region);
    const data = { ...raw, region, district: region ? matchDistrict(region, raw.district) : '' };
    // Ariza allaqachon topshirilgan bo'lsa — portal boshlash tugmasini bloklaydi
    const submitted = getSubmittedSessionByInn(inn);
    return NextResponse.json({ ...data, already_submitted: Boolean(submitted), submitted_at: submitted?.submitted_at ?? null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message, found: false }, { status: 500 });
  }
}

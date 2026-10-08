import { NextResponse } from 'next/server';
import { getExportCsv } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const csvData = getExportCsv();
    return new NextResponse('\uFEFF' + csvData, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="clamo_accreditation_clinics.csv"',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

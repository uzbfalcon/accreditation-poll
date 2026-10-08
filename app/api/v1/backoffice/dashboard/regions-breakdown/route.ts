import { NextResponse } from 'next/server';
import { getBackofficeRegions } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sortBy = searchParams.get('sort_by') || 'score_desc';
    const regions = getBackofficeRegions(sortBy);
    return NextResponse.json(regions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

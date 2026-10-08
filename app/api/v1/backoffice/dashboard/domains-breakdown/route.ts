import { NextResponse } from 'next/server';
import { getBackofficeDomains } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const domains = getBackofficeDomains();
    return NextResponse.json(domains);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

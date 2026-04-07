import { NextRequest, NextResponse } from 'next/server';
import { getAccessTokenForOrg, listUserSheets } from '@/lib/google-oauth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/** GET /api/google/sheets/list?org=<uuid>&q=<search> */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org');
  const q = req.nextUrl.searchParams.get('q') || '';
  if (!orgId) return NextResponse.json({ error: 'Missing org' }, { status: 400, headers: CORS });
  try {
    const token = await getAccessTokenForOrg(orgId);
    const files = await listUserSheets(token, q);
    return NextResponse.json({ files }, { headers: CORS });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'List failed' }, { status: 500, headers: CORS });
  }
}

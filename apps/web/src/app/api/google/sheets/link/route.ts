import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccessTokenForOrg, getSheetMeta, extractSheetId } from '@/lib/google-oauth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/** POST /api/google/sheets/link  Body: { organizationId, sheetIdOrUrl } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = body.organizationId as string;
    const input = body.sheetIdOrUrl as string;
    if (!orgId || !input) return NextResponse.json({ error: 'Missing params' }, { status: 400, headers: CORS });

    const sheetId = extractSheetId(input);
    if (!sheetId) return NextResponse.json({ error: 'Invalid Sheet ID or URL' }, { status: 400, headers: CORS });

    const token = await getAccessTokenForOrg(orgId);
    const meta = await getSheetMeta(token, sheetId);
    if (!meta) return NextResponse.json({ error: 'Sheet not found or not accessible by your Google account' }, { status: 404, headers: CORS });

    const sb = createAdminClient() as any;
    await sb.from('sheet_links').upsert(
      {
        organization_id: orgId,
        sheet_id: meta.id,
        sheet_name: meta.name,
        sheet_url: `https://docs.google.com/spreadsheets/d/${meta.id}/edit`,
        last_pushed_at: null,
        last_row_count: 0,
      },
      { onConflict: 'organization_id' },
    );
    return NextResponse.json({ ok: true, sheet: { id: meta.id, name: meta.name, url: `https://docs.google.com/spreadsheets/d/${meta.id}/edit` } }, { headers: CORS });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Link failed' }, { status: 500, headers: CORS });
  }
}

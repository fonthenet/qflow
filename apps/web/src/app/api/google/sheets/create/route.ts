import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAccessTokenForOrg, createSheet } from '@/lib/google-oauth';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/** POST /api/google/sheets/create  Body: { organizationId, title? } */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orgId = body.organizationId as string;
    const title = (body.title as string) || 'Qflo Customers';
    if (!orgId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400, headers: CORS });

    const token = await getAccessTokenForOrg(orgId);
    const sheetId = await createSheet(token, title);

    const sb = createAdminClient() as any;
    await sb.from('sheet_links').upsert(
      {
        organization_id: orgId,
        sheet_id: sheetId,
        sheet_name: title,
        sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
        last_pushed_at: null,
        last_row_count: 0,
      },
      { onConflict: 'organization_id' },
    );
    return NextResponse.json({ ok: true, sheet: { id: sheetId, name: title, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` } }, { headers: CORS });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Create failed' }, { status: 500, headers: CORS });
  }
}

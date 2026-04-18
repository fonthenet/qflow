import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** GET /api/google/sheets/status?org=<uuid> */
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org');
  if (!orgId) return NextResponse.json({ error: 'Missing org' }, { status: 400, headers: CORS });
  const sb = createAdminClient() as any;
  const { data: conn } = await sb
    .from('google_connections')
    .select('google_email, connected_at')
    .eq('organization_id', orgId)
    .maybeSingle();
  const { data: link } = await sb
    .from('sheet_links')
    .select('sheet_id, sheet_name, last_pushed_at, last_row_count, auto_sync, sheet_url, last_error, last_error_at, last_success_at')
    .eq('organization_id', orgId)
    .maybeSingle();
  return NextResponse.json(
    {
      connected: !!conn,
      email: conn?.google_email ?? null,
      sheet: link
        ? {
            id: link.sheet_id,
            name: link.sheet_name,
            url: link.sheet_url || `https://docs.google.com/spreadsheets/d/${link.sheet_id}/edit`,
            lastPushedAt: link.last_pushed_at,
            rowCount: link.last_row_count,
            autoSync: link.auto_sync !== false,
            lastError: link.last_error ?? null,
            lastErrorAt: link.last_error_at ?? null,
            lastSuccessAt: link.last_success_at ?? null,
          }
        : null,
    },
    { headers: CORS },
  );
}

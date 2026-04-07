import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** POST /api/google/sheets/disconnect  Body: { organizationId } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const orgId = body.organizationId as string;
  if (!orgId) return NextResponse.json({ error: 'Missing organizationId' }, { status: 400, headers: CORS });
  const sb = createAdminClient() as any;
  await sb.from('sheet_links').delete().eq('organization_id', orgId);
  await sb.from('google_connections').delete().eq('organization_id', orgId);
  return NextResponse.json({ ok: true }, { headers: CORS });
}

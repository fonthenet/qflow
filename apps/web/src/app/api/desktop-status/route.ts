import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

// POST /api/desktop-status — desktop app registers/pings
export async function POST(req: NextRequest) {
  const supabase = createAdminClient();
  try {
    const body = await req.json();
    const {
      machineId,
      machineName,
      officeId,
      organizationId,
      appVersion,
      osInfo,
      pendingSyncs,
      lastSyncAt,
    } = body;

    if (!machineId || !officeId || !organizationId) {
      return NextResponse.json(
        { error: 'machineId, officeId, and organizationId required' },
        { status: 400 },
      );
    }

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';

    const { error } = await supabase
      .from('desktop_connections')
      .upsert(
        {
          machine_id: machineId,
          machine_name: machineName || 'Unknown PC',
          office_id: officeId,
          organization_id: organizationId,
          app_version: appVersion || null,
          os_info: osInfo || null,
          is_online: true,
          last_ping: new Date().toISOString(),
          pending_syncs: pendingSyncs ?? 0,
          last_sync_at: lastSyncAt || null,
          ip_address: ip,
        },
        { onConflict: 'machine_id' },
      );

    if (error) {
      console.error('Desktop status upsert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

// GET /api/desktop-status?organizationId=xxx — get all desktop connections for an org
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('organizationId');
  if (!orgId) {
    return NextResponse.json({ error: 'organizationId required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('desktop_connections')
    .select('*')
    .eq('organization_id', orgId)
    .order('last_ping', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections: data });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;
function getSb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// POST /api/desktop-status — desktop app registers/pings
export async function POST(req: NextRequest) {
  const supabase = getSb();
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
      rustdeskId,
      rustdeskPassword,
      supportActive,
    } = body;

    if (!machineId) {
      return NextResponse.json(
        { error: 'machineId required' },
        { status: 400 },
      );
    }

    const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown';

    const record: Record<string, any> = {
      machine_id: machineId,
      machine_name: machineName || 'Unknown PC',
      is_online: true,
      last_ping: new Date().toISOString(),
      ip_address: ip,
    };

    if (officeId) record.office_id = officeId;
    if (organizationId) record.organization_id = organizationId;
    if (appVersion) record.app_version = appVersion;
    if (osInfo) record.os_info = osInfo;
    if (pendingSyncs !== undefined) record.pending_syncs = pendingSyncs;
    if (lastSyncAt) record.last_sync_at = lastSyncAt;

    // Remote support session
    if (supportActive === true) {
      record.rustdesk_id = rustdeskId || null;
      record.rustdesk_password = rustdeskPassword || null;
      record.support_started_at = new Date().toISOString();
    } else if (supportActive === false) {
      record.rustdesk_id = null;
      record.rustdesk_password = null;
      record.support_started_at = null;
    }

    const { error } = await supabase
      .from('desktop_connections')
      .upsert(record, { onConflict: 'machine_id' });

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
  const supabase = getSb();
  const orgId = req.nextUrl.searchParams.get('organizationId');
  if (!orgId) {
    return NextResponse.json({ error: 'organizationId required' }, { status: 400 });
  }

  // Exclude rustdesk_password from response — it should never leave the server
  const { data, error } = await supabase
    .from('desktop_connections')
    .select('id, machine_id, machine_name, is_online, last_ping, ip_address, office_id, organization_id, app_version, os_info, pending_syncs, last_sync_at, rustdesk_id, support_started_at, created_at')
    .eq('organization_id', orgId)
    .order('last_ping', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ connections: data });
}

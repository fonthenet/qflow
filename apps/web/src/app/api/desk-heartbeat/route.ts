import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;
function getSb() {
  if (!_sb) _sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return _sb;
}

// POST /api/desk-heartbeat — operator desk pings every 30s
export async function POST(req: NextRequest) {
  const supabase = getSb();
  try {
    const { deskId, staffId } = await req.json();

    if (!deskId || !staffId) {
      return NextResponse.json({ error: 'deskId and staffId required' }, { status: 400 });
    }

    const { error } = await supabase.rpc('desk_heartbeat' as any, {
      p_desk_id: deskId,
      p_staff_id: staffId,
    });

    if (error) {
      console.error('Heartbeat error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Internal error' }, { status: 500 });
  }
}

// GET /api/desk-heartbeat?officeId=xxx — get online/offline status of all desks
export async function GET(req: NextRequest) {
  const supabase = getSb();
  const officeId = req.nextUrl.searchParams.get('officeId');
  if (!officeId) {
    return NextResponse.json({ error: 'officeId required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('desk_heartbeats')
    .select('desk_id, staff_id, last_ping, is_online')
    .in('desk_id', (
      await supabase.from('desks').select('id').eq('office_id', officeId)
    ).data?.map((d: any) => d.id) ?? []);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ desks: data });
}

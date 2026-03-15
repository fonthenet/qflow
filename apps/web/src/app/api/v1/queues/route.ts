import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// GET /api/v1/queues — get current queue status for all offices
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ('error' in auth) return auth.error;

  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const officeId = searchParams.get('office_id');

  // Get offices for this org
  let officeQuery = supabase
    .from('offices')
    .select('id, name, address, is_active')
    .eq('organization_id', auth.ctx.organizationId);

  if (officeId) officeQuery = officeQuery.eq('id', officeId);

  const { data: offices, error: officeError } = await officeQuery;
  if (officeError) {
    return NextResponse.json({ error: officeError.message }, { status: 500 });
  }

  const queues = await Promise.all(
    (offices || []).map(async (office) => {
      const { count: waitingCount } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', office.id)
        .in('status', ['waiting', 'issued']);

      const { count: servingCount } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', office.id)
        .eq('status', 'serving');

      const { data: nowServing } = await supabase
        .from('tickets')
        .select('ticket_number, desk_id')
        .eq('office_id', office.id)
        .in('status', ['called', 'serving'])
        .order('called_at', { ascending: false })
        .limit(5);

      return {
        office,
        waiting: waitingCount || 0,
        serving: servingCount || 0,
        now_serving: nowServing || [],
      };
    })
  );

  return NextResponse.json({ data: queues });
}

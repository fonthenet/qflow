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

// GET /api/v1/tickets — list tickets with filters
export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ('error' in auth) return auth.error;

  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const officeId = searchParams.get('office_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase
    .from('tickets')
    .select('*, department:departments(name, code), service:services(name, code)', { count: 'exact' })
    .in('office_id', (
      await supabase
        .from('offices')
        .select('id')
        .eq('organization_id', auth.ctx.organizationId)
    ).data?.map(o => o.id) || [])
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (officeId) query = query.eq('office_id', officeId);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    data,
    pagination: { total: count, limit, offset },
  });
}

// POST /api/v1/tickets — create a new ticket
export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ('error' in auth) return auth.error;

  const body = await request.json();
  const { office_id, department_id, service_id, customer_data } = body;

  if (!office_id || !department_id || !service_id) {
    return NextResponse.json(
      { error: 'office_id, department_id, and service_id are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Verify office belongs to this organization
  const { data: office } = await supabase
    .from('offices')
    .select('id, organization_id')
    .eq('id', office_id)
    .eq('organization_id', auth.ctx.organizationId)
    .single();

  if (!office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  // Generate ticket number
  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: department_id }
  );

  if (seqError || !seqData?.length) {
    return NextResponse.json({ error: 'Failed to generate ticket number' }, { status: 500 });
  }

  const { seq, ticket_num } = seqData[0];
  const crypto = require('crypto');
  const qrToken = crypto.randomBytes(8).toString('hex');

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      office_id,
      department_id,
      service_id,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'waiting',
      customer_data: customer_data || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: ticket }, { status: 201 });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();

  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select(
      `
      id,
      qr_token,
      office_id,
      department_id,
      service_id,
      ticket_number,
      status,
      desk_id,
      called_at,
      serving_started_at,
      called_by_staff_id,
      estimated_wait_minutes,
      recall_count,
      customer_data
    `
    )
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  const [
    officeResult,
    departmentResult,
    serviceResult,
    deskResult,
  ] = await Promise.all([
    supabase
      .from('offices')
      .select('name, organization:organizations(name)')
      .eq('id', ticket.office_id)
      .single(),
    supabase
      .from('departments')
      .select('name, code')
      .eq('id', ticket.department_id)
      .single(),
    supabase
      .from('services')
      .select('name')
      .eq('id', ticket.service_id)
      .single(),
    ticket.desk_id
      ? supabase
          .from('desks')
          .select('name, display_name')
          .eq('id', ticket.desk_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const responsePayload = {
    ...ticket,
    office: officeResult.data ?? null,
    department: departmentResult.data ?? null,
    service: serviceResult.data ?? null,
    desk: deskResult.data ?? null,
  };

  return NextResponse.json(responsePayload);
}

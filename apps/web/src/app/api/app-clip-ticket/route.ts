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
      customer_data,
      office:offices(name, organization:organizations(name)),
      department:departments(name, code),
      service:services(name),
      desk:desks(name, display_name)
    `
    )
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  return NextResponse.json(ticket);
}

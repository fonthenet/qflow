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
      completed_at,
      called_by_staff_id,
      estimated_wait_minutes,
      recall_count,
      customer_data,
      is_remote,
      created_at
    `
    )
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  // Calculate queue position for waiting tickets
  // Position is service-scoped: only count tickets with the same service
  // (different services go to different desks, so they're separate queues)
  // Within a service: higher priority first, then FIFO
  let position: number | null = null;
  if (ticket.status === 'waiting') {
    const ticketPriority = ticket.priority ?? 0;

    // Count tickets with strictly higher priority in same service queue
    const { count: higherPriority } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', ticket.service_id)
      .eq('office_id', ticket.office_id)
      .eq('status', 'waiting')
      .gt('priority', ticketPriority);

    // Count tickets with same priority but created earlier (FIFO within same priority)
    const { count: samePriorityEarlier } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', ticket.service_id)
      .eq('office_id', ticket.office_id)
      .eq('status', 'waiting')
      .eq('priority', ticketPriority)
      .lt('created_at', ticket.created_at);

    position = 1 + (higherPriority ?? 0) + (samePriorityEarlier ?? 0);
  }

  const [
    officeResult,
    departmentResult,
    serviceResult,
    deskResult,
    nowServingResult,
  ] = await Promise.all([
    supabase
      .from('offices')
      .select('id, name, organization_id')
      .eq('id', ticket.office_id)
      .single(),
    supabase
      .from('departments')
      .select('id, name, code')
      .eq('id', ticket.department_id)
      .single(),
    ticket.service_id
      ? supabase
          .from('services')
          .select('id, name, code')
          .eq('id', ticket.service_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    ticket.desk_id
      ? supabase
          .from('desks')
          .select('id, name, display_name')
          .eq('id', ticket.desk_id)
          .single()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('tickets')
      .select('ticket_number')
      .eq('service_id', ticket.service_id)
      .eq('office_id', ticket.office_id)
      .in('status', ['serving', 'called'])
      .order('called_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const responsePayload = {
    ...ticket,
    position,
    office: officeResult.data ?? null,
    department: departmentResult.data ?? null,
    service: serviceResult.data ?? null,
    desk: deskResult.data ?? null,
    now_serving: nowServingResult.data?.ticket_number ?? null,
  };

  return NextResponse.json(responsePayload);
}

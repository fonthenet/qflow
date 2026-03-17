import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

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

export async function POST(request: NextRequest) {
  let body: {
    officeId?: string;
    departmentId?: string;
    serviceId?: string;
    customerName?: string;
    customerPhone?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, customerName, customerPhone } = body;

  if (!officeId || !departmentId || !serviceId) {
    return NextResponse.json(
      { error: 'officeId, departmentId, and serviceId are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Generate ticket number
  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: departmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return NextResponse.json(
      { error: seqError?.message ?? 'Failed to generate ticket number' },
      { status: 500 }
    );
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // Estimate wait time
  let estimatedWait: number | null = null;
  try {
    const { data: waitData } = await supabase.rpc('estimate_wait_time', {
      p_department_id: departmentId,
      p_service_id: serviceId,
    });
    estimatedWait = waitData ?? null;
  } catch {
    // Non-critical
  }

  // Build customer data
  const customerData: Record<string, string> = {};
  if (customerName?.trim()) customerData.name = customerName.trim();
  if (customerPhone?.trim()) customerData.phone = customerPhone.trim();

  // Create ticket
  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'waiting',
      checked_in_at: new Date().toISOString(),
      customer_data: Object.keys(customerData).length > 0 ? customerData : null,
      estimated_wait_minutes: estimatedWait,
      is_remote: true,
      priority: 0,
    })
    .select('id, qr_token, ticket_number, status, estimated_wait_minutes')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log ticket event
  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'joined',
      to_status: 'waiting',
      metadata: { source: 'mobile_remote_join' },
    });
  }

  return NextResponse.json({
    ticket: {
      id: ticket.id,
      qr_token: ticket.qr_token,
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      estimated_wait_minutes: ticket.estimated_wait_minutes,
    },
  });
}

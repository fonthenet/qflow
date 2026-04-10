import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { getQueuePosition } from '@/lib/queue-position';

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
    priorityCategoryId?: string | null;
    priority?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, priorityCategoryId, priority } = body;

  if (!officeId || !departmentId || !serviceId) {
    return NextResponse.json(
      { error: 'officeId, departmentId, and serviceId are required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // Check if office requires ticket approval + kiosk enabled
  const { data: officeRow } = await supabase
    .from('offices')
    .select('settings, organization:organizations(settings)')
    .eq('id', officeId)
    .single();
  const orgSettings = ((officeRow as any)?.organization?.settings ?? {}) as Record<string, any>;
  if (orgSettings.kiosk_enabled === false) {
    return NextResponse.json({ error: 'Kiosk is disabled for this business' }, { status: 403 });
  }
  if (orgSettings.default_check_in_mode === 'manual') {
    return NextResponse.json({ error: 'Self-service ticket creation is disabled. Please check in at the front desk.' }, { status: 403 });
  }
  const requireApproval = Boolean(
    (officeRow?.settings as any)?.require_ticket_approval ??
      orgSettings.require_ticket_approval
  );
  const initialStatus = requireApproval ? 'pending_approval' : 'waiting';

  // Generate ticket number via RPC
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

  // Estimate wait time (non-critical)
  let estimatedWait: number | null = null;
  try {
    const { data: waitData } = await supabase.rpc('estimate_wait_time', {
      p_department_id: departmentId,
      p_service_id: serviceId,
    });
    estimatedWait = waitData ?? null;
  } catch {
    // Non-critical — default to null
  }

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
      status: initialStatus,
      checked_in_at: new Date().toISOString(),
      estimated_wait_minutes: estimatedWait,
      priority: priority ?? 0,
      priority_category_id: priorityCategoryId ?? null,
      is_remote: false,
      source: 'kiosk',
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
      to_status: initialStatus,
      metadata: { source: 'native_kiosk', pending_approval: requireApproval },
    });
  }

  // Get queue position for the newly created ticket
  const queueInfo = await getQueuePosition(ticket.id);

  return NextResponse.json({
    ticket: {
      id: ticket.id,
      qr_token: ticket.qr_token,
      ticket_number: ticket.ticket_number,
      status: ticket.status,
      estimated_wait_minutes: queueInfo.estimated_wait_minutes ?? ticket.estimated_wait_minutes,
      position: queueInfo.position,
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getQueuePosition } from '@/lib/queue-position';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidUUID, sanitizeString } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, publicLimiter);
  if (blocked) return blocked;

  let body: {
    officeId?: string;
    departmentId?: string;
    serviceId?: string;
    priorityCategoryId?: string | null;
    priority?: number;
    customerName?: string;
    customerPhone?: string;
    customerData?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, priorityCategoryId, priority, customerName, customerPhone, customerData } = body;

  if (!officeId || !departmentId || !serviceId) {
    return NextResponse.json(
      { error: 'officeId, departmentId, and serviceId are required' },
      { status: 400 }
    );
  }

  // ── Input validation ──────────────────────────────────────────
  if (!isValidUUID(officeId) || !isValidUUID(departmentId) || !isValidUUID(serviceId)) {
    return NextResponse.json({ error: 'officeId, departmentId, and serviceId must be valid UUIDs' }, { status: 400 });
  }
  if (priorityCategoryId && !isValidUUID(priorityCategoryId)) {
    return NextResponse.json({ error: 'priorityCategoryId must be a valid UUID' }, { status: 400 });
  }
  const cleanCustomerName = customerName ? sanitizeString(customerName, 200) : undefined;
  const cleanCustomerPhone = customerPhone ? sanitizeString(customerPhone, 30) : undefined;

  // Build customer_data from dynamic intake fields + legacy name/phone
  const cleanCustomerData: Record<string, string> = {};
  if (customerData && typeof customerData === 'object') {
    for (const [key, rawValue] of Object.entries(customerData)) {
      if (typeof rawValue !== 'string') continue;
      if (!/^[a-zA-Z0-9_]{1,60}$/.test(key)) continue;
      const value = sanitizeString(rawValue, 500);
      if (value) cleanCustomerData[key] = value;
    }
  }
  if (cleanCustomerName) cleanCustomerData.name = cleanCustomerName;
  if (cleanCustomerPhone) cleanCustomerData.phone = cleanCustomerPhone;

  const supabase = createAdminClient();

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
      customer_data: Object.keys(cleanCustomerData).length > 0 ? cleanCustomerData : null,
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

import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getQueuePosition } from '@/lib/queue-position';
import { createAdminClient } from '@/lib/supabase/admin';
import { isValidUUID, sanitizeString } from '@/lib/validation';

export async function POST(request: NextRequest) {
  let body: {
    officeId?: string;
    departmentId?: string;
    serviceId?: string;
    customerName?: string;
    customerPhone?: string;
    reason?: string;
    customData?: Record<string, string>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, customerName, customerPhone, reason, customData } = body;

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
  const cleanCustomerName = customerName ? sanitizeString(customerName, 200) : undefined;
  const cleanCustomerPhone = customerPhone ? sanitizeString(customerPhone, 30) : undefined;
  const cleanReason = reason ? sanitizeString(reason, 500) : undefined;

  const supabase = createAdminClient();

  // Check if office requires ticket approval + virtual queue enabled
  const { data: officeRow } = await supabase
    .from('offices')
    .select('settings, organization:organizations(settings)')
    .eq('id', officeId)
    .single();
  const _vqOrgSettings = (((officeRow as any)?.organization?.settings) ?? {}) as Record<string, any>;
  if (_vqOrgSettings.virtual_queue_enabled === false) {
    return NextResponse.json({ error: 'Virtual queue is disabled for this business' }, { status: 403 });
  }
  const requireApproval = Boolean(
    (officeRow?.settings as any)?.require_ticket_approval ??
      _vqOrgSettings.require_ticket_approval
  );
  const initialStatus = requireApproval ? 'pending_approval' : 'waiting';

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

  // Build customer data — merge dynamic intake fields (customData) + legacy
  // name/phone/reason for backward compatibility. Explicit legacy fields win
  // when both are sent.
  const customerData: Record<string, string> = {};
  if (customData && typeof customData === 'object') {
    for (const [key, rawValue] of Object.entries(customData)) {
      if (typeof rawValue !== 'string') continue;
      // Keep keys that look safe (presets + generated custom_<...> keys)
      if (!/^[a-zA-Z0-9_]{1,60}$/.test(key)) continue;
      const value = sanitizeString(rawValue, 500);
      if (value) customerData[key] = value;
    }
  }
  if (cleanCustomerName) customerData.name = cleanCustomerName;
  if (cleanCustomerPhone) customerData.phone = cleanCustomerPhone;
  if (cleanReason) customerData.reason = cleanReason;

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
      customer_data: Object.keys(customerData).length > 0 ? customerData : null,
      estimated_wait_minutes: estimatedWait,
      is_remote: true,
      source: 'mobile_app',
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
      to_status: initialStatus,
      metadata: { source: 'mobile_remote_join', pending_approval: requireApproval },
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

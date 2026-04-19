import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { getQueuePosition } from '@/lib/queue-position';
import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkVisitAllowed } from '@/lib/visit-guard';
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
    source?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { officeId, departmentId, serviceId, priorityCategoryId, priority, customerName, customerPhone, customerData, source: bodySource } = body;

  // Optional source override — lets the mobile app tag its tickets as
  // 'mobile_app' so they don't all show up as 'Kiosque' on the Station.
  // Whitelist to known channels; anything else falls back to 'kiosk'.
  const ALLOWED_SOURCES = new Set(['kiosk', 'mobile_app', 'qr_code', 'portal', 'web']);
  const resolvedSource =
    typeof bodySource === 'string' && ALLOWED_SOURCES.has(bodySource) ? bodySource : 'kiosk';
  const isRemote = resolvedSource === 'mobile_app' || resolvedSource === 'portal' || resolvedSource === 'web';

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
    .select('organization_id, timezone, settings, organization:organizations(settings, timezone)')
    .eq('id', officeId)
    .single();
  const orgSettings = ((officeRow as any)?.organization?.settings ?? {}) as Record<string, any>;
  if (orgSettings.kiosk_enabled === false) {
    return NextResponse.json({ error: 'Kiosk is disabled for this business' }, { status: 403 });
  }
  if (orgSettings.default_check_in_mode === 'manual') {
    return NextResponse.json({ error: 'Self-service ticket creation is disabled. Please check in at the front desk.' }, { status: 403 });
  }

  // Centralized visit gate — same rules as /api/join-queue, createPublicTicket.
  // Rejects tickets when the business is always_closed or outside operating
  // hours. Native kiosk running at the front desk is *not* treated as in-house
  // here — the hardware is self-service; staff use the Station app for walk-in
  // rescue.
  const visitGuard = await checkVisitAllowed({ officeId });
  if (!visitGuard.ok) {
    return NextResponse.json(
      { error: visitGuard.message, reason: visitGuard.reason },
      { status: visitGuard.status ?? 403 },
    );
  }

  let requireApproval = Boolean(
    (officeRow?.settings as any)?.require_ticket_approval ??
      orgSettings.require_ticket_approval
  );
  // Per-customer override: trusted customers skip the approval gate.
  if (requireApproval && cleanCustomerPhone) {
    const orgId = (officeRow as any)?.organization_id as string | undefined;
    const tz = ((officeRow as any)?.organization?.timezone as string | undefined)
      ?? ((officeRow as any)?.timezone as string | undefined)
      ?? null;
    if (orgId) {
      try {
        const { isCustomerAutoApprove } = await import('@/lib/customer-auto-approve');
        const trusted = await isCustomerAutoApprove(supabase, orgId, cleanCustomerPhone, tz);
        if (trusted) requireApproval = false;
      } catch { /* best-effort */ }
    }
  }
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
      is_remote: isRemote,
      source: resolvedSource,
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
      metadata: {
        source: resolvedSource === 'kiosk' ? 'native_kiosk' : resolvedSource,
        pending_approval: requireApproval,
      },
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

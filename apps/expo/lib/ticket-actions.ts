import { supabase } from './supabase';
import i18next from 'i18next';
import { API_BASE_URL } from '@/lib/config';
import { normalizePhone } from '@qflo/shared';

/** Fire-and-forget: trigger WhatsApp/Messenger notification via unified API */
export async function triggerNotification(ticketId: string, status: string, deskName?: string, notifyEvent?: string) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    fetch(`${API_BASE_URL}/api/ticket-transition`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ticketId, status, deskName, skipStatusUpdate: true, ...(notifyEvent ? { notifyEvent } : {}) }),
    }).catch(() => {});
  } catch { /* non-critical */ }
}

// ── Call Next Ticket (with overflow + round-robin) ──────────────
export async function callNextTicket(deskId: string, staffId: string) {
  // Try round-robin first (alternates between desk's services)
  const { data: rrData, error: rrError } = await supabase.rpc('call_next_ticket_round_robin', {
    p_desk_id: deskId,
    p_staff_id: staffId,
  });
  if (!rrError && rrData) {
    triggerNotification(rrData, 'called').catch(() => {});
    return rrData;
  }

  // Fallback: overflow — pull from any service in dept, then any in office
  const { data, error } = await supabase.rpc('call_next_ticket_with_overflow', {
    p_desk_id: deskId,
    p_staff_id: staffId,
  });
  if (error) throw new Error(error.message);
  if (data) triggerNotification(data, 'called').catch(() => {});
  return data;
}

// ── Safety: Requeue expired calls (called > 90s ago) ────────────
export async function requeueExpiredCalls(timeoutSeconds = 90) {
  const { data, error } = await supabase.rpc('requeue_expired_calls', {
    p_timeout_seconds: timeoutSeconds,
  });
  if (error) console.warn('requeue_expired_calls error:', error.message);
  return data ?? 0;
}

// ── Safety: Requeue tickets when desk goes offline ──────────────
export async function requeueDeskTickets(deskId: string) {
  const { data, error } = await supabase.rpc('requeue_desk_tickets', {
    p_desk_id: deskId,
  });
  if (error) console.warn('requeue_desk_tickets error:', error.message);
  return data ?? 0;
}

// ── Safety: Adjust booking priorities based on scheduled time ───
export async function adjustBookingPriorities() {
  try {
    const { data, error } = await supabase.rpc('adjust_booking_priorities');
    if (error) console.warn('adjust_booking_priorities error:', error.message);
    return data ?? 0;
  } catch {
    // Network unavailable — silently skip
    return 0;
  }
}

// ── Safety: Clean up stale tickets from previous days ───────────
export async function cleanupStaleTickets() {
  const { data, error } = await supabase.rpc('cleanup_stale_tickets');
  if (error) console.warn('cleanup_stale_tickets error:', error.message);
  return data ?? 0;
}

// ── Commercial-grade auto-resolve: cancel/complete stale tickets ──
// Called > 5min → requeue, Called > 15min → no-show, Waiting > 4h → cancel,
// Serving > 3h → auto-complete, Yesterday's tickets → force resolve
export async function autoResolveTickets() {
  const { data, error } = await supabase.rpc('auto_resolve_tickets');
  if (error) console.warn('auto_resolve_tickets error:', error.message);
  return data ?? {};
}

// ── Safety: Park tickets on inactive desks ──────────────────────
export async function parkInactiveDeskTickets(timeoutMinutes = 5) {
  const { data, error } = await supabase.rpc('park_inactive_desk_tickets', {
    p_timeout_minutes: timeoutMinutes,
  });
  if (error) console.warn('park_inactive_desk_tickets error:', error.message);
  return data ?? 0;
}

// ── Desk heartbeat: ping to show desk is active ─────────────────
export async function pingDeskHeartbeat(deskId: string) {
  await supabase
    .from('desks')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', deskId);
}

// ── Desk Status ──────────────────────────────────────────────────
export async function openDesk(deskId: string, staffId: string) {
  const { error } = await supabase
    .from('desks')
    .update({ status: 'open', current_staff_id: staffId })
    .eq('id', deskId);
  if (error) throw new Error(error.message);
}

export async function closeDeskStatus(deskId: string) {
  const { error } = await supabase
    .from('desks')
    .update({ status: 'closed', current_staff_id: null })
    .eq('id', deskId);
  if (error) throw new Error(error.message);
}

export async function setDeskOnBreak(deskId: string) {
  const { error } = await supabase
    .from('desks')
    .update({ status: 'on_break' })
    .eq('id', deskId);
  if (error) throw new Error(error.message);
}

export async function setDeskOpen(deskId: string) {
  const { error } = await supabase
    .from('desks')
    .update({ status: 'open' })
    .eq('id', deskId);
  if (error) throw new Error(error.message);
}

// ── In-House Booking (create ticket with proper ticket_number) ───
export async function createInHouseTicket(params: {
  officeId: string;
  departmentId: string;
  serviceId?: string;
  customerName?: string;
  customerPhone?: string;
  visitReason?: string;
  priority?: number;
  priorityCategoryId?: string | null;
}) {
  // 1) Generate ticket number via the DB RPC (atomic, handles daily reset)
  const { data: seqResult, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: params.departmentId },
  );
  if (seqError) throw new Error(`Ticket number generation failed: ${seqError.message}`);

  const seq = Array.isArray(seqResult) ? seqResult[0] : seqResult;
  if (!seq?.ticket_num) throw new Error('Failed to generate ticket number');

  const ticketNumber: string = seq.ticket_num;
  const dailySequence: number = seq.seq ?? 0;

  // 2) Generate a qr_token for tracking link
  const qrToken = generateHexToken(12);

  // 3) Build customer data
  const customerData: Record<string, string> = {};
  if (params.customerName?.trim()) customerData.name = params.customerName.trim();
  if (params.customerPhone?.trim()) customerData.phone = params.customerPhone.trim();
  if (params.visitReason?.trim()) customerData.reason = params.visitReason.trim();

  // 4) Insert the ticket with the generated number
  const { data, error } = await supabase
    .from('tickets')
    .insert({
      ticket_number: ticketNumber,
      daily_sequence: dailySequence,
      qr_token: qrToken,
      office_id: params.officeId,
      department_id: params.departmentId,
      service_id: params.serviceId || null,
      status: 'waiting',
      priority: params.priority ?? 0,
      priority_category_id: params.priorityCategoryId ?? null,
      customer_data: customerData,
      source: 'in_house',
      created_at: new Date().toISOString(),
    })
    .select('id, ticket_number, qr_token')
    .single();

  if (error) throw new Error(error.message);

  // Auto-create WhatsApp notification session if customer has a phone
  let whatsappStatus: { sent: boolean; error?: string } | undefined;
  if (data && customerData.phone) {
    try {
      const { data: officeRow } = await supabase
        .from('offices')
        .select('organization_id, timezone, settings')
        .eq('id', params.officeId)
        .single();
      const officeCC = (officeRow?.settings as Record<string, unknown> | null)?.country_code as string | undefined;
      const normalizedPhone = normalizePhone(customerData.phone, officeRow?.timezone, officeCC);
      if (normalizedPhone && officeRow?.organization_id) {
        await supabase.from('whatsapp_sessions').insert({
          organization_id: officeRow.organization_id,
          ticket_id: data.id,
          office_id: params.officeId,
          department_id: params.departmentId,
          service_id: params.serviceId || null,
          whatsapp_phone: normalizedPhone,
          channel: 'whatsapp',
          state: 'active',
          locale: (officeRow?.settings as any)?.default_locale || 'fr',
        });

        // Send "joined" notification via edge function and capture result
        try {
          // Fetch office name and position for the message
          const { data: officeInfo } = await supabase.from('offices').select('name').eq('id', params.officeId).single();
          const { count: posCount } = await supabase.from('tickets').select('id', { count: 'exact', head: true })
            .eq('office_id', params.officeId).eq('department_id', params.departmentId).eq('status', 'waiting').is('parked_at', null);
          const trackUrl = `${API_BASE_URL}/q/${data.qr_token}`;

          const edgeUrl = `${supabase.supabaseUrl}/functions/v1/notify-ticket`;
          const res = await fetch(edgeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ticketId: data.id,
              event: 'joined',
              phone: normalizedPhone,
              ticketNumber: data.ticket_number,
              officeName: officeInfo?.name ?? '',
              position: posCount ?? 1,
              trackUrl,
              locale: i18next.language?.substring(0, 2) || 'fr',
            }),
            signal: AbortSignal.timeout(10000),
          });
          const result = await res.json().catch(() => ({}));
          whatsappStatus = { sent: Boolean(result.sent), error: result.sent ? undefined : (result.reason ?? result.error ?? 'Send failed') };
        } catch (err: any) {
          whatsappStatus = { sent: false, error: err?.message ?? 'Send failed' };
        }
      } else {
        whatsappStatus = { sent: false, error: normalizedPhone ? undefined : 'Invalid phone number' };
      }
    } catch {}
  }

  return { ...data, whatsappStatus };
}

/** Generate a random hex token of given length */
function generateHexToken(length: number): string {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

// ── Fetch departments + services for an office ──────────────────
export async function fetchOfficeDepartments(officeId: string) {
  const { data, error } = await supabase
    .from('departments')
    .select('id, name, code')
    .eq('office_id', officeId)
    .order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchDepartmentServices(officeId: string) {
  const { data, error } = await supabase
    .from('services')
    .select('id, name, code, department_id, departments!inner(office_id)')
    .eq('departments.office_id', officeId)
    .order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── Fetch available desks for desk switching ────────────────────
export async function fetchAvailableDesks(officeId: string) {
  const { data, error } = await supabase
    .from('desks')
    .select('id, name, display_name, department_id, departments:department_id(id, name), current_staff_id, status')
    .eq('office_id', officeId)
    .eq('is_active', true)
    .order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function switchDesk(newDeskId: string, staffId: string, oldDeskId: string | null) {
  // Release old desk
  if (oldDeskId) {
    await supabase
      .from('desks')
      .update({ status: 'closed', current_staff_id: null })
      .eq('id', oldDeskId);
  }
  // Claim new desk
  const { data, error } = await supabase
    .from('desks')
    .update({ status: 'open', current_staff_id: staffId })
    .eq('id', newDeskId)
    .select('id, name, display_name, office_id, department_id, offices:office_id(id, name), departments:department_id(id, name)')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

// ── Call Specific Ticket ──────────────────────────────────────────
export async function callSpecificTicket(ticketId: string, deskId: string, staffId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  triggerNotification(ticketId, 'called').catch(() => {});
}

// ── Start Serving ─────────────────────────────────────────────────
export async function startServing(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'serving',
      serving_started_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  triggerNotification(ticketId, 'serving').catch(() => {});
}

// ── Mark Served ───────────────────────────────────────────────────
export async function markServed(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'served',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  triggerNotification(ticketId, 'served').catch(() => {});
  // Sync appointment via lifecycle API
  await syncTicketTerminal(ticketId, 'served');
}

// ── Mark No-Show ──────────────────────────────────────────────────
export async function markNoShow(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'no_show',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  triggerNotification(ticketId, 'no_show').catch(() => {});
  // Sync appointment via lifecycle API
  await syncTicketTerminal(ticketId, 'no_show');
}

// ── Cancel Ticket ─────────────────────────────────────────────────
// Cancel any non-terminal ticket. We guard against overwriting an already
// terminal status (served/no_show/cancelled/transferred) with a NOT IN filter,
// but otherwise we allow cancel from waiting/issued/called/serving/parked etc.
export async function cancelTicket(ticketId: string) {
  const { error, count } = await supabase
    .from('tickets')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    }, { count: 'exact' })
    .eq('id', ticketId)
    .not('status', 'in', '(served,no_show,cancelled,transferred)');
  if (error) throw new Error(error.message);
  // If RLS silently filtered the row out, count will be 0 — surface as error
  // so the caller can fall back to the service-role REST endpoint.
  if (count === 0) throw new Error('cancel_blocked_or_already_terminal');
  triggerNotification(ticketId, 'cancelled').catch(() => {});
  // Sync appointment via lifecycle API
  await syncTicketTerminal(ticketId, 'cancelled');
}

/** Fire-and-forget call to lifecycle API so appointment stays in sync */
async function syncTicketTerminal(ticketId: string, terminalStatus: string, newTicketId?: string) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const payload: Record<string, string> = { ticketId, terminalStatus };
    if (newTicketId) payload.newTicketId = newTicketId;
    fetch(`${API_BASE_URL}/api/lifecycle/on-ticket-terminal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch { /* non-critical */ }
}

// ── Recall (re-notify customer) ───────────────────────────────────
export async function recallTicket(ticketId: string) {
  const { data: ticket } = await supabase
    .from('tickets')
    .select('recall_count')
    .eq('id', ticketId)
    .single();

  const { error } = await supabase
    .from('tickets')
    .update({
      called_at: new Date().toISOString(),
      recall_count: (ticket?.recall_count ?? 0) + 1,
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  triggerNotification(ticketId, 'called', undefined, 'recall').catch(() => {});
}

// ── Reset to Queue (send back to waiting) ─────────────────────────
export async function resetToQueue(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      serving_started_at: null,
      parked_at: null,
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Park Ticket (put on hold) ─────────────────────────────────────
// Sets parked_at timestamp and moves to waiting. Preserves serving_started_at
// so that resumeParkedTicket can detect it was previously being served and
// chain called → serving automatically (mirroring Station's park/resume logic).
export async function parkTicket(ticketId: string) {
  // Read current serving_started_at before we overwrite status so we can
  // keep it on the parked row as a resume signal.
  const { data: current } = await supabase
    .from('tickets')
    .select('serving_started_at')
    .eq('id', ticketId)
    .single();

  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'waiting',
      desk_id: null,
      called_at: null,
      called_by_staff_id: null,
      // Intentionally KEEP serving_started_at so resumeParkedTicket knows to
      // chain called → serving on resume (Station parity).
      serving_started_at: current?.serving_started_at ?? null,
      parked_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Resume Parked Ticket (call to desk) ──────────────────────────
// Station parity: if the ticket had serving_started_at set when it was parked,
// it was previously being served. We MUST go through 'called' first (the
// transition validator forbids waiting → serving directly), then immediately
// chain to 'serving' to restore the serving state.
export async function resumeParkedTicket(
  ticketId: string,
  deskId: string,
  staffId: string,
) {
  // Check no other active ticket on this desk first
  const { data: active } = await supabase
    .from('tickets')
    .select('id')
    .eq('desk_id', deskId)
    .in('status', ['called', 'serving'])
    .limit(1);

  if (active && active.length > 0) {
    throw new Error('Desk already has an active ticket. Complete or park it first.');
  }

  // Read the parked ticket to check if it was previously serving
  const { data: parked } = await supabase
    .from('tickets')
    .select('serving_started_at')
    .eq('id', ticketId)
    .single();

  const wasServing = !!parked?.serving_started_at;
  const now = new Date().toISOString();

  // Step 1: transition waiting → called (always valid)
  const { error: callErr } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      desk_id: deskId,
      called_by_staff_id: staffId,
      called_at: now,
      parked_at: null,
    })
    .eq('id', ticketId);
  if (callErr) throw new Error(callErr.message);

  // Step 2: if ticket was previously serving, chain called → serving immediately
  if (wasServing) {
    const { error: serveErr } = await supabase
      .from('tickets')
      .update({
        status: 'serving',
        // Restore original serving_started_at so elapsed timer is accurate
        serving_started_at: parked!.serving_started_at,
      })
      .eq('id', ticketId);
    if (serveErr) throw new Error(serveErr.message);
    triggerNotification(ticketId, 'serving').catch(() => {});
  } else {
    triggerNotification(ticketId, 'called').catch(() => {});
  }
}

// ── Unpark Ticket (send back to queue) ───────────────────────────
export async function unparkToQueue(ticketId: string) {
  const { error } = await supabase
    .from('tickets')
    .update({
      status: 'waiting',
      parked_at: null,
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
}

// ── Transfer Ticket ───────────────────────────────────────────────
export async function transferTicket(
  ticketId: string,
  targetDepartmentId: string,
  targetServiceId: string,
) {
  // Get original ticket
  const { data: original, error: fetchErr } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !original) throw new Error('Ticket not found');

  // Generate new ticket number
  const { data: newNumber, error: rpcErr } = await supabase.rpc('generate_daily_ticket_number', {
    p_department_id: targetDepartmentId,
  });
  if (rpcErr) throw new Error(rpcErr.message);

  // Create transferred ticket — carry over appointment link and qr_token
  const { data: newTicket, error: insertErr } = await supabase.from('tickets').insert({
    office_id: original.office_id,
    department_id: targetDepartmentId,
    service_id: targetServiceId,
    ticket_number: newNumber,
    status: 'waiting',
    priority: original.priority,
    priority_category_id: original.priority_category_id,
    customer_data: original.customer_data,
    customer_id: original.customer_id,
    is_remote: original.is_remote,
    transferred_from_ticket_id: ticketId,
    appointment_id: original.appointment_id,
    qr_token: original.qr_token,
    checked_in_at: new Date().toISOString(),
  }).select('id, ticket_number').single();
  if (insertErr) throw new Error(insertErr.message);

  // Mark original as transferred (not 'served' — matches web behavior)
  const { error: updateErr } = await supabase.from('tickets').update({
    status: 'transferred',
    completed_at: new Date().toISOString(),
  }).eq('id', ticketId);
  if (updateErr) throw new Error(updateErr.message);

  // Transfer WhatsApp session to new ticket so customer keeps getting notifications
  await (supabase as any)
    .from('whatsapp_sessions')
    .update({ ticket_id: newTicket.id, department_id: targetDepartmentId, service_id: targetServiceId })
    .eq('ticket_id', ticketId)
    .eq('state', 'active')
    .then(() => {}).catch(() => {});

  // Sync appointment: re-link to new ticket via lifecycle API
  syncTicketTerminal(ticketId, 'transferred', newTicket.id).catch(() => {});

  return newTicket;
}

// ── CRUD: Staff ───────────────────────────────────────────────────
export async function createStaff(data: {
  email: string;
  password: string;
  full_name: string;
  role: string;
  organization_id: string;
  office_id?: string | null;
  department_id?: string | null;
}) {
  if (!data.password || data.password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  // Get current user ID for authorization
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { API_BASE_URL: BASE_URL } = require('./config');
  const res = await fetch(`${BASE_URL}/api/create-staff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: data.email,
      password: data.password,
      full_name: data.full_name,
      role: data.role,
      organization_id: data.organization_id,
      office_id: data.office_id || null,
      department_id: data.department_id || null,
      caller_user_id: user.id,
    }),
  });

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Failed to create staff');

  return result;
}

export async function updateStaff(staffId: string, data: {
  full_name?: string;
  role?: string;
  office_id?: string | null;
  department_id?: string | null;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('staff').update(data).eq('id', staffId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Desks ───────────────────────────────────────────────────
export async function createDesk(data: {
  name: string;
  office_id: string;
  department_id?: string | null;
  current_staff_id?: string | null;
}) {
  const { error } = await supabase.from('desks').insert({
    name: data.name,
    office_id: data.office_id,
    department_id: data.department_id || null,
    current_staff_id: data.current_staff_id || null,
    is_active: true,
    status: 'closed',
  });
  if (error) throw new Error(error.message);
}

export async function updateDesk(deskId: string, data: {
  name?: string;
  department_id?: string | null;
  current_staff_id?: string | null;
  is_active?: boolean;
  status?: string;
}) {
  const { error } = await supabase.from('desks').update(data).eq('id', deskId);
  if (error) throw new Error(error.message);
}

export async function deleteDesk(deskId: string) {
  const { error } = await supabase.from('desks').delete().eq('id', deskId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Offices ─────────────────────────────────────────────────
export async function createOffice(data: {
  name: string;
  organization_id: string;
  address?: string;
  timezone?: string;
}) {
  const { error } = await supabase.from('offices').insert({
    name: data.name,
    organization_id: data.organization_id,
    address: data.address || null,
    timezone: data.timezone || null,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updateOffice(officeId: string, data: {
  name?: string;
  address?: string | null;
  timezone?: string | null;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('offices').update(data).eq('id', officeId);
  if (error) throw new Error(error.message);
}

export async function deleteOffice(officeId: string) {
  const { error } = await supabase.from('offices').delete().eq('id', officeId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Departments ─────────────────────────────────────────────
export async function createDepartment(data: {
  name: string;
  code: string;
  office_id: string;
}) {
  const { error } = await supabase.from('departments').insert({
    name: data.name,
    code: data.code,
    office_id: data.office_id,
  });
  if (error) throw new Error(error.message);
}

export async function updateDepartment(deptId: string, data: { name?: string; code?: string }) {
  const { error } = await supabase.from('departments').update(data).eq('id', deptId);
  if (error) throw new Error(error.message);
}

export async function deleteDepartment(deptId: string) {
  const { error } = await supabase.from('departments').delete().eq('id', deptId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Services ────────────────────────────────────────────────
export async function createService(data: {
  name: string;
  code: string;
  department_id: string;
  office_id: string;
}) {
  const { error } = await supabase.from('services').insert({
    name: data.name,
    code: data.code,
    department_id: data.department_id,
    office_id: data.office_id,
  });
  if (error) throw new Error(error.message);
}

export async function updateService(serviceId: string, data: { name?: string; code?: string }) {
  const { error } = await supabase.from('services').update(data).eq('id', serviceId);
  if (error) throw new Error(error.message);
}

export async function deleteService(serviceId: string) {
  const { error } = await supabase.from('services').delete().eq('id', serviceId);
  if (error) throw new Error(error.message);
}

// ── CRUD: Priority Categories ─────────────────────────────────────
export async function createPriority(data: {
  name: string;
  organization_id: string;
  icon?: string;
  color?: string;
  weight?: number;
}) {
  const { error } = await supabase.from('priority_categories').insert({
    name: data.name,
    organization_id: data.organization_id,
    icon: data.icon || null,
    color: data.color || null,
    weight: data.weight ?? 1,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function updatePriority(priorityId: string, data: {
  name?: string;
  icon?: string | null;
  color?: string | null;
  weight?: number;
  is_active?: boolean;
}) {
  const { error } = await supabase.from('priority_categories').update(data).eq('id', priorityId);
  if (error) throw new Error(error.message);
}

export async function deletePriority(priorityId: string) {
  const { error } = await supabase.from('priority_categories').delete().eq('id', priorityId);
  if (error) throw new Error(error.message);
}

// ── Bookings / Appointments ───────────────────────────────────────
export async function fetchAppointments(officeIds: string[], status?: string) {
  let query = supabase
    .from('appointments')
    .select('*')
    .in('office_id', officeIds)
    .order('scheduled_at', { ascending: true });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function checkInAppointment(appointmentId: string, _officeId?: string, _departmentId?: string, _serviceId?: string) {
  // Route through the unified API so ticket creation, ban checks,
  // WhatsApp notifications, and session creation all happen server-side.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'check_in' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Check-in failed (HTTP ${res.status})`);
  }
  const result = await res.json();
  return result.ticket ?? { id: appointmentId };
}

export async function cancelAppointment(appointmentId: string) {
  // Route through lifecycle API so ticket sync + notifications happen
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'cancel' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Cancel failed (HTTP ${res.status})`);
  }
}

// ── Approve Appointment (pending → confirmed) ───────────────────
export async function approveAppointment(appointmentId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'approve' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Approve failed (HTTP ${res.status})`);
  }
}

// ── Decline Appointment (pending → cancelled) ───────────────────
export async function declineAppointment(appointmentId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'decline' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Decline failed (HTTP ${res.status})`);
  }
}

// ── No-Show Appointment ─────────────────────────────────────────
export async function noShowAppointment(appointmentId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'no_show' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `No-show failed (HTTP ${res.status})`);
  }
}

// ── Complete Appointment (checked_in → completed) ───────────────
export async function completeAppointment(appointmentId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'complete' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Complete failed (HTTP ${res.status})`);
  }
}

// ── Delete Appointment (permanent removal) ──────────────────────
export async function deleteAppointment(appointmentId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(`${API_BASE_URL}/api/moderate-appointment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ appointmentId, action: 'delete' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed (HTTP ${res.status})`);
  }
}

// ── Virtual Codes ─────────────────────────────────────────────────
export async function fetchVirtualCodes(orgId: string) {
  const { data, error } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createVirtualCode(data: {
  organization_id: string;
  office_id?: string | null;
  department_id?: string | null;
  service_id?: string | null;
}) {
  // Generate a unique qr_token (required by DB, no default)
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const token = 'vq_' + Array.from({ length: 12 }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');

  const { error } = await supabase.from('virtual_queue_codes').insert({
    organization_id: data.organization_id,
    office_id: data.office_id || null,
    department_id: data.department_id || null,
    service_id: data.service_id || null,
    qr_token: token,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

export async function toggleVirtualCode(codeId: string, isActive: boolean) {
  const { error } = await supabase.from('virtual_queue_codes').update({ is_active: isActive }).eq('id', codeId);
  if (error) throw new Error(error.message);
}

export async function deleteVirtualCode(codeId: string) {
  const { error } = await supabase.from('virtual_queue_codes').delete().eq('id', codeId);
  if (error) throw new Error(error.message);
}

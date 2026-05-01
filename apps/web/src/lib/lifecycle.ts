/**
 * Centralized lifecycle module for appointment and ticket status transitions.
 *
 * EVERY status change to an appointment or ticket terminal state MUST go through
 * these functions. They guarantee that:
 * - Linked tickets are cancelled when an appointment is cancelled/declined/no_show
 * - Linked appointments are updated when a ticket reaches a terminal state
 * - Customer notifications (WhatsApp/Messenger) are sent consistently
 * - Waitlist entries are notified when a slot is freed
 *
 * All functions use the admin Supabase client internally — callers don't need
 * to worry about RLS.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { t as tMsg, type Locale, phoneLookupCandidates } from '@/lib/messaging-commands';
import { sendAPNsToAppointment } from '@/lib/apns';
import { sendAndroidToAppointment } from '@/lib/android-push';

// ── Types ────────────────────────────────────────────────────────────────────

type AppointmentStatus =
  | 'pending' | 'confirmed' | 'checked_in' | 'completed'
  | 'cancelled' | 'no_show' | 'declined';

type TicketTerminalStatus = 'served' | 'cancelled' | 'no_show' | 'transferred';

export interface TransitionAppointmentOpts {
  /** Optional cancellation/decline reason included in the notification. */
  reason?: string;
  /** Skip customer notification (e.g. cron jobs, or when caller handles it). */
  skipNotify?: boolean;
  /** Skip waitlist notification. */
  skipWaitlist?: boolean;
  /** For approve: office timezone (used to detect same-day appointments). */
  officeTz?: string;
}

export interface TransitionResult {
  ok: boolean;
  status: string;
  notified: boolean;
  channel: 'whatsapp' | 'messenger' | null;
  notifyError: string | null;
}

export interface OnTicketTerminalOpts {
  /** For transfers: the new ticket ID to re-link the appointment to. */
  newTicketId?: string;
}

// ── Notification channel resolution (single source of truth) ────────────────

interface ResolvedChannel {
  channel: 'whatsapp' | 'messenger' | null;
  toPhone: string | null;
  toPsid: string | null;
  locale: Locale;
}

async function resolveNotificationChannel(
  sb: any,
  customerPhone: string | null,
  orgId: string | null,
  storedLocale: string | null,
): Promise<ResolvedChannel> {
  let locale: Locale =
    (storedLocale === 'ar' || storedLocale === 'en' || storedLocale === 'fr')
      ? storedLocale : 'fr';
  const haveStoredLocale = storedLocale === 'ar' || storedLocale === 'en' || storedLocale === 'fr';

  let channel: 'whatsapp' | 'messenger' | null = null;
  let toPhone: string | null = customerPhone || null;
  let toPsid: string | null = null;

  if (customerPhone && orgId) {
    const phoneVariants = phoneLookupCandidates(customerPhone);
    const orFilter = phoneVariants
      .flatMap((v) => [`whatsapp_phone.eq.${v}`, `messenger_psid.eq.${v}`])
      .join(',');

    const { data: sessionRows } = await sb
      .from('whatsapp_sessions')
      .select('id, channel, whatsapp_phone, messenger_psid, locale')
      .eq('organization_id', orgId)
      .or(orFilter)
      .order('created_at', { ascending: false })
      .limit(1);

    const session = sessionRows?.[0];
    if (session) {
      channel = session.channel as 'whatsapp' | 'messenger';
      if (session.whatsapp_phone) toPhone = session.whatsapp_phone;
      if (session.messenger_psid) toPsid = session.messenger_psid;
      if (!haveStoredLocale && session.locale) locale = session.locale as Locale;
    }
  }

  // Default to WhatsApp if we have a phone but no session
  if (!channel && toPhone) channel = 'whatsapp';

  return { channel, toPhone, toPsid, locale };
}

// ── Linked ticket cancellation (single source of truth) ─────────────────────

async function cancelLinkedTickets(
  sb: any,
  appointmentId: string,
  targetStatus: 'cancelled' | 'no_show' = 'cancelled',
) {
  const nowIso = new Date().toISOString();
  const activeStatuses = ['waiting', 'called', 'issued', 'serving'];

  // Direction 1: appointment.ticket_id → ticket
  const { data: appt } = await sb
    .from('appointments')
    .select('ticket_id')
    .eq('id', appointmentId)
    .single();

  if (appt?.ticket_id) {
    await sb
      .from('tickets')
      .update({ status: targetStatus, completed_at: nowIso })
      .eq('id', appt.ticket_id)
      .in('status', activeStatuses);
  }

  // Direction 2: ticket.appointment_id → ticket
  await sb
    .from('tickets')
    .update({ status: targetStatus, completed_at: nowIso })
    .eq('appointment_id', appointmentId)
    .in('status', activeStatuses);
}

// ── Waitlist notification (single source of truth) ──────────────────────────

async function notifyWaitlist(sb: any, appointmentId: string) {
  try {
    const { data: appointment } = await sb
      .from('appointments')
      .select('office_id, service_id, scheduled_at, offices!inner(organization:organizations(timezone))')
      .eq('id', appointmentId)
      .single();

    if (!appointment) return;

    // Use org-level timezone as single source of truth
    const tz: string = (appointment as any).offices?.organization?.timezone || 'Africa/Algiers';
    const scheduledDate = new Date(appointment.scheduled_at);
    // Timezone-aware date & time extraction
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(scheduledDate);
    const timeParts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(scheduledDate);
    const time = `${timeParts.find(p => p.type === 'hour')?.value ?? '00'}:${timeParts.find(p => p.type === 'minute')?.value ?? '00'}`;

    const { data: waitlistEntries } = await sb
      .from('slot_waitlist')
      .select('id')
      .eq('office_id', appointment.office_id)
      .eq('service_id', appointment.service_id)
      .eq('requested_date', date)
      .eq('requested_time', time)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!waitlistEntries?.length) return;

    await sb
      .from('slot_waitlist')
      .update({ status: 'notified', notified_at: new Date().toISOString() })
      .eq('id', waitlistEntries[0].id);
  } catch (err) {
    console.error('[lifecycle:notifyWaitlist] error:', err);
  }
}

// ── Send notification to customer ───────────────────────────────────────────

async function sendNotification(
  resolved: ResolvedChannel,
  msgBody: string,
): Promise<{ notified: boolean; notifyError: string | null }> {
  try {
    if (resolved.channel === 'whatsapp' && resolved.toPhone) {
      const result = await sendWhatsAppMessage({ to: resolved.toPhone, body: msgBody });
      return { notified: result.ok === true, notifyError: result.ok ? null : (result.error ?? 'WhatsApp send failed') };
    }
    if (resolved.channel === 'messenger' && resolved.toPsid) {
      await sendMessengerMessage({ recipientId: resolved.toPsid, text: msgBody });
      return { notified: true, notifyError: null };
    }
    return { notified: false, notifyError: null };
  } catch (e: any) {
    console.error('[lifecycle:sendNotification] error:', e);
    return { notified: false, notifyError: e?.message || String(e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transition an appointment to a new status.
 *
 * Handles ALL side-effects:
 * - DB status update
 * - Linked ticket cancellation (cancel/no_show/declined)
 * - Customer notification via WhatsApp/Messenger
 * - Waitlist notification when a slot is freed
 *
 * Every code path that changes an appointment status MUST call this function.
 */
export async function transitionAppointment(
  appointmentId: string,
  newStatus: AppointmentStatus,
  opts: TransitionAppointmentOpts = {},
): Promise<TransitionResult> {
  const sb = createAdminClient() as any;

  // 1. Fetch appointment
  const { data: appt, error: fetchErr } = await sb
    .from('appointments')
    .select('id, office_id, status, customer_phone, customer_name, scheduled_at, service_id, department_id, locale')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) {
    return { ok: false, status: 'unknown', notified: false, channel: null, notifyError: fetchErr?.message ?? 'Not found' };
  }

  // 2. Validate transition
  const terminalStates = new Set(['cancelled', 'completed', 'no_show', 'declined']);
  if (terminalStates.has(appt.status) && newStatus !== appt.status) {
    return { ok: false, status: appt.status, notified: false, channel: null, notifyError: `Already in terminal state: ${appt.status}` };
  }

  // 3. DB update (optimistic lock: only update if status hasn't changed since read)
  const { error: updErr, count: updCount } = await sb
    .from('appointments')
    .update({ status: newStatus }, { count: 'exact' })
    .eq('id', appointmentId)
    .eq('status', appt.status);

  if (updErr) {
    return { ok: false, status: appt.status, notified: false, channel: null, notifyError: updErr.message };
  }
  if (updCount === 0) {
    return { ok: false, status: appt.status, notified: false, channel: null, notifyError: 'Concurrent modification — status changed by another user' };
  }

  // 4. Cancel linked tickets (for destructive transitions)
  if (newStatus === 'cancelled' || newStatus === 'declined') {
    await cancelLinkedTickets(sb, appointmentId, 'cancelled');
  } else if (newStatus === 'no_show') {
    await cancelLinkedTickets(sb, appointmentId, 'no_show');
  }

  // 5. Waitlist notification (for slot-freeing transitions)
  if (!opts.skipWaitlist && (newStatus === 'cancelled' || newStatus === 'declined')) {
    await notifyWaitlist(sb, appointmentId);
  }

  // 6. Resolve notification channel
  const { data: office } = await sb
    .from('offices')
    .select('organization_id, organization:organizations(id, name, timezone, settings)')
    .eq('id', appt.office_id)
    .single();

  const orgName: string = (office?.organization as any)?.name ?? '';
  const orgId: string | null = office?.organization_id ?? (office?.organization as any)?.id ?? null;
  // Use org-level timezone as single source of truth
  const officeTz: string = opts.officeTz ?? (office?.organization as any)?.timezone ?? 'Africa/Algiers';
  // Resolve category for vocabulary substitution — restaurants render
  // "réservation" + table-ready copy instead of the default "rendez-vous"
  // + ticket copy. See appointment-vocabulary.ts.
  const orgCategory: string | null = (office?.organization as any)?.settings?.business_category ?? null;

  if (opts.skipNotify) {
    return { ok: true, status: newStatus, notified: false, channel: null, notifyError: null };
  }

  const resolved = await resolveNotificationChannel(sb, appt.customer_phone, orgId, appt.locale);

  // 7. Send customer notification
  let templateKey: string;

  // Resolve date, time, and service for richer notification messages
  const loc = resolved.locale || 'fr';
  const dateLoc = loc === 'ar' ? 'ar-DZ' : loc === 'en' ? 'en-GB' : 'fr-FR';
  const apptDate = appt.scheduled_at
    ? new Intl.DateTimeFormat(dateLoc, { timeZone: officeTz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(appt.scheduled_at))
    : '—';
  const apptTime = appt.scheduled_at
    ? new Intl.DateTimeFormat(dateLoc, { timeZone: officeTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(appt.scheduled_at))
    : '—';
  let serviceName = '—';
  if (appt.service_id) {
    try {
      const { data: svc } = await sb.from('services').select('name').eq('id', appt.service_id).single();
      if (svc?.name) serviceName = svc.name;
    } catch { /* ignore */ }
  }

  const { getApptVocabVars } = await import('@/lib/appointment-vocabulary');
  const apptVocabVars = getApptVocabVars(orgCategory, (loc as 'ar' | 'fr' | 'en'));
  const templateParams: Record<string, string> = {
    ...apptVocabVars,
    name: orgName, date: apptDate, time: apptTime, service: serviceName,
  };

  switch (newStatus) {
    case 'confirmed': {
      // Detect same-day → different template
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: officeTz }).format(new Date());
      const scheduledStr = appt.scheduled_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: officeTz }).format(new Date(appt.scheduled_at))
        : '';
      templateKey = scheduledStr === todayStr ? 'approval_approved_sameday' : 'approval_approved';
      break;
    }
    case 'declined':
    case 'cancelled': {
      const reason = (opts.reason ?? '').trim();
      if (newStatus === 'declined') {
        templateKey = 'approval_declined';
        templateParams.reason = reason ||
          (resolved.locale === 'ar' ? 'لم يتم تقديم سبب.' : resolved.locale === 'en' ? 'No reason provided.' : 'Aucune raison fournie.');
      } else {
        templateKey = 'appointment_cancelled';
        templateParams.reason = reason
          ? `\n\n${resolved.locale === 'ar' ? 'السبب' : resolved.locale === 'en' ? 'Reason' : 'Motif'}: ${reason}`
          : '';
      }
      break;
    }
    case 'no_show':
      templateKey = 'appointment_no_show';
      break;
    default:
      // No notification for other transitions (checked_in, completed, pending)
      return { ok: true, status: newStatus, notified: false, channel: null, notifyError: null };
  }

  const msgBody = tMsg(templateKey, resolved.locale, templateParams);
  const { notified, notifyError } = await sendNotification(resolved, msgBody);

  // 8. Instant mobile push (APNs + Android) to the appointment's registered devices.
  // Fire-and-forget so notification latency doesn't delay the HTTP response.
  try {
    const pushTitle = pushTitleForStatus(newStatus, resolved.locale, orgName);
    const pushBody = msgBody.slice(0, 240);
    void sendAPNsToAppointment(appointmentId, { title: pushTitle, body: pushBody }).catch(() => {});
    void sendAndroidToAppointment(appointmentId, {
      type: 'appointment_update',
      title: pushTitle,
      body: pushBody,
      appointmentId,
      status: newStatus,
    }).catch(() => {});
  } catch {
    /* never let push failures block the transition */
  }

  return { ok: true, status: newStatus, notified, channel: resolved.channel, notifyError };
}

function pushTitleForStatus(status: AppointmentStatus, locale: Locale, orgName: string): string {
  const L = locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr';
  const prefix = orgName ? `${orgName} · ` : '';
  const map: Record<string, Record<string, string>> = {
    confirmed: { en: 'Appointment approved', fr: 'Rendez-vous approuvé', ar: 'تمت الموافقة على الموعد' },
    declined: { en: 'Appointment declined', fr: 'Rendez-vous refusé', ar: 'تم رفض الموعد' },
    cancelled: { en: 'Appointment cancelled', fr: 'Rendez-vous annulé', ar: 'تم إلغاء الموعد' },
    no_show: { en: 'Missed appointment', fr: 'Rendez-vous manqué', ar: 'موعد فائت' },
    checked_in: { en: 'Checked in', fr: 'Enregistré', ar: 'تم تسجيل الحضور' },
    completed: { en: 'Appointment completed', fr: 'Rendez-vous terminé', ar: 'اكتمل الموعد' },
    pending: { en: 'Appointment pending', fr: 'Rendez-vous en attente', ar: 'موعد قيد المراجعة' },
  };
  return prefix + (map[status]?.[L] ?? 'Appointment update');
}

/**
 * Notify customer when their appointment is rescheduled to a new date/time.
 * Called from rescheduleAppointment() after the DB update.
 */
export async function notifyAppointmentRescheduled(
  appointmentId: string,
  newScheduledAt: string,
): Promise<{ notified: boolean; channel: string | null; notifyError: string | null }> {
  const sb = createAdminClient() as any;

  // 1. Fetch appointment details
  const { data: appt, error: fetchErr } = await sb
    .from('appointments')
    .select('id, office_id, customer_phone, customer_name, locale')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) {
    return { notified: false, channel: null, notifyError: fetchErr?.message ?? 'Not found' };
  }

  if (!appt.customer_phone) {
    return { notified: false, channel: null, notifyError: null };
  }

  // 2. Get org name + timezone
  const { data: office } = await sb
    .from('offices')
    .select('organization_id, organization:organizations(id, name, timezone, settings)')
    .eq('id', appt.office_id)
    .single();

  const orgName: string = (office?.organization as any)?.name ?? '';
  const orgId: string | null = office?.organization_id ?? (office?.organization as any)?.id ?? null;
  const tz: string = (office?.organization as any)?.timezone ?? 'Africa/Algiers';
  const orgCategoryRescheduled: string | null = (office?.organization as any)?.settings?.business_category ?? null;

  // 3. Format new date/time in org timezone
  const dt = new Date(newScheduledAt);
  const newDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(dt);
  const timeParts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(dt);
  const newTime = `${timeParts.find(p => p.type === 'hour')?.value ?? '00'}:${timeParts.find(p => p.type === 'minute')?.value ?? '00'}`;

  // 4. Resolve channel + send
  const resolved = await resolveNotificationChannel(sb, appt.customer_phone, orgId, appt.locale);
  const { getApptVocabVars: getApptVocabVarsR } = await import('@/lib/appointment-vocabulary');
  const apptVocabRescheduled = getApptVocabVarsR(orgCategoryRescheduled, (resolved.locale as 'ar' | 'fr' | 'en'));
  const msgBody = tMsg('appointment_rescheduled', resolved.locale, {
    ...apptVocabRescheduled,
    name: orgName,
    new_date: newDate,
    new_time: newTime,
  });
  const { notified, notifyError } = await sendNotification(resolved, msgBody);

  // 5. Instant mobile push to registered devices so the customer sees the
  //    new time immediately — not at the next 20s poll. Mirrors the
  //    transitionAppointment() push path. Fire-and-forget.
  try {
    const L = resolved.locale === 'ar' ? 'ar' : resolved.locale === 'en' ? 'en' : 'fr';
    const titleByLocale: Record<string, string> = {
      en: 'Appointment rescheduled',
      fr: 'Rendez-vous reporté',
      ar: 'تم تغيير موعد الحجز',
    };
    const pushTitle = (orgName ? `${orgName} · ` : '') + (titleByLocale[L] ?? 'Appointment rescheduled');
    const pushBody = msgBody.slice(0, 240);
    void sendAPNsToAppointment(appointmentId, { title: pushTitle, body: pushBody }).catch(() => {});
    void sendAndroidToAppointment(appointmentId, {
      type: 'appointment_rescheduled',
      title: pushTitle,
      body: pushBody,
      appointmentId,
    }).catch(() => {});
  } catch {
    /* never let push failures block the reschedule */
  }

  return { notified, channel: resolved.channel, notifyError };
}

/**
 * Called when a ticket reaches a terminal state (served, cancelled, no_show, transferred).
 *
 * Syncs the status back to the linked appointment:
 * - served → appointment.completed
 * - cancelled → appointment.cancelled
 * - no_show → appointment.no_show
 * - transferred → appointment stays confirmed, ticket_id re-linked to new ticket
 *
 * Every code path that moves a ticket to a terminal state MUST call this function.
 */
export async function onTicketTerminal(
  ticketId: string,
  terminalStatus: TicketTerminalStatus,
  opts: OnTicketTerminalOpts = {},
): Promise<void> {
  try {
    const sb = createAdminClient() as any;

    const { data: ticket } = await sb
      .from('tickets')
      .select('appointment_id, notes, ticket_number, assigned_rider_id, rider_push_token')
      .eq('id', ticketId)
      .single();

    // If a rider is mid-run on this ticket, push them so the cancel
    // shows on a locked phone instantly. WhatsApp message they sent
    // earlier is the durable backup; this is the latency win.
    if (ticket?.rider_push_token && terminalStatus === 'cancelled' && ticket.assigned_rider_id) {
      void import('@/lib/rider-push').then(({ sendRiderPush, clearRiderPushToken }) =>
        sendRiderPush(ticketId, {
          title: 'Order cancelled',
          body: `Order ${ticket.ticket_number ?? ''} has been cancelled. Stop the run.`,
        }).finally(() => clearRiderPushToken(ticketId)),
      ).catch(() => {});
    } else if (ticket?.rider_push_token && (terminalStatus === 'served' || terminalStatus === 'no_show')) {
      // Run finished — drop the token so we don't push a stale device.
      void import('@/lib/rider-push').then(({ clearRiderPushToken }) =>
        clearRiderPushToken(ticketId),
      ).catch(() => {});
    }

    const appointmentStatus =
      terminalStatus === 'served' ? 'completed' :
      terminalStatus === 'transferred' ? 'confirmed' :
      terminalStatus; // cancelled, no_show pass through

    // Sync notes back to appointment + update status
    const apptUpdate: Record<string, any> = { status: appointmentStatus };
    if (ticket?.notes) apptUpdate.notes = ticket.notes;

    // Active states that can transition to a terminal state
    const activeStates = ['pending', 'confirmed', 'checked_in', 'serving'];

    // Direction 1: ticket.appointment_id → appointment (primary link)
    if (ticket?.appointment_id) {
      await sb
        .from('appointments')
        .update(apptUpdate)
        .eq('id', ticket.appointment_id)
        .in('status', activeStates);

      // For transfers: re-link appointment to the new ticket
      if (terminalStatus === 'transferred' && opts.newTicketId) {
        await sb
          .from('appointments')
          .update({ ticket_id: opts.newTicketId })
          .eq('id', ticket.appointment_id);
      }
    }

    // Direction 2: appointment.ticket_id → ticket (reverse link, safety net)
    // This catches cases where ticket.appointment_id wasn't set but
    // appointment.ticket_id was (e.g. check-in sets both, but sync may lose one)
    await sb
      .from('appointments')
      .update(apptUpdate)
      .eq('ticket_id', ticketId)
      .in('status', activeStates);
  } catch (err) {
    console.error(`[lifecycle:onTicketTerminal] Failed for ticket ${ticketId}:`, err);
  }
}

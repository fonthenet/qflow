import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { t as tMsg, type Locale } from '@/lib/messaging-commands';

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

/**
 * POST /api/moderate-appointment
 * Body: { appointmentId: string, action: 'approve' | 'decline' | 'cancel' | 'no_show', reason?: string }
 *
 * - approve  : pending → confirmed (customer notified: approval_approved)
 * - decline  : pending → cancelled (customer notified: approval_declined)
 * - cancel   : confirmed/pending → cancelled (customer notified: appointment_cancelled)
 * - no_show  : confirmed → no_show (customer notified: appointment_no_show)
 *
 * The customer is notified through their original messaging channel
 * (WhatsApp/Messenger) when one can be resolved from a recent session.
 */
type ModerateAction = 'approve' | 'decline' | 'cancel' | 'no_show';

export async function POST(request: NextRequest) {
  let body: { appointmentId?: string; action?: ModerateAction; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { appointmentId, action, reason } = body;
  const validActions: ModerateAction[] = ['approve', 'decline', 'cancel', 'no_show'];
  if (!appointmentId || !action || !validActions.includes(action)) {
    return NextResponse.json(
      { error: 'appointmentId and action (approve|decline|cancel|no_show) are required' },
      { status: 400 },
    );
  }

  const supabase = getSupabase() as any;

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, office_id, status, customer_phone, customer_name, scheduled_at, service_id, department_id, locale')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }
  // approve/decline only valid from pending; cancel/no_show valid from any non-terminal state
  const terminalStates = new Set(['cancelled', 'completed', 'no_show', 'declined']);
  if ((action === 'approve' || action === 'decline') && appt.status !== 'pending') {
    return NextResponse.json(
      { error: `Appointment is not pending (current status: ${appt.status})` },
      { status: 409 },
    );
  }
  if ((action === 'cancel' || action === 'no_show') && terminalStates.has(appt.status)) {
    return NextResponse.json(
      { error: `Appointment already in terminal state: ${appt.status}` },
      { status: 409 },
    );
  }

  // Org name for branded notifications.
  const { data: office } = await supabase
    .from('offices')
    .select('id, organization_id, organization:organizations(id, name)')
    .eq('id', appt.office_id)
    .single();
  const orgName: string = office?.organization?.name ?? '';
  const orgId: string | null = office?.organization_id ?? office?.organization?.id ?? null;

  // Resolve channel by looking up the most recent session for this contact in
  // this office. customer_phone may actually hold a Messenger PSID for chats
  // started from Messenger — try both columns.
  let channel: 'whatsapp' | 'messenger' | null = null;
  // Default toPhone to whatever the appointment stores. sendWhatsAppMessage
  // normalizes the format itself, so any phone-shaped string is acceptable.
  let toPhone: string | null = appt.customer_phone || null;
  let toPsid: string | null = null;
  // Locale priority: row-stored locale (set at booking) > session lookup > 'fr'.
  let locale: Locale = (appt.locale === 'ar' || appt.locale === 'en' || appt.locale === 'fr') ? appt.locale : 'fr';
  const haveStoredLocale = appt.locale === 'ar' || appt.locale === 'en' || appt.locale === 'fr';

  if (appt.customer_phone) {
    // Sessions are organization-scoped, not office-scoped. Try several phone
    // shapes (digits-only, with leading +, with leading 0 stripped) so format
    // mismatches between the booking form and the chat flow don't drop the locale.
    const raw = appt.customer_phone.trim();
    const digits = raw.replace(/\D/g, '');
    const phoneVariants = Array.from(new Set([raw, digits, `+${digits}`].filter(Boolean)));
    let session: any = null;
    if (orgId) {
      const orFilter = phoneVariants
        .flatMap((v) => [`whatsapp_phone.eq.${v}`, `messenger_psid.eq.${v}`])
        .join(',');
      const { data: sessionRows } = await supabase
        .from('whatsapp_sessions')
        .select('id, channel, whatsapp_phone, messenger_psid, locale, state')
        .eq('organization_id', orgId)
        .or(orFilter)
        .order('created_at', { ascending: false })
        .limit(1);
      session = sessionRows && sessionRows[0];
    }
    if (session) {
      channel = session.channel as 'whatsapp' | 'messenger';
      // Prefer the session's stored identifiers but keep customer_phone as
      // fallback so a session row missing whatsapp_phone still notifies.
      if (session.whatsapp_phone) toPhone = session.whatsapp_phone;
      if (session.messenger_psid) toPsid = session.messenger_psid;
      // Only override locale from session if the row didn't already have one.
      if (!haveStoredLocale && session.locale) locale = session.locale as Locale;
    }
  }
  // If session lookup didn't yield a channel but we still have a phone-shaped
  // value, default to WhatsApp. This is the common case for web/native bookings
  // that never went through the chat flow.
  if (!channel && toPhone) {
    channel = 'whatsapp';
  }

  if (action === 'approve') {
    const { error: updErr } = await supabase
      .from('appointments')
      .update({ status: 'confirmed' })
      .eq('id', appt.id)
      .eq('status', 'pending');
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Detect same-day appointment: scheduled_at is today → ticket is auto-created,
    // so don't say "you'll receive a ticket when you arrive".
    // Compare using UTC+1 (Algeria) to avoid timezone mismatch on Vercel (UTC).
    const algeriaOffset = 60; // UTC+1 in minutes
    const nowAlgeria = new Date(Date.now() + algeriaOffset * 60_000);
    const todayStr = nowAlgeria.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const scheduledStr = appt.scheduled_at ? appt.scheduled_at.slice(0, 10) : '';
    const isSameDay = scheduledStr === todayStr;
    const approveTemplate = isSameDay ? 'approval_approved_sameday' : 'approval_approved';

    let notified = false;
    let notifyError: string | null = null;
    try {
      const msgBody = tMsg(approveTemplate, locale, { name: orgName });
      if (channel === 'whatsapp' && toPhone) {
        const result = await sendWhatsAppMessage({ to: toPhone, body: msgBody });
        notified = result.ok === true;
        if (!result.ok) notifyError = result.error ?? 'WhatsApp send failed';
      } else if (channel === 'messenger' && toPsid) {
        await sendMessengerMessage({ recipientId: toPsid, text: msgBody });
        notified = true;
      }
    } catch (e: any) {
      notifyError = e?.message || String(e);
      console.error('[moderate-appointment] notify approve failed:', e);
    }

    return NextResponse.json({ ok: true, status: 'confirmed', notified, channel, notifyError });
  }

  if (action === 'decline') {
    const declineReason = (reason ?? '').trim();
    const { error: updErr } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', appt.id)
      .eq('status', 'pending');
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    let notified = false;
    let notifyError: string | null = null;
    try {
      const reasonText =
        declineReason ||
        (locale === 'ar' ? 'لم يتم تقديم سبب.' : locale === 'en' ? 'No reason provided.' : 'Aucune raison fournie.');
      const msgBody = tMsg('approval_declined', locale, { name: orgName, reason: reasonText });
      if (channel === 'whatsapp' && toPhone) {
        const result = await sendWhatsAppMessage({ to: toPhone, body: msgBody });
        notified = result.ok === true;
        if (!result.ok) notifyError = result.error ?? 'WhatsApp send failed';
      } else if (channel === 'messenger' && toPsid) {
        await sendMessengerMessage({ recipientId: toPsid, text: msgBody });
        notified = true;
      }
    } catch (e: any) {
      notifyError = e?.message || String(e);
      console.error('[moderate-appointment] notify decline failed:', e);
    }

    return NextResponse.json({ ok: true, status: 'cancelled', notified, channel, notifyError });
  }

  // cancel | no_show
  const newStatus = action === 'no_show' ? 'no_show' : 'cancelled';
  const templateKey = action === 'no_show' ? 'appointment_no_show' : 'appointment_cancelled';
  const { error: updErr2 } = await supabase
    .from('appointments')
    .update({ status: newStatus })
    .eq('id', appt.id);
  if (updErr2) {
    return NextResponse.json({ error: updErr2.message }, { status: 500 });
  }

  let notified = false;
  let notifyError: string | null = null;
  try {
    const cancelReason = (reason ?? '').trim();
    const reasonBlock = cancelReason
      ? `\n\n${locale === 'ar' ? 'السبب' : locale === 'en' ? 'Reason' : 'Motif'}: ${cancelReason}`
      : '';
    const msgBody = tMsg(templateKey, locale, { name: orgName, reason: reasonBlock });
    if (channel === 'whatsapp' && toPhone) {
      const result = await sendWhatsAppMessage({ to: toPhone, body: msgBody });
      notified = result.ok === true;
      if (!result.ok) notifyError = result.error ?? 'WhatsApp send failed';
    } else if (channel === 'messenger' && toPsid) {
      await sendMessengerMessage({ recipientId: toPsid, text: msgBody });
      notified = true;
    }
  } catch (e: any) {
    notifyError = e?.message || String(e);
    console.error(`[moderate-appointment] notify ${action} failed:`, e);
  }

  return NextResponse.json({ ok: true, status: newStatus, notified, channel, notifyError });
}

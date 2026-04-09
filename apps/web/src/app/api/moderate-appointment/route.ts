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
 * Body: { appointmentId: string, action: 'approve' | 'decline', reason?: string }
 *
 * Approves or declines a `pending` appointment. On approval the appointment
 * transitions to `confirmed`; on decline it goes to `cancelled`. The customer
 * is notified through their original messaging channel (WhatsApp/Messenger)
 * when one can be resolved from a recent session.
 */
export async function POST(request: NextRequest) {
  let body: { appointmentId?: string; action?: 'approve' | 'decline'; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { appointmentId, action, reason } = body;
  if (!appointmentId || (action !== 'approve' && action !== 'decline')) {
    return NextResponse.json(
      { error: 'appointmentId and action (approve|decline) are required' },
      { status: 400 },
    );
  }

  const supabase = getSupabase() as any;

  const { data: appt, error: fetchErr } = await supabase
    .from('appointments')
    .select('id, office_id, status, customer_phone, customer_name, scheduled_at, service_id, department_id')
    .eq('id', appointmentId)
    .single();

  if (fetchErr || !appt) {
    return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
  }
  if (appt.status !== 'pending') {
    return NextResponse.json(
      { error: `Appointment is not pending (current status: ${appt.status})` },
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

  // Resolve channel by looking up the most recent session for this contact in
  // this office. customer_phone may actually hold a Messenger PSID for chats
  // started from Messenger — try both columns.
  let channel: 'whatsapp' | 'messenger' | null = null;
  let toPhone: string | null = null;
  let toPsid: string | null = null;
  let locale: Locale = 'fr';

  if (appt.customer_phone) {
    const { data: sessionRows } = await supabase
      .from('whatsapp_sessions')
      .select('id, channel, whatsapp_phone, messenger_psid, locale')
      .eq('office_id', appt.office_id)
      .or(`whatsapp_phone.eq.${appt.customer_phone},messenger_psid.eq.${appt.customer_phone}`)
      .order('created_at', { ascending: false })
      .limit(1);
    const session = sessionRows && sessionRows[0];
    if (session) {
      channel = session.channel as 'whatsapp' | 'messenger';
      toPhone = session.whatsapp_phone || null;
      toPsid = session.messenger_psid || null;
      locale = (session.locale as Locale) || 'fr';
    } else {
      // No session match — assume WhatsApp if it looks like a phone number.
      if (/^\+?\d{6,}$/.test(appt.customer_phone)) {
        channel = 'whatsapp';
        toPhone = appt.customer_phone;
      }
    }
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

    let notified = false;
    let notifyError: string | null = null;
    try {
      const body = tMsg('approval_approved', locale, { name: orgName });
      if (channel === 'whatsapp' && toPhone) {
        await sendWhatsAppMessage({ to: toPhone, body });
        notified = true;
      } else if (channel === 'messenger' && toPsid) {
        await sendMessengerMessage({ recipientId: toPsid, text: body });
        notified = true;
      }
    } catch (e: any) {
      notifyError = e?.message || String(e);
      console.error('[moderate-appointment] notify approve failed:', e);
    }

    return NextResponse.json({ ok: true, status: 'confirmed', notified, channel, notifyError });
  }

  // decline
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
    const body = tMsg('approval_declined', locale, { name: orgName, reason: reasonText });
    if (channel === 'whatsapp' && toPhone) {
      await sendWhatsAppMessage({ to: toPhone, body });
      notified = true;
    } else if (channel === 'messenger' && toPsid) {
      await sendMessengerMessage({ recipientId: toPsid, text: body });
      notified = true;
    }
  } catch (e: any) {
    notifyError = e?.message || String(e);
    console.error('[moderate-appointment] notify decline failed:', e);
  }

  return NextResponse.json({ ok: true, status: 'cancelled', notified, channel, notifyError });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { getQueuePosition } from '@/lib/queue-position';
import { formatPosition, formatNowServing, t as tMsg, type Locale } from '@/lib/messaging-commands';
import { APP_BASE_URL } from '@/lib/config';
import { resolveRestaurantServiceType } from '@qflo/shared';

/**
 * POST /api/moderate-ticket
 * Body: { ticketId: string, action: 'approve' | 'decline', reason?: string }
 *
 * Approves or declines a pending_approval ticket. On approval, transitions the
 * ticket to `waiting` and sends a "joined" notification via the original channel.
 * On decline, marks the ticket as `cancelled` and notifies the customer with an
 * optional reason.
 */
export async function POST(request: NextRequest) {
  let body: { ticketId?: string; action?: 'approve' | 'decline'; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { ticketId, action, reason } = body;
  if (!ticketId || (action !== 'approve' && action !== 'decline')) {
    return NextResponse.json({ error: 'ticketId and action (approve|decline) are required' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;

  // Fetch ticket (must still be pending_approval to be moderated)
  const { data: ticket, error: fetchErr } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, status, source, customer_data, qr_token, department_id, service_id, locale, appointment_id, checked_in_at')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.status !== 'pending_approval') {
    return NextResponse.json({ error: `Ticket is not pending approval (current status: ${ticket.status})` }, { status: 409 });
  }

  // Fetch office + org for branding/name used in notifications. We
  // also pull settings.business_category so the approval / declined
  // templates can swap their vocabulary (restaurant → "réservation"
  // + table-ready copy; default → "rendez-vous" + ticket copy).
  const { data: office } = await supabase
    .from('offices')
    .select('id, organization_id, organization:organizations(id, name, settings)')
    .eq('id', ticket.office_id)
    .single();
  const orgName: string = office?.organization?.name ?? '';
  const orgCategory: string | null = (office?.organization as any)?.settings?.business_category ?? null;
  const { getApptVocabVars: _getApptVocabVarsModerate } = await import('@/lib/appointment-vocabulary');
  // apptVocabModerate computed lazily below (after `locale` is declared);
  // we capture orgCategory here so we don't re-query the office row.

  // Find the channel session (if ticket came through WhatsApp/Messenger).
  // We don't filter by state — even if the session was already moved to
  // 'completed' (e.g. by the cancel path), we still need to send the
  // approval/decline notification to the customer. We pick the most recent
  // session for this ticket.
  const { data: sessionRows } = await supabase
    .from('whatsapp_sessions')
    .select('id, channel, whatsapp_phone, messenger_psid, locale')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false })
    .limit(1);
  const sessionRow = (sessionRows && sessionRows[0]) || null;

  // Resolve customer phone/psid: prefer the session, fall back to whatever
  // the ticket's customer_data contains (covers tickets created via the
  // public web flow with no live channel session).
  const cd: any = ticket.customer_data || {};
  const fallbackPhone: string | null = cd.whatsapp_phone || cd.phone || null;
  const fallbackPsid: string | null = cd.messenger_psid || null;
  const channel: 'whatsapp' | 'messenger' | null =
    sessionRow?.channel
      ?? (fallbackPsid ? 'messenger' : fallbackPhone ? 'whatsapp' : null);
  const toPhone: string | null = sessionRow?.whatsapp_phone || fallbackPhone;
  const toPsid: string | null = sessionRow?.messenger_psid || fallbackPsid;

  // Locale priority: row-stored locale (set at ticket creation) > session > cd > 'fr'.
  const locale: Locale =
    ((ticket as any).locale as Locale)
    || (sessionRow?.locale as Locale)
    || (cd.locale as Locale)
    || 'fr';

  // Resolve the service name once up-front so we can both:
  //   1. Pass it as the {service} substitution in approve/decline templates
  //   2. Detect takeout/delivery for restaurants → swap "reservation" copy
  //      for "order" copy (a takeout customer reads "Your reservation has
  //      been approved" as nonsensical — nothing was reserved).
  // Falls back to '—' if the row was deleted or unreadable.
  let resolvedServiceName = '—';
  let serviceTypeHint: 'dine_in' | 'takeout' | 'delivery' | null = null;
  if (ticket.service_id) {
    try {
      const { data: svc } = await supabase
        .from('services')
        .select('name')
        .eq('id', ticket.service_id)
        .maybeSingle();
      if (svc?.name) {
        resolvedServiceName = svc.name;
        if (orgCategory && /restaurant|cafe|café|food|resto|bistro/i.test(orgCategory)) {
          // resolveRestaurantServiceType returns 'dine_in' | 'takeout'
          // | 'delivery' | null based on the service name.
          serviceTypeHint = resolveRestaurantServiceType(svc.name) ?? null;
        }
      }
    } catch { /* ignore — vocab will use the default reservation/appointment branch */ }
  }
  // Restaurant takeout/delivery → "order" vocab; restaurant dine-in →
  // "reservation"; salons → "appointment"/"rendez-vous"; everything else
  // keeps the default appointment/RDV/موعد copy.
  const apptVocabModerate = _getApptVocabVarsModerate(orgCategory, locale, serviceTypeHint);

  if (action === 'approve') {
    const { error: updErr } = await supabase
      .from('tickets')
      .update({ status: 'waiting', checked_in_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('status', 'pending_approval');
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'joined',
      from_status: 'pending_approval',
      to_status: 'waiting',
      metadata: { moderated: 'approved' },
    });

    // Notify customer through original channel. We surface delivery failure
    // back to the Station so the operator knows if the customer wasn't reached.
    let notified = false;
    let notifyError: string | null = null;
    try {
      const trackUrl = `${APP_BASE_URL}/q/${ticket.qr_token}`;
      const pos = await getQueuePosition(ticket.id);
      // One combined message: "approved" header + full ticket details.
      // Ticket already exists (JOIN flow), so use the sameday template
      // which doesn't say "you'll receive a ticket when you arrive".
      // Service name was resolved earlier (see top of handler) — reuse
      // it here instead of round-tripping the DB again.
      const apprLocTag = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR';
      const apprWhenDt = (ticket as any).checked_in_at ? new Date((ticket as any).checked_in_at) : new Date();
      const approvedTime = apprWhenDt.toLocaleTimeString(apprLocTag, { hour: '2-digit', minute: '2-digit', hour12: false });
      const approvedHeader = tMsg('approval_approved_sameday', locale, {
        ...apptVocabModerate,
        name: orgName,
        time: approvedTime,
        service: resolvedServiceName,
      });
      const joinedBody = approvedHeader + tMsg('joined_details', locale, {
        ticket: ticket.ticket_number,
        position: formatPosition(pos, locale),
        now_serving: formatNowServing(pos, locale),
        url: trackUrl,
      }) + tMsg('quick_menu', locale);

      if (channel === 'whatsapp' && toPhone) {
        await sendWhatsAppMessage({ to: toPhone, body: joinedBody });
        notified = true;
      } else if (channel === 'messenger' && toPsid) {
        await sendMessengerMessage({ recipientId: toPsid, text: joinedBody });
        notified = true;
      }
      // Mobile/kiosk/QR customers without a chat channel poll the tracking
      // URL, which will now return 'waiting' — that's their notification path.
    } catch (e: any) {
      notifyError = e?.message || String(e);
      console.error('[moderate-ticket] notify approve failed:', e);
    }

    return NextResponse.json({ ok: true, status: 'waiting', notified, channel, notifyError });
  }

  // decline
  const declineReason = (reason ?? '').trim();

  // Sync cancellation to linked appointment BEFORE updating ticket status.
  // This ensures the appointment is already in terminal state when the DB
  // trigger fires on the ticket update, so it can detect the appointment-
  // driven cancellation and skip the duplicate basic notification.
  const { onTicketTerminal } = await import('@/lib/lifecycle');
  await onTicketTerminal(ticket.id, 'cancelled');

  const { error: updErr } = await supabase
    .from('tickets')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', ticket.id)
    .eq('status', 'pending_approval');
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  await supabase.from('ticket_events').insert({
    ticket_id: ticket.id,
    event_type: 'cancelled',
    from_status: 'pending_approval',
    to_status: 'cancelled',
    metadata: { moderated: 'declined', reason: declineReason || null },
  });
  // Close any related session
  if (sessionRow?.id) {
    await supabase.from('whatsapp_sessions').update({ state: 'completed' }).eq('id', sessionRow.id);
  }

  let notified = false;
  let notifyError: string | null = null;
  try {
    // If no reason was given, render the template with a generic placeholder so we
    // don't ship a message that ends in "\n\n" with nothing after it.
    const reasonText = declineReason
      || (locale === 'ar' ? 'لم يتم تقديم سبب.' : locale === 'en' ? 'No reason provided.' : 'Aucune raison fournie.');
    // Service name resolved at top of handler — reuse here.
    const locTag = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR';
    const whenDt = (ticket as any).checked_in_at ? new Date((ticket as any).checked_in_at) : new Date();
    const declinedDate = whenDt.toLocaleDateString(locTag, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const declinedTime = whenDt.toLocaleTimeString(locTag, { hour: '2-digit', minute: '2-digit', hour12: false });
    const declinedBody = tMsg('approval_declined', locale, {
      ...apptVocabModerate,
      name: orgName,
      date: declinedDate,
      time: declinedTime,
      service: resolvedServiceName,
      reason: reasonText,
    });
    if (channel === 'whatsapp' && toPhone) {
      await sendWhatsAppMessage({ to: toPhone, body: declinedBody });
      notified = true;
    } else if (channel === 'messenger' && toPsid) {
      await sendMessengerMessage({ recipientId: toPsid, text: declinedBody });
      notified = true;
    }
  } catch (e: any) {
    notifyError = e?.message || String(e);
    console.error('[moderate-ticket] notify decline failed:', e);
  }

  return NextResponse.json({ ok: true, status: 'cancelled', notified, channel, notifyError });
}

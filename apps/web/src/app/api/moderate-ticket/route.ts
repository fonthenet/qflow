import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { getQueuePosition } from '@/lib/queue-position';
import { formatPosition, formatNowServing, t as tMsg, type Locale } from '@/lib/messaging-commands';

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

  const supabase = getSupabase() as any;

  // Fetch ticket (must still be pending_approval to be moderated)
  const { data: ticket, error: fetchErr } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, status, source, customer_data, qr_token, department_id, service_id')
    .eq('id', ticketId)
    .single();

  if (fetchErr || !ticket) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }
  if (ticket.status !== 'pending_approval') {
    return NextResponse.json({ error: `Ticket is not pending approval (current status: ${ticket.status})` }, { status: 409 });
  }

  // Fetch office + org for branding/name used in notifications
  const { data: office } = await supabase
    .from('offices')
    .select('id, organization_id, organization:organizations(id, name)')
    .eq('id', ticket.office_id)
    .single();
  const orgName: string = office?.organization?.name ?? '';

  // Find the channel session (if ticket came through WhatsApp/Messenger)
  const { data: sessionRow } = await supabase
    .from('whatsapp_sessions')
    .select('id, channel, whatsapp_phone, messenger_psid, locale')
    .eq('ticket_id', ticket.id)
    .maybeSingle();

  const locale: Locale = (sessionRow?.locale as Locale) || 'fr';

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

    // Notify customer through original channel
    try {
      const baseUrl = (process.env.APP_CLIP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://qflo.net').replace(/\/+$/, '');
      const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;
      const pos = await getQueuePosition(ticket.id);
      const joinedBody = tMsg('joined', locale, {
        name: orgName,
        ticket: ticket.ticket_number,
        position: formatPosition(pos, locale),
        now_serving: formatNowServing(pos, locale),
        url: trackUrl,
      }) + tMsg('quick_menu', locale);

      if (sessionRow?.channel === 'whatsapp' && sessionRow?.whatsapp_phone) {
        await sendWhatsAppMessage({ to: sessionRow.whatsapp_phone, body: joinedBody });
      } else if (sessionRow?.channel === 'messenger' && sessionRow?.messenger_psid) {
        await sendMessengerMessage({ recipientId: sessionRow.messenger_psid, text: joinedBody });
      }
      // Mobile/kiosk/QR customers poll the tracking URL, which will now return 'waiting'.
    } catch (e) {
      console.error('[moderate-ticket] notify approve failed:', e);
    }

    return NextResponse.json({ ok: true, status: 'waiting' });
  }

  // decline
  const declineReason = (reason ?? '').trim();
  const { error: updErr } = await supabase
    .from('tickets')
    .update({ status: 'cancelled' })
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

  try {
    const declinedBody = tMsg('approval_declined', locale, {
      name: orgName,
      reason: declineReason || '',
    });
    if (sessionRow?.channel === 'whatsapp' && sessionRow?.whatsapp_phone) {
      await sendWhatsAppMessage({ to: sessionRow.whatsapp_phone, body: declinedBody });
    } else if (sessionRow?.channel === 'messenger' && sessionRow?.messenger_psid) {
      await sendMessengerMessage({ recipientId: sessionRow.messenger_psid, text: declinedBody });
    }
  } catch (e) {
    console.error('[moderate-ticket] notify decline failed:', e);
  }

  return NextResponse.json({ ok: true, status: 'cancelled' });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import {
  sendMessengerMessage,
  sendMessengerMessageWithTag,
  sendOneTimeNotification,
} from '@/lib/messenger';
import { tNotification } from '@/lib/messaging-commands';
import { getQueuePosition } from '@/lib/queue-position';

/**
 * POST /api/whatsapp-send
 *
 * Sends a notification for a ticket event via WhatsApp OR Messenger,
 * depending on which channel the session uses.
 *
 * Called from server actions and Postgres triggers.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth: accept service role key OR internal database trigger
    const authHeader = request.headers.get('authorization') ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const isServiceKey = serviceKey && authHeader.includes(serviceKey.substring(0, 20));
    const isInternalTrigger = authHeader === 'Bearer internal-trigger';
    if (!isServiceKey && !isInternalTrigger) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ticketId, event, deskName } = body as {
      ticketId: string;
      event: 'joined' | 'called' | 'recall' | 'buzz' | 'no_show' | 'served' | 'cancelled' | 'next_in_line';
      deskName: string;
    };

    if (!ticketId || !event) {
      return NextResponse.json({ error: 'Missing ticketId or event' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Look up ticket
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, ticket_number, qr_token, status')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      return NextResponse.json({ sent: false, reason: 'ticket not found' });
    }

    // Look up active session for this ticket (supports both WhatsApp and Messenger)
    const { data: session } = await (supabase as any)
      .from('whatsapp_sessions')
      .select('id, whatsapp_phone, messenger_psid, organization_id, locale, channel, otn_token')
      .eq('ticket_id', ticketId)
      .eq('state', 'active')
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ sent: false, reason: 'no active session' });
    }

    const channel = session.channel ?? 'whatsapp';
    const locale = (session.locale as 'fr' | 'ar' | 'en') || 'fr';

    // Build tracking URL
    const baseUrl = (
      process.env.APP_CLIP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://qflo.net'
    ).replace(/\/+$/, '');
    const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

    // Build localized message
    let message: string;
    let completeSession = false;
    const vars: Record<string, string> = { ticket: ticket.ticket_number, desk: deskName, url: trackUrl };

    switch (event) {
      case 'joined': {
        // Enrich with business name + queue position
        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', session.organization_id)
          .single();
        vars.name = org?.name ?? '';

        const pos = await getQueuePosition(ticketId);
        if (pos.position != null) {
          const wait = pos.estimated_wait_minutes != null ? ` | ⏱ ~*${pos.estimated_wait_minutes} min*` : '';
          vars.position = `📍 Position: *${pos.position}*${wait}`;
        } else {
          vars.position = '';
        }

        message = tNotification('joined', locale, vars);
        break;
      }
      case 'called':
        message = tNotification('called', locale, vars);
        break;
      case 'recall':
        message = tNotification('recall', locale, vars);
        break;
      case 'buzz':
        message = tNotification('buzz', locale, vars);
        break;
      case 'no_show':
        message = tNotification('no_show', locale, vars);
        completeSession = true;
        break;
      case 'served':
        message = tNotification('served', locale, vars);
        completeSession = true;
        break;
      case 'cancelled':
        message = tNotification('cancelled_notify', locale, vars);
        completeSession = true;
        break;
      case 'next_in_line':
        message = tNotification('next_in_line', locale, vars);
        break;
      default:
        message = tNotification('default', locale, vars);
    }

    console.log(`[whatsapp-send] Sending ${event} (${locale}) via ${channel} for ${ticket.ticket_number}`);

    let sent = false;
    let provider = channel;
    let error: string | undefined;
    let messageId: string | undefined;

    if (channel === 'messenger') {
      // ── Messenger dispatch ──
      const recipientId = session.messenger_psid;
      if (!recipientId) {
        return NextResponse.json({ sent: false, reason: 'no messenger PSID in session' });
      }

      // For terminal events outside 24h window, try OTN first, then message tag
      const isTerminal = ['no_show', 'served', 'cancelled'].includes(event);

      let result;
      if (isTerminal && session.otn_token) {
        // Use One-Time Notification token
        result = await sendOneTimeNotification({
          recipientId,
          text: message,
          otnToken: session.otn_token,
        });
        // Clear OTN token after use (single-use)
        if (result.ok) {
          await (supabase as any)
            .from('whatsapp_sessions')
            .update({ otn_token: null })
            .eq('id', session.id);
        }
      } else {
        // Try standard send first (within 24h), fallback to CONFIRMED_EVENT_UPDATE tag
        result = await sendMessengerMessage({ recipientId, text: message });
        if (!result.ok && result.error?.includes('outside')) {
          // Outside 24h window — use message tag
          result = await sendMessengerMessageWithTag({ recipientId, text: message });
        }
      }

      sent = result.ok;
      error = result.error;
      messageId = result.messageId;
    } else {
      // ── WhatsApp dispatch ──
      if (!session.whatsapp_phone) {
        return NextResponse.json({ sent: false, reason: 'no whatsapp phone in session' });
      }

      const result = await sendWhatsAppMessage({
        to: session.whatsapp_phone,
        body: message,
      });

      sent = result.ok;
      error = result.error;
      messageId = result.sid;
      provider = result.provider;
    }

    console.log(`[whatsapp-send] Result: sent=${sent}, provider=${provider}, error=${error}`);

    if (sent) {
      // Log notification
      try {
        await supabase.from('notifications').insert({
          ticket_id: ticketId,
          type: `${channel}_${event}` as any,
          channel: channel as any,
          payload: { messageId, provider, locale, channel },
          sent_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      // Complete session for terminal events
      if (completeSession) {
        await (supabase as any)
          .from('whatsapp_sessions')
          .update({ state: 'completed' })
          .eq('id', session.id);
      }
    }

    return NextResponse.json({ sent, provider, channel, error });
  } catch (err: any) {
    console.error('[whatsapp-send] Error:', err?.message ?? err);
    return NextResponse.json({ sent: false, error: err?.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import {
  sendMessengerMessage,
  sendMessengerMessageWithTag,
  sendOneTimeNotification,
} from '@/lib/messenger';
import { tNotification, formatPosition } from '@/lib/messaging-commands';
import { getQueuePosition } from '@/lib/queue-position';
import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

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
    // Auth: accept full service role key or webhook secret
    const authHeader = request.headers.get('authorization') ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';

    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const isServiceKey = serviceKey && safeCompare(bearerToken, serviceKey);
    const isWebhookSecret = webhookSecret && safeCompare(bearerToken, webhookSecret);
    // Legacy: accept 'internal-trigger' only if no INTERNAL_WEBHOOK_SECRET is configured (migration period)
    const isLegacyTrigger = !webhookSecret && bearerToken === 'internal-trigger';

    if (!isServiceKey && !isWebhookSecret && !isLegacyTrigger) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isLegacyTrigger) {
      console.warn('[whatsapp-send] DEPRECATED: using legacy internal-trigger auth. Set INTERNAL_WEBHOOK_SECRET env var.');
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

    // Look up ticket (include customer_data for personalized greeting)
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, ticket_number, qr_token, status, customer_data')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      return NextResponse.json({ sent: false, reason: 'ticket not found' });
    }

    // Look up active session for this ticket (supports both WhatsApp and Messenger)
    // Use .limit(1) instead of .maybeSingle() to handle duplicate sessions gracefully
    const { data: sessions } = await (supabase as any)
      .from('whatsapp_sessions')
      .select('id, whatsapp_phone, whatsapp_bsuid, messenger_psid, organization_id, locale, channel, otn_token')
      .eq('ticket_id', ticketId)
      .eq('state', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const session = sessions?.[0] ?? null;

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
        vars.position = formatPosition(pos, locale);

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
      case 'no_show': {
        const { data: noShowOrg } = await supabase
          .from('organizations').select('name').eq('id', session.organization_id).single();
        vars.name = noShowOrg?.name ?? '';
        message = tNotification('no_show', locale, vars);
        completeSession = true;
        break;
      }
      case 'served': {
        const { data: servedOrg } = await supabase
          .from('organizations').select('name').eq('id', session.organization_id).single();
        vars.name = servedOrg?.name ?? '';
        message = tNotification('served', locale, vars);
        completeSession = true;
        break;
      }
      case 'cancelled': {
        const { data: cancelOrg } = await supabase
          .from('organizations').select('name').eq('id', session.organization_id).single();
        vars.name = cancelOrg?.name ?? '';
        message = tNotification('cancelled_notify', locale, vars);
        completeSession = true;
        break;
      }
      case 'next_in_line':
        message = tNotification('next_in_line', locale, vars);
        break;
      default:
        message = tNotification('default', locale, vars);
    }

    // ── Duplicate notification prevention ──
    const notifType = `${channel}_${event}`;
    const { data: recentNotif } = await supabase
      .from('notifications')
      .select('id')
      .eq('ticket_id', ticketId)
      .eq('type', notifType as any)
      .gte('sent_at', new Date(Date.now() - 60_000).toISOString())
      .limit(1)
      .maybeSingle();

    if (recentNotif) {
      console.log(`[whatsapp-send] Duplicate suppressed: ${notifType} for ${ticket.ticket_number}`);
      return NextResponse.json({ sent: false, reason: 'duplicate suppressed' });
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
      // Phone is primary; BSUID is stored but not yet usable for sending
      // (Meta enables BSUID-based sending via `recipient` field in May 2026)
      if (!session.whatsapp_phone) {
        console.warn(`[whatsapp-send] No phone for session, bsuid=***${(session.whatsapp_bsuid ?? '').slice(-4) || 'none'} — cannot send yet (BSUID sending available May 2026)`);
        return NextResponse.json({ sent: false, reason: 'no whatsapp phone in session (username adopter without phone — BSUID sending not yet available)' });
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

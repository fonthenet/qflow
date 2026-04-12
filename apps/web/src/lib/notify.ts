import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { renderNotification, type Locale } from '@qflo/shared';
import { APP_BASE_URL } from '@/lib/config';

// ── Types ──────────────────────────────────────────────────────────

export type NotifyEvent =
  | 'called'
  | 'recall'
  | 'buzz'
  | 'serving'
  | 'served'
  | 'no_show'
  | 'cancelled_notify'
  | 'next_in_line'
  | 'approaching'
  | 'position_update';

export interface NotifyResult {
  sent: boolean;
  channel: 'whatsapp' | 'messenger' | null;
  error?: string;
}

export interface NotifyOpts {
  /** Pre-resolved org name (avoids extra DB query) */
  orgName?: string;
  /** Desk name (for called/recall/buzz/serving) */
  deskName?: string;
  /** Estimated wait minutes */
  waitMinutes?: number;
  /** Queue position number */
  position?: number;
  /** Ticket tracking URL */
  trackUrl?: string;
  /** Skip notification flag (e.g. already sent via direct API) */
  skipNotification?: boolean;
}

/**
 * Send a customer notification for a ticket event.
 *
 * Single source of truth for all WhatsApp/Messenger notifications.
 * Never throws — returns `{ sent: false, error }` on failure.
 *
 * @param ticketId  The ticket UUID
 * @param event     Notification event type
 * @param opts      Additional options (orgName, deskName, etc.)
 * @returns         Result with sent status and channel used
 */
export async function notifyCustomer(
  ticketId: string,
  event: NotifyEvent,
  opts: NotifyOpts = {},
): Promise<NotifyResult> {
  if (opts.skipNotification) {
    return { sent: false, channel: null, error: 'skipped' };
  }

  const supabase = createAdminClient() as any;

  try {
    // Fetch ticket
    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .select('id, ticket_number, qr_token, locale, office_id')
      .eq('id', ticketId)
      .single();

    if (ticketErr || !ticket) {
      return { sent: false, channel: null, error: 'ticket_not_found' };
    }

    // Find the active session for this ticket
    const { data: sessions } = await supabase
      .from('whatsapp_sessions')
      .select('id, channel, whatsapp_phone, messenger_psid, locale, organization_id')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1);

    const session = sessions?.[0];
    if (!session) {
      return { sent: false, channel: null, error: 'no_session' };
    }

    // Resolve org name if not provided
    let orgName = opts.orgName ?? '';
    if (!orgName) {
      try {
        const { data: org } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', session.organization_id)
          .single();
        orgName = org?.name ?? '';
      } catch { /* ignore */ }
    }

    // Resolve locale
    const locale: Locale = (ticket.locale as Locale) || (session.locale as Locale) || 'fr';

    // Build tracking URL
    const trackUrl = opts.trackUrl || `${APP_BASE_URL}/q/${ticket.qr_token}`;

    // Render message
    const messageBody = renderNotification(event, locale, {
      name: orgName,
      ticket: ticket.ticket_number,
      desk: opts.deskName || '?',
      wait: opts.waitMinutes != null ? String(opts.waitMinutes) : '1',
      position: opts.position != null ? String(opts.position) : '',
      url: trackUrl,
    });

    // Send via appropriate channel
    if (session.channel === 'whatsapp' && session.whatsapp_phone) {
      await sendWhatsAppMessage({ to: session.whatsapp_phone, body: messageBody });
      return { sent: true, channel: 'whatsapp' };
    } else if (session.channel === 'messenger' && session.messenger_psid) {
      await sendMessengerMessage({ recipientId: session.messenger_psid, text: messageBody });
      return { sent: true, channel: 'messenger' };
    }

    return { sent: false, channel: null, error: 'no_channel_info' };
  } catch (e: any) {
    console.error(`[notify] Failed for ticket ${ticketId} event=${event}:`, e?.message);
    return { sent: false, channel: null, error: e?.message || String(e) };
  }
}

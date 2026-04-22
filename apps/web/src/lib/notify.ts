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
  | 'table_changed'
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

    // Find the session for this ticket.
    // Prefer an active session; fall back to the most recent of any state,
    // since some events (e.g. served) are emitted after the row has been
    // flipped to 'completed' by other paths.
    const { data: activeSessions } = await supabase
      .from('whatsapp_sessions')
      .select('id, channel, whatsapp_phone, messenger_psid, locale, organization_id, office_id')
      .eq('ticket_id', ticketId)
      .eq('state', 'active')
      .order('created_at', { ascending: false })
      .limit(1);

    let session = activeSessions?.[0];
    if (!session) {
      const { data: anySessions } = await supabase
        .from('whatsapp_sessions')
        .select('id, channel, whatsapp_phone, messenger_psid, locale, organization_id, office_id')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1);
      session = anySessions?.[0];
    }
    if (!session) {
      return { sent: false, channel: null, error: 'no_session' };
    }

    // ── Org name resolution — multi-stage cascade ───────────────────
    // Stage 1: caller-provided (fastest, most explicit)
    // Stage 2: organizations table via session.organization_id
    // Stage 3: organizations table via ticket.office_id → offices.organization_id
    //          (covers cases where the session's org_id points at a deleted/
    //           wrong row but the ticket's office still resolves)
    // Stage 4: offices.name by ticket.office_id (the venue name is a decent
    //          stand-in when the org name isn't available)
    // Stage 5: i18n default ("our service" / "notre service" / "خدمتنا")
    //
    // Any fallback beyond Stage 1 is logged so ops can spot stale data.
    let orgName = (opts.orgName ?? '').trim();
    let orgNameSource: 'opts' | 'session-org' | 'office-org' | 'office-name' | 'default' = 'opts';
    if (!orgName) {
      orgNameSource = 'session-org';
      try {
        const { data: org, error } = await supabase
          .from('organizations')
          .select('name')
          .eq('id', session.organization_id)
          .single();
        if (error) {
          console.warn(`[notify] org lookup by session.organization_id=${session.organization_id} failed:`, error.message);
        }
        orgName = (org?.name ?? '').trim();
      } catch (e: any) {
        console.warn(`[notify] org lookup by session.organization_id threw:`, e?.message);
      }
    }
    if (!orgName && ticket.office_id) {
      orgNameSource = 'office-org';
      try {
        const { data: office } = await supabase
          .from('offices')
          .select('name, organization_id, organizations:organization_id(name)')
          .eq('id', ticket.office_id)
          .single();
        const officeOrgName = (office?.organizations as any)?.name;
        orgName = (officeOrgName ?? '').trim();
        if (!orgName && office?.name) {
          orgNameSource = 'office-name';
          orgName = office.name.trim();
        }
      } catch (e: any) {
        console.warn(`[notify] office→org lookup threw:`, e?.message);
      }
    }
    if (!orgName) {
      // Localized default — never leave WhatsApp template with empty `{name}`.
      const defaults: Record<string, string> = {
        fr: 'notre service',
        ar: 'خدمتنا',
        en: 'our service',
      };
      const lang = ((ticket.locale as string) || (session.locale as string) || 'fr').slice(0, 2);
      orgName = defaults[lang] ?? defaults.fr;
      orgNameSource = 'default';
      console.warn(
        `[notify] orgName fell back to default for ticket ${ticketId} ` +
        `(session_id=${session.id} organization_id=${session.organization_id}). ` +
        `Check whether the organizations row exists and has a non-empty name.`,
      );
    } else if (orgNameSource !== 'opts') {
      // Lower-priority diagnostic so we can surface drift without alerting
      console.info(`[notify] orgName resolved via ${orgNameSource} for ticket ${ticketId}`);
    }

    // Resolve locale
    const locale: Locale = (ticket.locale as Locale) || (session.locale as Locale) || 'fr';

    // Build tracking URL
    const trackUrl = opts.trackUrl || `${APP_BASE_URL}/q/${ticket.qr_token}`;

    // Format current date/time for locale
    const now = new Date();
    const dateStr = now.toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Render message
    const messageBody = renderNotification(event, locale, {
      name: orgName,
      ticket: ticket.ticket_number,
      desk: opts.deskName || '?',
      wait: opts.waitMinutes != null ? String(opts.waitMinutes) : '1',
      position: opts.position != null ? String(opts.position) : '',
      url: trackUrl,
      date: dateStr,
      time: timeStr,
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

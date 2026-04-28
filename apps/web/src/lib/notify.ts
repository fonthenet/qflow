import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessage } from '@/lib/messenger';
import { renderNotification, resolveRestaurantServiceType, type Locale } from '@qflo/shared';
import { APP_BASE_URL } from '@/lib/config';
import { getCountryConfig, resolveLocale } from '@/lib/country';
// ── Receipt block for 'served' ─────────────────────────────────────

const RECEIPT_LABELS: Record<Locale, {
  title: string; total: string; cashGiven: string; change: string;
  paidCard: string; paidOther: string;
}> = {
  fr: {
    title: '🧾 Récapitulatif',
    total: 'Total',
    cashGiven: 'Espèces reçues',
    change: 'Monnaie rendue',
    paidCard: 'Payé par carte',
    paidOther: 'Payé',
  },
  ar: {
    title: '🧾 ملخص الطلب',
    total: 'المجموع',
    cashGiven: 'المبلغ المستلم نقداً',
    change: 'الباقي',
    paidCard: 'الدفع بالبطاقة',
    paidOther: 'مدفوع',
  },
  en: {
    title: '🧾 Order summary',
    total: 'Total',
    cashGiven: 'Cash given',
    change: 'Change',
    paidCard: 'Paid by card',
    paidOther: 'Paid',
  },
};

// Customer-facing money: always DA, 2 decimals, thin-space grouping, comma
// decimal (Algerian bank style). Keep trailing zeros — consistent is better
// than "clever" rounding for a transaction record.
function fmtDA(amount: number): string {
  if (!isFinite(amount)) return '0,00 DA';
  const [intPart, decPart] = amount.toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  return `${grouped},${decPart} DA`;
}

async function buildReceiptBlock(supabase: any, ticketId: string, locale: Locale): Promise<string | null> {
  const L = RECEIPT_LABELS[locale] ?? RECEIPT_LABELS.fr;

  const [{ data: items }, { data: payments }] = await Promise.all([
    supabase.from('ticket_items')
      .select('name, qty, price')
      .eq('ticket_id', ticketId)
      .order('added_at', { ascending: true }),
    supabase.from('ticket_payments')
      .select('method, amount, tendered, change_given')
      .eq('ticket_id', ticketId)
      .order('paid_at', { ascending: true }),
  ]);

  const hasItems = Array.isArray(items) && items.length > 0;
  const hasPayment = Array.isArray(payments) && payments.length > 0;
  if (!hasItems && !hasPayment) return null;

  const lines: string[] = [`*${L.title}*`];

  if (hasItems) {
    for (const it of items) {
      const price = Number(it.price ?? 0);
      const line = price * Number(it.qty);
      const right = price > 0 ? `  ${fmtDA(line)}` : '';
      lines.push(`• ${it.qty}× ${it.name}${right}`);
    }
  }

  const itemsTotal = hasItems
    ? items.reduce((s: number, it: any) => s + Number(it.price ?? 0) * Number(it.qty), 0)
    : 0;
  const paidTotal = hasPayment
    ? payments.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0)
    : 0;
  const totalForDisplay = itemsTotal > 0 ? itemsTotal : paidTotal;

  if (totalForDisplay > 0) {
    lines.push(`*${L.total}: ${fmtDA(totalForDisplay)}*`);
  }

  if (hasPayment) {
    const p = payments[0];
    const methodKey = (p.method ?? 'cash').toLowerCase();
    const amount = Number(p.amount ?? 0);
    const tendered = p.tendered != null ? Number(p.tendered) : null;
    const change = Number(p.change_given ?? 0);

    if (methodKey === 'cash') {
      // For cash, the customer cares about what they handed over and what
      // came back. If the operator didn't record tendered, fall back to
      // the amount so we still show something meaningful.
      const given = tendered != null && tendered > 0 ? tendered : amount;
      lines.push(`${L.cashGiven}: ${fmtDA(given)}`);
      if (change > 0) lines.push(`${L.change}: ${fmtDA(change)}`);
    } else if (methodKey === 'card') {
      lines.push(`${L.paidCard}: ${fmtDA(amount)}`);
    } else {
      lines.push(`${L.paidOther}: ${fmtDA(amount)}`);
    }
  }

  return lines.join('\n');
}

// ── Types ──────────────────────────────────────────────────────────

export type NotifyEvent =
  | 'called'
  | 'recall'
  | 'buzz'
  | 'table_changed'
  | 'serving'
  | 'ready'
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
    // Fetch ticket (include service_id for service-type branching on ready/served,
    // and source so we can suppress queue-flow templates on online orders).
    const { data: ticket, error: ticketErr } = await supabase
      .from('tickets')
      .select('id, ticket_number, qr_token, locale, office_id, service_id, source')
      .eq('id', ticketId)
      .single();

    if (ticketErr || !ticket) {
      return { sent: false, channel: null, error: 'ticket_not_found' };
    }

    // ── Online-order guard: skip queue-flow templates ─────────────────
    // Online restaurant orders (source whatsapp/web with takeout/delivery)
    // get their own customer-facing copy directly from /api/orders/* —
    // we explicitly DON'T want the queue-style "service has started at
    // floor" or "you've been called" messages bouncing in alongside.
    // Order-specific events (order_received/accepted/etc) aren't routed
    // through this function, so we only need to filter the queue ones.
    const isOnlineOrder = ticket.source === 'whatsapp' || ticket.source === 'web';
    if (isOnlineOrder) {
      const queueOnlyEvents = new Set(['called', 'serving', 'recall', 'transferred', 'position_update']);
      if (queueOnlyEvents.has(event as string)) {
        // Try to detect takeout / delivery via service name. If we can't,
        // err on the side of suppressing — restaurant tickets explicitly
        // marked dine-in still hit notifyCustomer through other paths.
        try {
          const { data: svc } = await supabase
            .from('services').select('name').eq('id', ticket.service_id).maybeSingle();
          const { resolveRestaurantServiceType } = await import('@qflo/shared');
          const t = resolveRestaurantServiceType(svc?.name ?? '');
          if (t === 'takeout' || t === 'delivery') {
            return { sent: false, channel: null, error: 'suppressed_for_online_order' };
          }
        } catch {
          // Conservative fallback: skip the queue-flow message anyway.
          return { sent: false, channel: null, error: 'suppressed_for_online_order' };
        }
      }
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
    // Also collect org.locale_primary + country for the locale cascade below —
    // piggyback on the lookups we were doing anyway for orgName so we don't
    // hit the DB twice.
    let orgLocalePrimary: string | null = null;
    let orgCountry: string | null = null;

    let orgName = (opts.orgName ?? '').trim();
    let orgNameSource: 'opts' | 'session-org' | 'office-org' | 'office-name' | 'default' = 'opts';
    if (!orgName) {
      orgNameSource = 'session-org';
      try {
        const { data: org, error } = await supabase
          .from('organizations')
          .select('name, locale_primary, country')
          .eq('id', session.organization_id)
          .single();
        if (error) {
          console.warn(`[notify] org lookup by session.organization_id=${session.organization_id} failed:`, error.message);
        }
        orgName = (org?.name ?? '').trim();
        orgLocalePrimary = (org?.locale_primary as string | null) ?? null;
        orgCountry = (org?.country as string | null) ?? null;
      } catch (e: any) {
        console.warn(`[notify] org lookup by session.organization_id threw:`, e?.message);
      }
    }
    if (!orgName && ticket.office_id) {
      orgNameSource = 'office-org';
      try {
        const { data: office } = await supabase
          .from('offices')
          .select('name, organization_id, organizations:organization_id(name, locale_primary, country)')
          .eq('id', ticket.office_id)
          .single();
        const officeOrg = (office?.organizations as any);
        const officeOrgName = officeOrg?.name;
        orgName = (officeOrgName ?? '').trim();
        orgLocalePrimary = orgLocalePrimary ?? (officeOrg?.locale_primary ?? null);
        orgCountry = orgCountry ?? (officeOrg?.country ?? null);
        if (!orgName && office?.name) {
          orgNameSource = 'office-name';
          orgName = office.name.trim();
        }
      } catch (e: any) {
        console.warn(`[notify] office→org lookup threw:`, e?.message);
      }
    }
    // Resolve locale — full cascade:
    //   ticket.locale > session.locale > org.locale_primary > country default > 'en'
    // The ticket wins when the customer already picked a language (kiosk tap,
    // WhatsApp greeting detection). When nothing is known about the customer
    // we respect the business's Primary Locale setting instead of hardcoding.
    const countryConfig = orgCountry
      ? await getCountryConfig(supabase, orgCountry).catch(() => null)
      : null;
    const locale: Locale = resolveLocale(
      (ticket.locale as string | null) ?? (session.locale as string | null),
      orgLocalePrimary,
      countryConfig,
    ).slice(0, 2) as Locale;

    if (!orgName) {
      // Localized default — never leave WhatsApp template with empty `{name}`.
      const defaults: Record<string, string> = {
        fr: 'notre service',
        ar: 'خدمتنا',
        en: 'our service',
      };
      orgName = defaults[locale] ?? defaults.fr;
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

    // Build tracking URL
    const trackUrl = opts.trackUrl || `${APP_BASE_URL}/q/${ticket.qr_token}`;

    // Format current date/time for locale
    const now = new Date();
    const dateStr = now.toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit', hour12: false });

    // Resolve service type for ready/served branching.
    // Fetch service name once, only when needed — avoids a DB hit for other events.
    let resolvedServiceType: ReturnType<typeof resolveRestaurantServiceType> = 'other';
    if ((event === 'ready' || event === 'served') && ticket.service_id) {
      try {
        const { data: svcRow } = await supabase
          .from('services')
          .select('name')
          .eq('id', ticket.service_id)
          .single();
        if (svcRow?.name) {
          resolvedServiceType = resolveRestaurantServiceType(svcRow.name);
        }
      } catch {
        // Non-fatal — falls back to generic template
      }
    }

    // Pick the service-aware template key for ready/served.
    // For all other events the key equals the event name unchanged.
    let templateKey: string = event;
    if (event === 'ready') {
      if (resolvedServiceType === 'takeout')  templateKey = 'ready_takeout';
      else if (resolvedServiceType === 'delivery') templateKey = 'ready_delivery';
      else templateKey = 'ready_dine_in'; // dine_in or other → generic
    } else if (event === 'served') {
      if (resolvedServiceType === 'takeout')  templateKey = 'served_takeout';
      else if (resolvedServiceType === 'delivery') templateKey = 'served_delivery';
      else templateKey = 'served_dine_in'; // dine_in or other → keep existing behaviour
    }

    // Render message
    let messageBody = renderNotification(templateKey, locale, {
      name: orgName,
      ticket: ticket.ticket_number,
      desk: opts.deskName || '?',
      wait: opts.waitMinutes != null ? String(opts.waitMinutes) : '1',
      position: opts.position != null ? String(opts.position) : '',
      url: trackUrl,
      date: dateStr,
      time: timeStr,
    });

    // For a completed visit, append a short receipt block so the customer
    // has a record of what they ordered and paid. We always render money
    // in DA (2 decimals, bank-style) for customer-facing messages — the
    // centimes/dinar station pref is an operator convenience and doesn't
    // belong in the receipt the customer keeps.
    if (event === 'served') {
      try {
        const block = await buildReceiptBlock(supabase, ticketId, locale);
        if (block) messageBody += '\n\n' + block;
      } catch (e: any) {
        console.warn(`[notify] receipt block failed for ticket ${ticketId}:`, e?.message);
      }

      // If the org accepts cash, append a single locale-aware line so the
      // customer knows before they arrive. Best-effort — never blocks.
      if (session.organization_id) {
        try {
          const { data: orgRow } = await supabase
            .from('organizations')
            .select('accepts_cash')
            .eq('id', session.organization_id)
            .single();
          if (orgRow?.accepts_cash) {
            const cashLine: Record<string, string> = {
              fr: '💵 *Espèces acceptées* sur place',
              ar: '💵 *يُقبل الدفع نقداً* في المكان',
              en: '💵 *Cash accepted* on-site',
            };
            messageBody += '\n\n' + (cashLine[locale] ?? cashLine.fr);
          }
        } catch (e: any) {
          console.warn(`[notify] accepts_cash lookup failed for ticket ${ticketId}:`, e?.message);
        }
      }
    }

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

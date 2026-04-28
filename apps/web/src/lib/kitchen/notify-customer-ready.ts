import 'server-only';

import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { resolveRestaurantServiceType } from '@qflo/shared';

/**
 * Send the customer a "your order is ready" WhatsApp message when the
 * kitchen flips the last item to `ready`. Called from every code path
 * that detects the all-items-ready transition:
 *   - apps/web/src/app/(public)/kitchen/[screenToken]/actions.ts
 *   - apps/web/src/app/api/kitchen/update-item-status/route.ts
 *   - apps/web/src/app/api/kitchen/bulk-update-ticket/route.ts
 *
 * Filters:
 *   - Only fires for tickets that came from `whatsapp` or `web` (online
 *     orders). Walk-in tickets where the customer is physically present
 *     and the operator already shouted "ready" don't need a chat ping.
 *   - Only fires for restaurant service types `takeout` and `delivery`.
 *     Dine-in customers are at a table — the server brings the food.
 *
 * Best-effort: WhatsApp send failures must never roll back the kitchen
 * status update or the in-app notification insert. The caller catches.
 *
 * Locale-aware FR / AR / EN, derived from `tickets.locale`.
 */
export async function notifyCustomerOnKitchenReady(
  supabase: any,
  ticketId: string,
): Promise<void> {
  // Load the ticket's source, locale, customer phone, service, office.
  const { data: ticket, error: tkErr } = await supabase
    .from('tickets')
    .select('id, ticket_number, source, locale, customer_data, service_id, office_id, organization_id')
    .eq('id', ticketId)
    .maybeSingle();
  if (tkErr || !ticket) return;

  // Online orders only. Walk-in / kiosk / mobile_app tickets handle this
  // operator-side (the kitchen counter calls the customer's number out
  // loud, the buzzer goes off, etc.).
  if (ticket.source !== 'whatsapp' && ticket.source !== 'web') return;

  const customerData = (ticket.customer_data ?? {}) as Record<string, any>;
  const phone: string | null = typeof customerData.phone === 'string' ? customerData.phone : null;
  if (!phone) return;

  // Resolve service type. Pull the service name once to classify; this
  // is the same regex catalog used by Station and the order page so the
  // customer's "takeout vs delivery" intent is preserved end-to-end.
  let serviceType: 'takeout' | 'delivery' | 'dine_in' | 'other' = 'other';
  if (ticket.service_id) {
    const { data: svc } = await supabase
      .from('services').select('name').eq('id', ticket.service_id).maybeSingle();
    serviceType = resolveRestaurantServiceType(svc?.name ?? '');
  }
  // Dine-in customers don't get this message (they're at the table).
  if (serviceType !== 'takeout' && serviceType !== 'delivery') return;

  // Office name for the message body — branded so the customer knows
  // exactly which restaurant just told them their food is up.
  const { data: office } = await supabase
    .from('offices').select('name, timezone').eq('id', ticket.office_id).maybeSingle();
  const officeName: string = office?.name ?? '';
  const timezone: string | null = office?.timezone ?? null;

  const locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
    ? ticket.locale
    : 'fr';
  const ticketNumber = ticket.ticket_number ?? '';

  let body: string;
  if (serviceType === 'takeout') {
    if (locale === 'ar') {
      body = `🍽️ طلبك *#${ticketNumber}* جاهز للاستلام في *${officeName}*.\n\nيمكنك الآن المرور لاستلام طلبك. شكرًا!`;
    } else if (locale === 'en') {
      body = `🍽️ Your order *#${ticketNumber}* is *ready for pickup* at *${officeName}*.\n\nCome by whenever you're ready. Thanks!`;
    } else {
      body = `🍽️ Votre commande *#${ticketNumber}* est *prête à emporter* chez *${officeName}*.\n\nPassez la récupérer quand vous voulez. Merci !`;
    }
  } else {
    // delivery
    if (locale === 'ar') {
      body = `🛵 طلبك *#${ticketNumber}* جاهز وسيتم توصيله قريبًا. شكرًا لاختياركم *${officeName}*!`;
    } else if (locale === 'en') {
      body = `🛵 Your order *#${ticketNumber}* is *ready* and will be delivered soon. Thanks for choosing *${officeName}*!`;
    } else {
      body = `🛵 Votre commande *#${ticketNumber}* est *prête* et sera livrée sous peu. Merci d'avoir choisi *${officeName}* !`;
    }
  }

  try {
    await sendWhatsAppMessage({ to: phone, body, timezone: timezone ?? undefined });
  } catch (err) {
    console.warn('[notify-customer-ready] WA send failed', { ticketId, error: (err as any)?.message });
  }
}

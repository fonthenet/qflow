'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Customer-facing tracking page for online restaurant orders.
 *
 * Drop-in replacement for QueueStatus when the ticket is an online
 * order (source whatsapp / web) and the resolved service type is
 * takeout or delivery. Renders a status-aware UI:
 *
 *   pending_approval     →  ⏳  "Order received — waiting for restaurant"
 *   serving (not dispatched, not delivered)
 *     - delivery         →  👨‍🍳  "Being prepared in the kitchen"
 *     - takeout          →  👨‍🍳  "Being prepared — we'll let you know"
 *   serving + dispatched →  🛵  "Out for delivery"      (driver info)
 *   served (delivered_at set)
 *     - delivery         →  ✅  "Delivered — enjoy!"
 *     - takeout          →  ✅  "Ready for pickup"
 *   cancelled            →  ❌  "Cancelled" + reason from notes
 *
 * Subscribes to Supabase realtime on `tickets` for the current ticket id
 * so the page flips automatically when the operator dispatches / marks
 * delivered without the customer having to refresh.
 *
 * Locale: ar / fr / en, derived from server-resolved value passed in.
 */

type Locale = 'ar' | 'fr' | 'en';

export interface OrderStatusProps {
  initialTicket: {
    id: string;
    ticket_number: string;
    status: string;
    qr_token: string;
    created_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    dispatched_at: string | null;
    delivered_at: string | null;
    notes: string | null;
    customer_data: Record<string, any> | null;
    delivery_address: Record<string, any> | null;
    assigned_rider_id: string | null;
  };
  /** Pre-resolved on the server: 'delivery' | 'takeout'. */
  serviceMode: 'delivery' | 'takeout';
  /** Locale-aware copy. */
  locale: Locale;
  organizationName: string;
  officeName: string;
  /** Total in DA / currency-of-org, server-computed from ticket_items. */
  totalDisplay: string | null;
  itemCount: number;
  items: Array<{ id: string; name: string; qty: number; line_total: string | null }>;
  /** Pre-resolved when assigned_rider_id is set. */
  rider: { full_name: string | null; phone: string | null } | null;
  /** Public anon key + URL for the realtime subscription. */
  supabaseUrl: string;
  supabaseAnonKey: string;
}

function tr(locale: Locale, en: string, fr: string, ar: string): string {
  return locale === 'ar' ? ar : locale === 'fr' ? fr : en;
}

function formatTimeAgo(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return tr(locale, 'just now', "à l'instant", 'الآن');
  if (min < 60) return tr(locale, `${min} min ago`, `il y a ${min} min`, `منذ ${min} د`);
  const hr = Math.floor(min / 60);
  return tr(locale, `${hr}h ago`, `il y a ${hr}h`, `منذ ${hr}س`);
}

export default function OrderStatus(props: OrderStatusProps) {
  const [ticket, setTicket] = useState(props.initialTicket);
  const { serviceMode, locale, organizationName, officeName, items, totalDisplay, itemCount, rider } = props;

  // ── Realtime: flip the page as operator dispatches / delivers ────
  useEffect(() => {
    let unsubFn: (() => void) | null = null;
    try {
      const sb = createBrowserClient(props.supabaseUrl, props.supabaseAnonKey);
      const channel = sb
        .channel(`order-track-${ticket.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticket.id}` },
          (payload) => {
            const next = payload.new as any;
            setTicket((prev) => ({
              ...prev,
              status: next.status ?? prev.status,
              dispatched_at: next.dispatched_at ?? prev.dispatched_at,
              delivered_at: next.delivered_at ?? prev.delivered_at,
              cancelled_at: next.cancelled_at ?? prev.cancelled_at,
              completed_at: next.completed_at ?? prev.completed_at,
              notes: next.notes ?? prev.notes,
              assigned_rider_id: next.assigned_rider_id ?? prev.assigned_rider_id,
            }));
          },
        )
        .subscribe();
      unsubFn = () => { try { sb.removeChannel(channel); } catch {} };
    } catch (e) {
      console.warn('[OrderStatus] realtime subscribe failed', e);
    }
    return () => unsubFn?.();
  }, [ticket.id, props.supabaseUrl, props.supabaseAnonKey]);

  // ── Status resolution ────────────────────────────────────────────
  const isDispatched = Boolean(ticket.dispatched_at);
  const isDelivered = Boolean(ticket.delivered_at);
  const isCancelled = ticket.status === 'cancelled' || ticket.status === 'no_show';
  const isPending = ticket.status === 'pending_approval';
  const isServing = ticket.status === 'serving';
  const isServed = ticket.status === 'served';

  // Map link from delivery_address.lat/lng — same universal Google
  // Maps query URL we use on Station; opens GMaps on Android, Apple
  // Maps on iOS, Google Maps web on desktop.
  const da = ticket.delivery_address;
  const lat = typeof da?.lat === 'number' ? da.lat : null;
  const lng = typeof da?.lng === 'number' ? da.lng : null;
  const mapsHref = lat != null && lng != null
    ? `https://www.google.com/maps/?q=${encodeURIComponent(`${lat},${lng}`)}`
    : null;

  // Tone-aware top banner: which big icon + headline applies right now.
  const banner = useMemo(() => {
    if (isCancelled) return {
      emoji: '❌',
      tint: '#ef4444',
      title: tr(locale, 'Order cancelled', 'Commande annulée', 'تم إلغاء الطلب'),
      body: ticket.notes
        ? ticket.notes
        : tr(locale, 'This order was cancelled.', 'Cette commande a été annulée.', 'تم إلغاء هذا الطلب.'),
    };
    if (isPending) return {
      emoji: '⏳',
      tint: '#f59e0b',
      title: tr(locale, 'Order received', 'Commande reçue', 'تم استلام الطلب'),
      body: tr(locale,
        `${organizationName} is reviewing your order. You'll be notified as soon as it's accepted.`,
        `${organizationName} examine votre commande. Vous serez notifié dès qu'elle est acceptée.`,
        `${organizationName} يراجع طلبك. سنُعلمك بمجرد قبوله.`,
      ),
    };
    if (isServed && isDelivered && serviceMode === 'delivery') return {
      emoji: '✅',
      tint: '#22c55e',
      title: tr(locale, 'Delivered — enjoy!', 'Livré — bon appétit !', 'تم التوصيل — شهية طيبة!'),
      body: tr(locale,
        `Your order arrived ${formatTimeAgo(ticket.delivered_at, locale)}.`,
        `Votre commande est arrivée ${formatTimeAgo(ticket.delivered_at, locale)}.`,
        `وصل طلبك ${formatTimeAgo(ticket.delivered_at, locale)}.`,
      ),
    };
    if (isServed && serviceMode === 'takeout') return {
      emoji: '✅',
      tint: '#22c55e',
      title: tr(locale, 'Ready for pickup', 'Prêt à emporter', 'جاهز للاستلام'),
      body: tr(locale,
        `Come by ${officeName} whenever you're ready.`,
        `Passez chez ${officeName} quand vous voulez.`,
        `يمكنك المرور على ${officeName} في أي وقت.`,
      ),
    };
    if (isDispatched && serviceMode === 'delivery') return {
      emoji: '🛵',
      tint: '#3b82f6',
      title: tr(locale, 'Out for delivery', 'En cours de livraison', 'في الطريق إليك'),
      body: rider?.full_name
        ? tr(locale,
            `Your driver ${rider.full_name} is on the way.`,
            `Votre livreur ${rider.full_name} est en route.`,
            `السائق ${rider.full_name} في الطريق إليك.`,
          )
        : tr(locale,
            'A driver is on the way to you.',
            'Un livreur est en route.',
            'السائق في الطريق إليك.',
          ),
    };
    if (isServing) return {
      emoji: '👨‍🍳',
      tint: '#8b5cf6',
      title: tr(locale, 'Being prepared', 'En préparation', 'قيد التحضير'),
      body: serviceMode === 'delivery'
        ? tr(locale,
            `${organizationName} is cooking. We'll notify you when it's out for delivery.`,
            `${organizationName} prépare votre commande. Nous vous préviendrons au départ du livreur.`,
            `${organizationName} يحضّر طلبك. سنُعلمك عند مغادرة السائق.`,
          )
        : tr(locale,
            `${organizationName} is preparing your order. We'll notify you when it's ready for pickup.`,
            `${organizationName} prépare votre commande. Nous vous préviendrons quand elle est prête.`,
            `${organizationName} يحضّر طلبك. سنُعلمك عندما يصبح جاهزًا.`,
          ),
    };
    return {
      emoji: 'ℹ️',
      tint: '#64748b',
      title: tr(locale, 'Order status', 'Statut de la commande', 'حالة الطلب'),
      body: ticket.status,
    };
  }, [isCancelled, isPending, isServed, isDelivered, isDispatched, isServing, serviceMode, locale, ticket.notes, organizationName, officeName, rider, ticket.status, ticket.delivered_at]);

  // Lifecycle timeline (tick boxes). Renders a simple vertical step
  // indicator so the customer can see how far along their order is.
  const steps = useMemo(() => {
    const isDeliv = serviceMode === 'delivery';
    const arr: Array<{ key: string; label: string; reached: boolean; current: boolean }> = [
      {
        key: 'received',
        label: tr(locale, 'Order received', 'Commande reçue', 'تم استلام الطلب'),
        reached: true,
        current: isPending,
      },
      {
        key: 'accepted',
        label: tr(locale, 'Accepted by restaurant', 'Acceptée par le restaurant', 'قبول من المطعم'),
        reached: !isPending && !isCancelled,
        current: isServing && !isDispatched,
      },
    ];
    if (isDeliv) {
      arr.push({
        key: 'dispatched',
        label: tr(locale, 'Out for delivery', 'En route', 'في الطريق'),
        reached: isDispatched || isDelivered,
        current: isDispatched && !isDelivered,
      });
      arr.push({
        key: 'delivered',
        label: tr(locale, 'Delivered', 'Livrée', 'تم التوصيل'),
        reached: isDelivered,
        current: isDelivered,
      });
    } else {
      arr.push({
        key: 'ready',
        label: tr(locale, 'Ready for pickup', 'Prête à emporter', 'جاهز للاستلام'),
        reached: isServed,
        current: isServed,
      });
    }
    return arr;
  }, [serviceMode, locale, isPending, isCancelled, isServing, isDispatched, isDelivered, isServed]);

  return (
    <main style={pageWrap}>
      <div style={{ ...banner.tint && {} }}>
        <div style={{
          background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.06)', border: `2px solid ${banner.tint}33`,
        }}>
          <div style={{ fontSize: 56, lineHeight: 1 }}>{banner.emoji}</div>
          <h1 style={{ margin: '12px 0 6px', fontSize: 22, color: banner.tint }}>{banner.title}</h1>
          <p style={{ margin: 0, color: '#475569', fontSize: 14, lineHeight: 1.5 }}>{banner.body}</p>
          <div style={{
            display: 'inline-block', marginTop: 16,
            padding: '6px 18px', borderRadius: 999,
            background: '#eef2ff', color: '#4338ca',
            fontWeight: 800, fontSize: 18, letterSpacing: 1,
          }}>
            {ticket.ticket_number}
          </div>
        </div>
      </div>

      {/* Driver block — only for delivery + dispatched + not yet delivered. */}
      {serviceMode === 'delivery' && isDispatched && !isDelivered && rider && (
        <section style={card}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 8 }}>
            🛵 {tr(locale, 'Your driver', 'Votre livreur', 'السائق')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>{rider.full_name ?? '—'}</div>
              {rider.phone && (
                <div style={{ fontSize: 13, color: '#64748b', direction: 'ltr' }}>{rider.phone}</div>
              )}
            </div>
            {rider.phone && (
              <a
                href={`tel:${rider.phone}`}
                style={{
                  padding: '10px 16px', borderRadius: 8,
                  background: '#22c55e', color: '#fff',
                  fontWeight: 700, fontSize: 14, textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                📞 {tr(locale, 'Call', 'Appeler', 'اتصل')}
              </a>
            )}
          </div>
        </section>
      )}

      {/* Lifecycle timeline */}
      {!isCancelled && (
        <section style={card}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 12 }}>
            {tr(locale, 'Order progress', 'Avancement', 'تقدّم الطلب')}
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {steps.map((s, i) => (
              <li key={s.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, paddingBlock: 8 }}>
                <span style={{
                  display: 'inline-flex', width: 22, height: 22, borderRadius: '50%',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: s.reached ? (s.current ? '#3b82f6' : '#22c55e') : '#e2e8f0',
                  color: s.reached ? '#fff' : '#94a3b8',
                  fontSize: 12, fontWeight: 800,
                }}>
                  {s.reached ? '✓' : i + 1}
                </span>
                <span style={{
                  flex: 1, color: s.reached ? '#0f172a' : '#94a3b8',
                  fontWeight: s.current ? 700 : 500,
                  fontSize: 14,
                }}>
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Delivery address — only for delivery, with Maps button when pin. */}
      {serviceMode === 'delivery' && da?.street && (
        <section style={card}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 8 }}>
            📍 {tr(locale, 'Delivery to', 'Livraison à', 'التوصيل إلى')}
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }} dir="auto">{da.street}</div>
          {da.city && <div style={{ fontSize: 13, color: '#475569' }}>{da.city}</div>}
          {da.instructions && (
            <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic', marginTop: 4 }}>{da.instructions}</div>
          )}
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-block', marginTop: 10,
                padding: '8px 14px', borderRadius: 8,
                background: '#3b82f6', color: '#fff',
                fontWeight: 700, fontSize: 13, textDecoration: 'none',
              }}
            >
              🗺️ {tr(locale, 'Open in Maps', 'Ouvrir dans Maps', 'فتح في الخرائط')}
            </a>
          )}
        </section>
      )}

      {/* Items list + total. Always shown when there are items, regardless of status. */}
      {items.length > 0 && (
        <section style={card}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, marginBottom: 8 }}>
            🛒 {tr(locale, `Order (${itemCount})`, `Commande (${itemCount})`, `الطلب (${itemCount})`)}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {items.map((it) => (
              <li key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingBlock: 4, fontSize: 14 }}>
                <span>
                  <span style={{ fontWeight: 700, marginInlineEnd: 6 }}>{it.qty}×</span>
                  <span dir="auto">{it.name}</span>
                </span>
                {it.line_total && <span style={{ color: '#475569' }}>{it.line_total}</span>}
              </li>
            ))}
          </ul>
          {totalDisplay && (
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 10, paddingTop: 8, borderTop: '1px solid #e2e8f0',
              fontWeight: 800, fontSize: 15,
            }}>
              <span>{tr(locale, 'Total', 'Total', 'المجموع')}</span>
              <span>{totalDisplay}</span>
            </div>
          )}
        </section>
      )}

      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, marginTop: 16 }}>
        {organizationName ? `${organizationName} · ${officeName}` : officeName}
      </p>
    </main>
  );
}

const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '20px 14px 40px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 14,
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 16,
  border: '1px solid #e2e8f0',
};

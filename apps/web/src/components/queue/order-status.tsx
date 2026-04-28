'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import OrderMap from './order-map';

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
    arrived_at: string | null;
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
              arrived_at: next.arrived_at ?? prev.arrived_at,
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
  const isArrived = Boolean(ticket.arrived_at);
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
    if (isArrived && !isDelivered && serviceMode === 'delivery') return {
      emoji: '🚪',
      tint: '#22c55e',
      title: tr(locale, 'Driver has arrived', 'Le livreur est arrivé', 'وصل السائق'),
      body: rider?.full_name
        ? tr(locale,
            `${rider.full_name} is at your address. Please open the door.`,
            `${rider.full_name} est à votre adresse. Veuillez ouvrir.`,
            `${rider.full_name} في عنوانك. يرجى فتح الباب.`,
          )
        : tr(locale,
            'Your driver is at your address.',
            'Votre livreur est à votre adresse.',
            'السائق في عنوانك.',
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
        reached: isDispatched || isArrived || isDelivered,
        current: isDispatched && !isArrived && !isDelivered,
      });
      arr.push({
        key: 'arrived',
        label: tr(locale, 'Driver arrived', 'Livreur arrivé', 'وصل السائق'),
        reached: isArrived || isDelivered,
        current: isArrived && !isDelivered,
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
      {/* Compact hero — emoji + ticket number + title on one row, body
          on a second line. Fits a phone viewport without dominating it. */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
        border: `2px solid ${banner.tint}33`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>{banner.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 16, color: banner.tint, lineHeight: 1.2 }}>{banner.title}</h1>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 6,
              background: '#eef2ff', color: '#4338ca',
              fontWeight: 800, fontSize: 12, letterSpacing: 0.5,
            }}>
              {ticket.ticket_number}
            </span>
          </div>
          <p style={{ margin: '3px 0 0', color: '#64748b', fontSize: 12, lineHeight: 1.4 }}>{banner.body}</p>
        </div>
      </div>

      {/* Live driver map — only when delivery is in flight AND we know
          where to drop the food (lat/lng on the address). The map
          subscribes to rider_locations realtime, so it animates as the
          driver streams heartbeats from the rider portal. */}
      {serviceMode === 'delivery' && isDispatched && !isDelivered && lat != null && lng != null && (
        <OrderMap
          ticketId={ticket.id}
          destLat={lat}
          destLng={lng}
          supabaseUrl={props.supabaseUrl}
          supabaseAnonKey={props.supabaseAnonKey}
          locale={locale}
        />
      )}

      {/* Driver block — single-row: emoji · name + phone · Call button.
          Halves the height vs the previous two-row card and keeps the
          phone-tap-to-call affordance front-and-centre. */}
      {serviceMode === 'delivery' && isDispatched && !isDelivered && rider && (
        <section style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🛵</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rider.full_name ?? tr(locale, 'Driver', 'Livreur', 'السائق')}
            </div>
            {rider.phone && (
              <div style={{ fontSize: 12, color: '#64748b', direction: 'ltr' }}>{rider.phone}</div>
            )}
          </div>
          {rider.phone && (
            <a
              href={`tel:${rider.phone}`}
              style={{
                padding: '8px 14px', borderRadius: 8,
                background: '#22c55e', color: '#fff',
                fontWeight: 700, fontSize: 13, textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              📞 {tr(locale, 'Call', 'Appeler', 'اتصل')}
            </a>
          )}
        </section>
      )}

      {/* Lifecycle timeline — horizontal row of dots so 4 steps fit
          inline rather than stacking vertically (saves ~80px on phones).
          Active step's label is shown; reached steps show a check. */}
      {!isCancelled && (
        <section style={{ ...card, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {steps.map((s, i) => {
              const reachedColor = s.current ? '#3b82f6' : '#22c55e';
              return (
                <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: s.current ? 1 : 0 }}>
                  <span style={{
                    display: 'inline-flex', width: 18, height: 18, borderRadius: '50%',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: s.reached ? reachedColor : '#e2e8f0',
                    color: s.reached ? '#fff' : '#94a3b8',
                    fontSize: 10, fontWeight: 800,
                  }}>
                    {s.reached ? '✓' : i + 1}
                  </span>
                  {s.current && (
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: reachedColor,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{s.label}</span>
                  )}
                  {i < steps.length - 1 && (
                    <span style={{
                      flex: s.current ? 0 : 1, height: 2, minWidth: 10,
                      background: steps[i + 1].reached ? '#22c55e' : '#e2e8f0',
                    }} />
                  )}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Delivery address — single-row when there's a pin: address text on
          one side, Maps button on the other. Shrinks vertically by ~40px. */}
      {serviceMode === 'delivery' && da?.street && (
        <section style={{ ...card, padding: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>📍</span>
          <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">
              {da.street}
            </div>
            {(da.city || da.instructions) && (
              <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {da.city ?? ''}{da.city && da.instructions ? ' · ' : ''}{da.instructions ?? ''}
              </div>
            )}
          </div>
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              style={{
                padding: '6px 10px', borderRadius: 6,
                background: '#3b82f6', color: '#fff',
                fontWeight: 700, fontSize: 11, textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
              title={tr(locale,
                'Address text is approximate — this opens the exact pin you shared.',
                "L'adresse est approximative — ceci ouvre le point exact que vous avez partagé.",
                'العنوان تقريبي — هذا يفتح الموقع الذي شاركته بالضبط.',
              )}
            >
              📍 {tr(locale, 'Pin', 'Épingle', 'الموقع')}
            </a>
          )}
        </section>
      )}

      {/* Items: collapsed-by-default summary line. The customer already
          saw the cart when they confirmed the order — here we just need
          a count + total + a way to open the details if they want them.
          Saves a lot of vertical space on bigger menus. */}
      {items.length > 0 && (
        <ItemsSummary
          items={items}
          itemCount={itemCount}
          totalDisplay={totalDisplay}
          locale={locale}
        />
      )}

      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
        {organizationName ? `${organizationName} · ${officeName}` : officeName}
      </p>
    </main>
  );
}

function ItemsSummary({
  items, itemCount, totalDisplay, locale,
}: {
  items: Array<{ id: string; name: string; qty: number; line_total: string | null }>;
  itemCount: number;
  totalDisplay: string | null;
  locale: 'ar' | 'fr' | 'en';
}) {
  const [open, setOpen] = useState(false);
  return (
    <section style={card}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: 0, background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#0f172a', font: 'inherit', textAlign: 'start',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          🛒 {tr(locale, `${itemCount} items`, `${itemCount} articles`, `${itemCount} منتجات`)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {totalDisplay && <span style={{ fontWeight: 800, fontSize: 14 }}>{totalDisplay}</span>}
          <span style={{
            fontSize: 10, color: '#94a3b8',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
          }}>
            ▶
          </span>
        </span>
      </button>
      {open && (
        <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
          {items.map((it) => (
            <li key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, paddingBlock: 3, fontSize: 13 }}>
              <span>
                <span style={{ fontWeight: 700, marginInlineEnd: 6 }}>{it.qty}×</span>
                <span dir="auto">{it.name}</span>
              </span>
              {it.line_total && <span style={{ color: '#475569' }}>{it.line_total}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '12px 12px 16px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 8,
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 12,
  border: '1px solid #e2e8f0',
};

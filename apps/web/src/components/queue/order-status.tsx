'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import OrderMap from './order-map';

/**
 * Customer-facing tracking page for online restaurant orders.
 *
 * Drop-in replacement for QueueStatus when the ticket is an online
 * order (source whatsapp / web) and the resolved service type is
 * takeout or delivery. Renders a status-aware UI with phase-specific
 * micro-animations (Uber Eats-style) so the customer instantly knows
 * what's happening:
 *
 *   pending_approval     →  ⏳  pulsing hourglass         "Order received"
 *   serving (cooking)    →  👨‍🍳  bouncing dots animation   "Being prepared"
 *   serving + dispatched →  🛵  motorcycle riding L→R     "On the way"
 *   serving + arrived    →  🚪  pulsing door               "Driver at your door"
 *   served (delivery)    →  ✅  pop-in checkmark          "Delivered — enjoy!"
 *   served (takeout)     →  ✅  pop-in checkmark          "Ready for pickup"
 *   cancelled            →  ❌  static                    "Cancelled"
 *
 * Subscribes to Supabase realtime on `tickets` for the current ticket id
 * so the page flips automatically when the operator dispatches / marks
 * delivered without the customer having to refresh.
 *
 * On the Delivered screen we auto-expand the full itemized list — the
 * customer treats this page as a receipt at that point, so they want to
 * see what they actually got, not a summary they have to tap to open.
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
  // We run TWO update paths and keep whichever fires first:
  //   1. Supabase Realtime postgres_changes — fast path (<1s)
  //   2. Polling refetch every 8s — fallback when Realtime is blocked
  //      by RLS, the publication is misconfigured, or the customer is
  //      on a flaky network where the websocket disconnects silently.
  // Without (2) the page can sit on a stale phase forever even though
  // the operator has already dispatched / delivered.
  useEffect(() => {
    let unsubFn: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const sb = createBrowserClient(props.supabaseUrl, props.supabaseAnonKey);

    const applyRow = (next: any) => {
      if (!next) return;
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
    };

    try {
      const channel = sb
        .channel(`order-track-${ticket.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticket.id}` },
          (payload) => applyRow(payload.new),
        )
        .subscribe();
      unsubFn = () => { try { sb.removeChannel(channel); } catch {} };
    } catch (e) {
      console.warn('[OrderStatus] realtime subscribe failed', e);
    }

    // Polling fallback — 8s cadence, runs alongside realtime. Stops once
    // the order reaches a terminal phase (delivered / cancelled) since
    // there's nothing more to track at that point.
    const poll = async () => {
      try {
        const { data } = await sb
          .from('tickets')
          .select('status, dispatched_at, arrived_at, delivered_at, cancelled_at, completed_at, notes, assigned_rider_id')
          .eq('id', ticket.id)
          .maybeSingle();
        applyRow(data);
      } catch (e) {
        // Network blip — try again on the next tick.
      }
    };
    pollTimer = setInterval(poll, 8000);

    return () => {
      unsubFn?.();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [ticket.id, props.supabaseUrl, props.supabaseAnonKey]);

  // Note: polling runs indefinitely while the page is mounted. That's
  // fine — once the order reaches a terminal phase the customer
  // typically closes the tab, and 8s polls on a finished order are
  // cheap (one row read).

  // ── Status resolution ────────────────────────────────────────────
  const isDispatched = Boolean(ticket.dispatched_at);
  const isArrived = Boolean(ticket.arrived_at);
  const isDelivered = Boolean(ticket.delivered_at);
  const isCancelled = ticket.status === 'cancelled' || ticket.status === 'no_show';
  const isPending = ticket.status === 'pending_approval';
  const isServing = ticket.status === 'serving';
  const isServed = ticket.status === 'served';
  // Phase used for the animated hero. Kept as a discriminated string so
  // the JSX below picks the right animation without re-running checks.
  const phase: 'pending' | 'preparing' | 'on_the_way' | 'arrived' | 'delivered' | 'pickup_ready' | 'cancelled' | 'unknown' =
      isCancelled ? 'cancelled'
    : isPending ? 'pending'
    : isDelivered && serviceMode === 'delivery' ? 'delivered'
    : isServed && serviceMode === 'takeout' ? 'pickup_ready'
    : isArrived && serviceMode === 'delivery' ? 'arrived'
    : isDispatched && serviceMode === 'delivery' ? 'on_the_way'
    : isServing ? 'preparing'
    : 'unknown';

  // Map link from delivery_address.lat/lng — same universal Google
  // Maps query URL we use on Station; opens GMaps on Android, Apple
  // Maps on iOS, Google Maps web on desktop.
  const da = ticket.delivery_address;
  const lat = typeof da?.lat === 'number' ? da.lat : null;
  const lng = typeof da?.lng === 'number' ? da.lng : null;
  const mapsHref = lat != null && lng != null
    ? `https://www.google.com/maps/?q=${encodeURIComponent(`${lat},${lng}`)}`
    : null;

  // Tone-aware top banner — kept for the title/body/tint values; the
  // emoji slot is replaced by a phase-specific animated component below.
  const banner = useMemo(() => {
    if (phase === 'cancelled') return {
      tint: '#ef4444',
      title: tr(locale, 'Order cancelled', 'Commande annulée', 'تم إلغاء الطلب'),
      body: ticket.notes || tr(locale, 'This order was cancelled.', 'Cette commande a été annulée.', 'تم إلغاء هذا الطلب.'),
    };
    if (phase === 'pending') return {
      tint: '#f59e0b',
      title: tr(locale, 'Order received', 'Commande reçue', 'تم استلام الطلب'),
      body: tr(locale,
        `${organizationName} is reviewing your order. You'll be notified as soon as it's accepted.`,
        `${organizationName} examine votre commande. Vous serez notifié dès qu'elle est acceptée.`,
        `${organizationName} يراجع طلبك. سنُعلمك بمجرد قبوله.`,
      ),
    };
    if (phase === 'delivered') return {
      tint: '#22c55e',
      title: tr(locale, 'Delivered — enjoy!', 'Livré — bon appétit !', 'تم التوصيل — شهية طيبة!'),
      body: tr(locale,
        `Your order arrived ${formatTimeAgo(ticket.delivered_at, locale)}. Receipt below.`,
        `Votre commande est arrivée ${formatTimeAgo(ticket.delivered_at, locale)}. Reçu ci-dessous.`,
        `وصل طلبك ${formatTimeAgo(ticket.delivered_at, locale)}. الإيصال أدناه.`,
      ),
    };
    if (phase === 'pickup_ready') return {
      tint: '#22c55e',
      title: tr(locale, 'Ready for pickup', 'Prêt à emporter', 'جاهز للاستلام'),
      body: tr(locale,
        `Come by ${officeName} whenever you're ready.`,
        `Passez chez ${officeName} quand vous voulez.`,
        `يمكنك المرور على ${officeName} في أي وقت.`,
      ),
    };
    if (phase === 'arrived') return {
      tint: '#22c55e',
      title: tr(locale, 'Driver at your door', 'Le livreur est à votre porte', 'السائق عند بابك'),
      body: rider?.full_name
        ? tr(locale,
            `${rider.full_name} is at your address. Please open the door.`,
            `${rider.full_name} est à votre adresse. Veuillez ouvrir.`,
            `${rider.full_name} في عنوانك. يرجى فتح الباب.`,
          )
        : tr(locale, 'Your driver is at your address.', 'Votre livreur est à votre adresse.', 'السائق في عنوانك.'),
    };
    if (phase === 'on_the_way') return {
      tint: '#3b82f6',
      title: tr(locale, 'On the way', 'En route', 'في الطريق إليك'),
      body: rider?.full_name
        ? tr(locale,
            `${rider.full_name} is heading to your address.`,
            `${rider.full_name} se dirige vers votre adresse.`,
            `${rider.full_name} في طريقه إلى عنوانك.`,
          )
        : tr(locale, 'A driver is heading to your address.', 'Un livreur se dirige vers vous.', 'السائق في الطريق إليك.'),
    };
    if (phase === 'preparing') return {
      tint: '#8b5cf6',
      title: tr(locale, 'Order being prepared', 'Commande en préparation', 'الطلب قيد التحضير'),
      body: serviceMode === 'delivery'
        ? tr(locale,
            `${organizationName} is cooking. We'll notify you when the driver leaves.`,
            `${organizationName} cuisine. Nous vous préviendrons au départ du livreur.`,
            `${organizationName} يطبخ. سنُعلمك عند مغادرة السائق.`,
          )
        : tr(locale,
            `${organizationName} is preparing your order. We'll notify you when it's ready.`,
            `${organizationName} prépare votre commande. Nous vous préviendrons quand elle est prête.`,
            `${organizationName} يحضّر طلبك. سنُعلمك عندما يصبح جاهزًا.`,
          ),
    };
    return {
      tint: '#64748b',
      title: tr(locale, 'Order status', 'Statut de la commande', 'حالة الطلب'),
      body: ticket.status,
    };
  }, [phase, locale, ticket.notes, organizationName, officeName, rider, ticket.status, ticket.delivered_at, serviceMode]);

  // Lifecycle timeline. Each step has a label that's always shown below
  // the dot — earlier we hid non-active labels to save space, but with
  // 4-5 steps the customer needs to see the whole journey, not just the
  // current beat. The dot grows + glows when current.
  const steps = useMemo(() => {
    const isDeliv = serviceMode === 'delivery';
    const arr: Array<{ key: string; label: string; reached: boolean; current: boolean }> = [
      { key: 'received', label: tr(locale, 'Received', 'Reçue', 'مستلم'),
        reached: true, current: phase === 'pending' },
      { key: 'accepted', label: tr(locale, 'Preparing', 'Préparation', 'تحضير'),
        reached: phase !== 'pending' && phase !== 'cancelled',
        current: phase === 'preparing' },
    ];
    if (isDeliv) {
      arr.push({ key: 'on_the_way', label: tr(locale, 'On the way', 'En route', 'في الطريق'),
        reached: phase === 'on_the_way' || phase === 'arrived' || phase === 'delivered',
        current: phase === 'on_the_way' });
      arr.push({ key: 'arrived', label: tr(locale, 'At your door', 'À la porte', 'عند الباب'),
        reached: phase === 'arrived' || phase === 'delivered',
        current: phase === 'arrived' });
      arr.push({ key: 'delivered', label: tr(locale, 'Delivered', 'Livrée', 'مسلّم'),
        reached: phase === 'delivered', current: phase === 'delivered' });
    } else {
      arr.push({ key: 'ready', label: tr(locale, 'Ready', 'Prête', 'جاهز'),
        reached: phase === 'pickup_ready', current: phase === 'pickup_ready' });
    }
    return arr;
  }, [serviceMode, locale, phase]);

  // On the Delivered / Pickup-Ready screens the items list becomes the
  // receipt — show it expanded by default. On every other phase the
  // summary line saves space; the customer can still tap to expand.
  const itemsExpandedDefault = phase === 'delivered' || phase === 'pickup_ready';

  return (
    <main style={pageWrap}>
      {/* Inline keyframes for the phase-specific animations. Kept inline
          so the component is self-contained — no global stylesheet
          dependency, no Tailwind requirement. Animations are GPU-cheap
          (transform + opacity only). */}
      <style>{`
        @keyframes qfo-pulse-soft {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.65; transform: scale(0.92); }
        }
        @keyframes qfo-spin-slow {
          0% { transform: rotate(0deg); }
          50% { transform: rotate(180deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes qfo-bounce-dot {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-7px); opacity: 1; }
        }
        @keyframes qfo-ride {
          /* The 🛵 emoji on iOS/Apple is drawn rider-facing-LEFT, so we
             pre-flip with scaleX(-1) on the element and counter-flip in
             the keyframe — the bike now faces right and rides forward. */
          0%   { transform: scaleX(-1) translateX(30%)  rotate(4deg); }
          50%  { transform: scaleX(-1) translateX(-45%) rotate(-2deg); }
          100% { transform: scaleX(-1) translateX(-120%) rotate(4deg); }
        }
        @keyframes qfo-pop-in {
          0%   { transform: scale(0.4); opacity: 0; }
          60%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes qfo-door-knock {
          0%, 100% { transform: rotate(0deg); }
          15% { transform: rotate(-8deg); }
          30% { transform: rotate(6deg); }
          45% { transform: rotate(-4deg); }
          60% { transform: rotate(2deg); }
        }
        @keyframes qfo-steam {
          0%   { transform: translateY(0) scaleX(1); opacity: 0.7; }
          100% { transform: translateY(-12px) scaleX(0.6); opacity: 0; }
        }
        @keyframes qfo-progress-glow {
          0%, 100% { box-shadow: 0 0 0 0 currentColor; }
          50%      { box-shadow: 0 0 0 5px transparent; }
        }
        .qfo-bounce-dot { animation: qfo-bounce-dot 1.2s infinite ease-in-out; }
      `}</style>

      {/* Hero — large, animated, status-aware. The icon area is a
          dedicated 64×64 box so each phase animation has consistent
          breathing room. The motorcycle in particular needs the box
          width to ride across; the chef needs vertical space for the
          bouncing dots. */}
      <div style={{
        background: '#fff', borderRadius: 14, padding: 16,
        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        border: `2px solid ${banner.tint}33`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <PhaseIcon phase={phase} tint={banner.tint} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 17, color: banner.tint, lineHeight: 1.2, fontWeight: 800 }}>
              {banner.title}
            </h1>
            <span style={{
              display: 'inline-block', padding: '2px 8px', borderRadius: 6,
              background: '#eef2ff', color: '#4338ca',
              fontWeight: 800, fontSize: 11, letterSpacing: 0.5,
            }}>
              {ticket.ticket_number}
            </span>
          </div>
          <p style={{ margin: '4px 0 0', color: '#475569', fontSize: 13, lineHeight: 1.4 }}>
            {banner.body}
          </p>
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
        <section style={{ ...card, padding: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>🛵</span>
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
                padding: '9px 16px', borderRadius: 8,
                background: '#22c55e', color: '#fff',
                fontWeight: 700, fontSize: 13, textDecoration: 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(34,197,94,0.35)',
              }}
            >
              📞 {tr(locale, 'Call', 'Appeler', 'اتصل')}
            </a>
          )}
        </section>
      )}

      {/* Lifecycle timeline — full-width with labels under each dot so
          the customer sees the whole journey at a glance. The current
          step gets a soft glow ring; reached steps fill in green; the
          connector bar between dots fills as progress moves. */}
      {!isCancelled && <Timeline steps={steps} tint={banner.tint} />}

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

      {/* Items: collapsed-by-default summary line during the journey,
          auto-expanded once the order is delivered / ready (the customer
          uses this page as a receipt at that point). */}
      {items.length > 0 && (
        <ItemsSummary
          items={items}
          itemCount={itemCount}
          totalDisplay={totalDisplay}
          locale={locale}
          defaultOpen={itemsExpandedDefault}
          isReceipt={itemsExpandedDefault}
        />
      )}

      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 6 }}>
        {organizationName ? `${organizationName} · ${officeName}` : officeName}
      </p>
    </main>
  );
}

/**
 * 64×64 animated icon for the hero, switched on the resolved phase.
 * Each animation is intentionally short and GPU-cheap (transform +
 * opacity only) so it loops indefinitely without battery cost.
 */
function PhaseIcon({ phase, tint }: { phase: string; tint: string }) {
  const wrap: React.CSSProperties = {
    width: 64, height: 64, flexShrink: 0,
    borderRadius: 14,
    background: `${tint}15`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden',
  };

  if (phase === 'pending') {
    return (
      <div style={wrap}>
        <span style={{
          fontSize: 34, animation: 'qfo-spin-slow 2.5s ease-in-out infinite',
          display: 'inline-block',
        }}>⏳</span>
      </div>
    );
  }

  if (phase === 'preparing') {
    return (
      <div style={{ ...wrap, flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>👨‍🍳</span>
        {/* Three bouncing dots beneath the chef — universally readable
            "thinking / working" indicator regardless of locale. */}
        <span style={{ display: 'inline-flex', gap: 3, marginTop: -2 }}>
          <span className="qfo-bounce-dot" style={{
            width: 5, height: 5, borderRadius: '50%', background: tint,
            animationDelay: '0s',
          }} />
          <span className="qfo-bounce-dot" style={{
            width: 5, height: 5, borderRadius: '50%', background: tint,
            animationDelay: '0.18s',
          }} />
          <span className="qfo-bounce-dot" style={{
            width: 5, height: 5, borderRadius: '50%', background: tint,
            animationDelay: '0.36s',
          }} />
        </span>
      </div>
    );
  }

  if (phase === 'on_the_way') {
    return (
      <div style={wrap}>
        {/* Motorcycle riding left → right inside the icon box. The slight
            tilt on the keyframes simulates the bike leaning into a turn. */}
        <span style={{
          fontSize: 30,
          animation: 'qfo-ride 2.6s linear infinite',
          display: 'inline-block',
          willChange: 'transform',
        }}>🛵</span>
      </div>
    );
  }

  if (phase === 'arrived') {
    return (
      <div style={wrap}>
        <span style={{
          fontSize: 34,
          animation: 'qfo-door-knock 1.4s ease-in-out infinite',
          display: 'inline-block',
          transformOrigin: '50% 80%',
        }}>🚪</span>
      </div>
    );
  }

  if (phase === 'delivered' || phase === 'pickup_ready') {
    return (
      <div style={wrap}>
        <span style={{
          fontSize: 36,
          // pop-in plays once on mount, then settles on the final scale.
          animation: 'qfo-pop-in 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both',
          display: 'inline-block',
        }}>✅</span>
      </div>
    );
  }

  if (phase === 'cancelled') {
    return (
      <div style={{ ...wrap, background: '#ef444415' }}>
        <span style={{ fontSize: 34 }}>❌</span>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <span style={{ fontSize: 28 }}>ℹ️</span>
    </div>
  );
}

/**
 * Horizontal lifecycle timeline. Each step shows: dot + label below.
 * The current dot pulses and is filled with `tint`; reached dots are
 * solid green; future dots are gray. Connector bars between dots fill
 * green when the *next* step is reached.
 */
function Timeline({ steps, tint }: {
  steps: Array<{ key: string; label: string; reached: boolean; current: boolean }>;
  tint: string;
}) {
  return (
    <section style={{ ...card, padding: '14px 10px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
        {steps.map((s, i) => {
          const next = steps[i + 1];
          const dotColor = s.current ? tint : s.reached ? '#22c55e' : '#e2e8f0';
          const dotTextColor = s.reached || s.current ? '#fff' : '#94a3b8';
          return (
            <div key={s.key} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              minWidth: 0, position: 'relative',
            }}>
              {/* Connector to the next step — sits absolutely behind the
                  next dot's label area so it visually links them without
                  pushing layout around. */}
              {next && (
                <span style={{
                  position: 'absolute',
                  top: 11,
                  insetInlineStart: '50%',
                  width: '100%',
                  height: 2,
                  background: next.reached ? '#22c55e' : '#e2e8f0',
                  zIndex: 0,
                }} />
              )}
              <span style={{
                position: 'relative', zIndex: 1,
                display: 'inline-flex', width: 24, height: 24, borderRadius: '50%',
                alignItems: 'center', justifyContent: 'center',
                background: dotColor, color: dotTextColor,
                fontSize: 11, fontWeight: 800,
                boxShadow: s.current ? `0 0 0 4px ${tint}33` : 'none',
                transition: 'box-shadow 0.2s',
                animation: s.current ? 'qfo-pulse-soft 1.6s ease-in-out infinite' : 'none',
              }}>
                {s.reached ? '✓' : i + 1}
              </span>
              <span style={{
                marginTop: 6, fontSize: 10.5, lineHeight: 1.2, textAlign: 'center',
                color: s.current ? tint : s.reached ? '#0f172a' : '#94a3b8',
                fontWeight: s.current || s.reached ? 700 : 500,
                wordBreak: 'break-word',
                paddingInline: 2,
              }}>
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ItemsSummary({
  items, itemCount, totalDisplay, locale, defaultOpen, isReceipt,
}: {
  items: Array<{ id: string; name: string; qty: number; line_total: string | null }>;
  itemCount: number;
  totalDisplay: string | null;
  locale: 'ar' | 'fr' | 'en';
  defaultOpen: boolean;
  /** When true (delivered / ready), render as a styled receipt: header
      reads "Receipt", items are dividers, total is bolded at the bottom. */
  isReceipt: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
          {isReceipt
            ? `🧾 ${tr(locale, 'Receipt', 'Reçu', 'الإيصال')}`
            : `🛒 ${tr(locale, `${itemCount} items`, `${itemCount} articles`, `${itemCount} منتجات`)}`}
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
        <>
          <ul style={{
            margin: '10px 0 0', padding: 0, listStyle: 'none',
            borderTop: '1px solid #e2e8f0', paddingTop: 8,
          }}>
            {items.map((it) => (
              <li key={it.id} style={{
                display: 'flex', justifyContent: 'space-between', gap: 8,
                paddingBlock: isReceipt ? 6 : 3, fontSize: 13,
                borderBottom: isReceipt ? '1px dashed #e2e8f0' : 'none',
              }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700, marginInlineEnd: 6 }}>{it.qty}×</span>
                  <span dir="auto">{it.name}</span>
                </span>
                {it.line_total && <span style={{ color: '#475569', whiteSpace: 'nowrap' }}>{it.line_total}</span>}
              </li>
            ))}
          </ul>
          {/* Bold total line on the receipt view — feels like a real
              bill and stops the customer from second-guessing the
              top-of-card total. */}
          {isReceipt && totalDisplay && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', gap: 8,
              marginTop: 8, paddingTop: 8, borderTop: '2px solid #0f172a',
              fontSize: 14, fontWeight: 800, color: '#0f172a',
            }}>
              <span>{tr(locale, 'Total', 'Total', 'الإجمالي')}</span>
              <span>{totalDisplay}</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '14px 12px 20px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 10,
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 12,
  border: '1px solid #e2e8f0',
};

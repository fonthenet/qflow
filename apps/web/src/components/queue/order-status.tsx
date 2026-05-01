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

    // Polling fallback — 5s cadence (was 8s). Tighter so customers
    // perceive operator/driver state changes as nearly real-time even
    // when the Realtime websocket drops on a flaky mobile network.
    // Same pattern UberEats / DoorDash use: ws + polling redundancy.
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
    // Run one poll right away so we don't wait 5 s for the first
    // refresh on initial mount (e.g. customer opens a stale page).
    void poll();
    pollTimer = setInterval(poll, 5000);

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
      tint: '#64748b',
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
  // Always keep the items list open — at every phase the customer wants
  // to see what they ordered without having to tap. The "receipt" treatment
  // (totals + line items styled as a printed receipt) is reserved for the
  // terminal phases where the list IS the receipt.
  const itemsExpandedDefault = true;
  const itemsAsReceipt = phase === 'delivered' || phase === 'pickup_ready';

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
        @keyframes qfo-bob {
          /* Soft vertical bob for the line-art scooter — reads as
             "in motion" without the cartoonish lateral slide. SVG
             doesn't need the scaleX(-1) hack the iOS emoji required. */
          0%, 100% { transform: translateY(0)    rotate(0deg); }
          25%      { transform: translateY(-1px) rotate(-1deg); }
          50%      { transform: translateY(-1.5px) rotate(0deg); }
          75%      { transform: translateY(-1px) rotate(1deg); }
        }
        @keyframes qfo-shimmer {
          /* Indeterminate progress bar — UberEats-style "cooking"
             feedback when there's no concrete ETA. The strip moves
             from -40% to 140% of its container width. */
          0%   { transform: translateX(-40%); }
          100% { transform: translateX(140%); }
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

      {/* Hero — refined design language. Replaces the saturated tinted
          border with a quiet card that uses a soft drop-shadow. Tint
          is reserved for the icon's halo + the title text only, so
          the eye lands on the status word, not on a coloured frame.
          Ticket number is monospace + muted — feels like a real
          delivery app, not a demo. */}
      <div style={{
        background: '#fff', borderRadius: 14, padding: '14px 16px',
        boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <PhaseIcon phase={phase} tint={banner.tint} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, fontWeight: 600, color: '#94a3b8',
            letterSpacing: 0.5, textTransform: 'uppercase',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}>
            {ticket.ticket_number}
          </div>
          <h1 style={{
            margin: '2px 0 0', fontSize: 18, color: '#0f172a',
            fontWeight: 700, letterSpacing: -0.3, lineHeight: 1.2,
          }}>
            {banner.title}
          </h1>
          <p style={{
            margin: '4px 0 0', color: '#475569', fontSize: 13,
            lineHeight: 1.4,
          }}>
            {banner.body}
          </p>
        </div>
      </div>

      {/* Preparing progress strip — only during the 'preparing' phase.
          Indeterminate (no ETA) shimmer that mimics UberEats / DoorDash
          "your order is being prepared" affordance. Subtle: thin track,
          tinted progress bar that travels left→right on a 2.2s loop.
          Skipped on every other phase (the timeline below conveys the
          journey then). */}
      {phase === 'preparing' && (
        <section style={{
          background: '#fff', borderRadius: 14,
          boxShadow: '0 1px 3px rgba(15,23,42,0.05)',
          padding: '14px 16px',
        }}>
          <div style={{
            position: 'relative',
            height: 4, borderRadius: 999,
            background: '#f1f5f9',
            overflow: 'hidden',
          }}>
            <span style={{
              position: 'absolute', insetBlockStart: 0, insetInlineStart: 0,
              width: '50%', height: '100%', borderRadius: 999,
              // Smooth grey shimmer — gradient stops include faint
              // intermediate alphas so the leading/trailing edges fade
              // instead of hard-cutting against the track. Linear timing
              // keeps motion uniform across the loop (ease in/out makes
              // the bar visibly slow at the edges, which read as judder).
              background:
                'linear-gradient(90deg, ' +
                'rgba(100,116,139,0) 0%, ' +
                'rgba(100,116,139,0.18) 30%, ' +
                'rgba(100,116,139,0.55) 50%, ' +
                'rgba(100,116,139,0.18) 70%, ' +
                'rgba(100,116,139,0) 100%)',
              animation: 'qfo-shimmer 1.8s linear infinite',
              willChange: 'transform',
            }} />
          </div>
        </section>
      )}

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

      {/* Driver card — circular avatar with the driver's initial, name
          + phone, refined circular call button. Matches the rider-
          portal customer card visual language. */}
      {serviceMode === 'delivery' && isDispatched && !isDelivered && rider && (
        <section style={{ ...card, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 44, height: 44, borderRadius: '50%',
            background: '#0f172a', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, flexShrink: 0,
            letterSpacing: -0.5,
          }}>
            {(rider.full_name ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: '#94a3b8',
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              {tr(locale, 'Your courier', 'Votre livreur', 'السائق')}
            </div>
            <div style={{
              fontWeight: 700, fontSize: 15, color: '#0f172a',
              letterSpacing: -0.2, lineHeight: 1.2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {rider.full_name ?? tr(locale, 'Driver', 'Livreur', 'السائق')}
            </div>
            {rider.phone && (
              <div style={{ fontSize: 12, color: '#64748b', direction: 'ltr', marginTop: 1 }}>{rider.phone}</div>
            )}
          </div>
          {rider.phone && (
            <a
              href={`tel:${rider.phone}`}
              aria-label={tr(locale, 'Call', 'Appeler', 'اتصل')}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: '#16a34a', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', flexShrink: 0,
                boxShadow: '0 4px 12px rgba(22,163,74,0.30)',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
              </svg>
            </a>
          )}
        </section>
      )}

      {/* Lifecycle timeline — full-width with labels under each dot so
          the customer sees the whole journey at a glance. The current
          step gets a soft glow ring; reached steps fill in green; the
          connector bar between dots fills as progress moves. */}
      {!isCancelled && <Timeline steps={steps} tint={banner.tint} />}

      {/* Delivery address — same refined treatment as the rider portal
          drop-off card: small uppercase label, large address line,
          dark pill button to open in maps. No big emoji marker. */}
      {serviceMode === 'delivery' && da?.street && (
        <section style={{ ...card, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: '#94a3b8',
              letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2,
            }}>
              {tr(locale, 'Drop-off', 'Livraison', 'التسليم')}
            </div>
            <div style={{
              fontWeight: 600, fontSize: 14, color: '#0f172a',
              lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis',
            }} dir="auto">
              {da.street}
            </div>
            {(da.city || da.instructions) && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
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
                padding: '8px 14px', borderRadius: 999,
                background: '#0f172a', color: '#fff',
                fontWeight: 600, fontSize: 12, textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: 0.1,
                boxShadow: '0 2px 6px rgba(15,23,42,0.18)',
              }}
              title={tr(locale,
                'Address text is approximate — this opens the exact pin you shared.',
                "L'adresse est approximative — ceci ouvre le point exact que vous avez partagé.",
                'العنوان تقريبي — هذا يفتح الموقع الذي شاركته بالضبط.',
              )}
            >
              {tr(locale, 'Map →', 'Carte →', 'الخريطة →')}
            </a>
          )}
        </section>
      )}

      {/* Items: always expanded so the customer can see what they ordered
          at every phase. On terminal phases (delivered / pickup_ready) the
          list takes on receipt styling — totals row, line items, etc. */}
      {items.length > 0 && (
        <ItemsSummary
          items={items}
          itemCount={itemCount}
          totalDisplay={totalDisplay}
          locale={locale}
          defaultOpen={itemsExpandedDefault}
          isReceipt={itemsAsReceipt}
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
/**
 * PhaseIcon — refined SVG glyph (no emoji) tinted by phase. Animation
 * is reserved for the SVG itself (subtle pulse / soft scale) so the
 * tile reads as "alive but professional", not a cartoon.
 *
 * Why SVG over emoji: emoji rendering varies wildly across iOS / Android /
 * Windows (chef, scooter, door all look different), and the saturated
 * native renderings make the page feel like a kid's app. A single
 * monochrome glyph tinted with `currentColor` matches Linear / UberEats /
 * DoorDash design language — refined, scale-perfect, and CSS-controllable.
 */
function PhaseIcon({ phase, tint }: { phase: string; tint: string }) {
  const wrap: React.CSSProperties = {
    width: 56, height: 56, flexShrink: 0,
    borderRadius: 14,
    background: `${tint}14`,
    color: tint,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'hidden',
  };
  const stroke = 1.8;
  const size = 26;
  const baseSvg: React.CSSProperties = { display: 'block' };

  // Pending — line clock with subtle minute-hand sweep.
  if (phase === 'pending') {
    return (
      <div style={wrap}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
          style={baseSvg}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5" style={{
            transformOrigin: '12px 12px',
            animation: 'qfo-spin-slow 4s linear infinite',
          }} />
          <path d="M12 12h3.5" />
        </svg>
      </div>
    );
  }

  // Preparing — pulsing dot ring (kitchen "working" indicator).
  if (phase === 'preparing') {
    return (
      <div style={wrap}>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          {[0, 0.18, 0.36].map((d, i) => (
            <span key={i} className="qfo-bounce-dot" style={{
              width: 7, height: 7, borderRadius: '50%', background: 'currentColor',
              animationDelay: `${d}s`,
            }} />
          ))}
        </span>
      </div>
    );
  }

  // On the way — line scooter, gentle vertical bob.
  if (phase === 'on_the_way') {
    return (
      <div style={wrap}>
        <svg width={size + 2} height={size} viewBox="0 0 28 24" fill="none"
          stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
          style={{ ...baseSvg, animation: 'qfo-bob 1.6s ease-in-out infinite' }}>
          <circle cx="6" cy="18" r="3" />
          <circle cx="22" cy="18" r="3" />
          <path d="M6 18h11l3-9" />
          <path d="M16 9h4" />
          <path d="M9 18l4-7" />
        </svg>
      </div>
    );
  }

  // Arrived — line house/door with knock pulse.
  if (phase === 'arrived') {
    return (
      <div style={wrap}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
          style={{ ...baseSvg, animation: 'qfo-pulse-soft 1.4s ease-in-out infinite' }}>
          <path d="M3 21V9l9-6 9 6v12" />
          <path d="M9 21v-7h6v7" />
          <circle cx="13.5" cy="17" r="0.6" fill="currentColor" />
        </svg>
      </div>
    );
  }

  // Delivered / pickup ready — clean check inside a thin circle.
  if (phase === 'delivered' || phase === 'pickup_ready') {
    return (
      <div style={wrap}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
          style={{ ...baseSvg, animation: 'qfo-pop-in 0.55s cubic-bezier(0.34, 1.4, 0.5, 1) both' }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.7 2.7L16 9.5" />
        </svg>
      </div>
    );
  }

  // Cancelled — line X inside a thin circle, danger tint.
  if (phase === 'cancelled') {
    return (
      <div style={{ ...wrap, background: '#ef444412', color: '#ef4444' }}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
          style={baseSvg}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
        style={baseSvg}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
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
                  top: 10,
                  insetInlineStart: '50%',
                  width: '100%',
                  height: 2,
                  background: next.reached ? '#22c55e' : '#e2e8f0',
                  zIndex: 0,
                  transition: 'background 0.3s',
                }} />
              )}
              <span style={{
                position: 'relative', zIndex: 1,
                display: 'inline-flex', width: 22, height: 22, borderRadius: '50%',
                alignItems: 'center', justifyContent: 'center',
                background: dotColor, color: dotTextColor,
                fontSize: 11, fontWeight: 700,
                boxShadow: s.current ? `0 0 0 4px ${tint}26` : 'none',
                transition: 'box-shadow 0.2s, background 0.2s',
              }}>
                {s.reached ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                ) : (
                  <span>{i + 1}</span>
                )}
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
  maxWidth: 480, margin: '0 auto', padding: '16px 14px 24px',
  // SF Pro / system stack first — closer to UberEats / Apple-style
  // typography on iOS where most customers open these tracking pages.
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 12,
  fontFeatureSettings: '"ss01" on, "cv11" on',
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: '14px 16px',
  // Replace hard 1px border with a layered shadow for visual depth
  // without busy rectangles. Same pattern UberEats uses.
  boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
};

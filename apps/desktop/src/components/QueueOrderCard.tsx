/**
 * QueueOrderCard — single in-flight takeout/delivery ticket card for
 * the restaurant queue canvas.
 *
 * Displays ticket number, customer info, service-type pill, age badge,
 * inline item list with kitchen status, aggregate kitchen status pill
 * with a colored border, and an actions row with every ticket control
 * the operator needs (park, resume, recall, add items, complete, etc.).
 *
 * Theme: CSS vars only — no hardcoded colours.
 * RTL-safe: logical CSS properties (margin-inline-start).
 * Light + dark: colorScheme on form controls.
 */

import React, { useEffect, useState, useRef } from 'react';
import { t as translate, type DesktopLocale } from '../lib/i18n';
import {
  resolveRestaurantServiceType,
  RESTAURANT_SERVICE_VISUALS,
  shouldShowServicePill,
  ORDER_DECLINE_REASONS,
  resolveLocalized,
  type OrderDeclineReason,
} from '@qflo/shared';
import type { Ticket } from '../lib/types';

// ---------------------------------------------------------------------------
// Item type (subset of KitchenItem — only what the card needs)
// ---------------------------------------------------------------------------
export interface OrderCardItem {
  id: string;
  ticket_id: string;
  name: string;
  qty: number;
  note: string | null;
  unit_price?: number | null;
  kitchen_status: 'new' | 'in_progress' | 'ready' | 'served';
}

// ---------------------------------------------------------------------------
// Aggregate kitchen status
// ---------------------------------------------------------------------------
export type AggStatus = 'new' | 'preparing' | 'ready' | 'mixed' | 'none';

export function aggregateKitchenStatus(items: OrderCardItem[]): AggStatus {
  if (items.length === 0) return 'none';
  const active = items.filter((i) => i.kitchen_status !== 'served');
  if (active.length === 0) return 'ready'; // all served = effectively done
  const statuses = new Set(active.map((i) => i.kitchen_status));
  if (statuses.size === 1) {
    const s = [...statuses][0];
    if (s === 'new') return 'new';
    if (s === 'in_progress') return 'preparing';
    if (s === 'ready') return 'ready';
  }
  return 'mixed';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ageMinutes(iso: string | undefined | null): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

function formatAge(min: number, locale: DesktopLocale): string {
  if (min < 1) return locale === 'ar' ? '<1د' : '<1m';
  if (min < 60) return locale === 'ar' ? `${min}د` : `${min}m`;
  const h = Math.floor(min / 60);
  return `${h}h${min % 60 ? `${min % 60}m` : ''}`;
}

function getCustomerName(customerData: Record<string, any>): string | null {
  return customerData?.name || customerData?.customer_name || null;
}

function getCustomerPhone(customerData: Record<string, any>): string | null {
  return customerData?.phone || customerData?.customer_phone || null;
}

function formatMoney(amount: number, currency: string, decimals: number): string {
  return `${currency}${amount.toFixed(decimals)}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface QueueOrderCardProps {
  ticket: Ticket;
  items: OrderCardItem[];
  isActive: boolean;               // focused / selected by keyboard
  locale: DesktopLocale;
  serviceName: string;             // resolved from names.services
  currency: string;
  decimals: number;
  // Actions — all optional so callers can pass only what applies
  onFocus: (ticketId: string) => void;
  onPark: (ticketId: string) => void;
  onResume: (ticketId: string) => void;    // resumeParked
  onRecall: (ticketId: string) => void;
  onAddItems: (ticket: Ticket) => void;    // opens OrderPad
  onCall: (ticketId: string) => void;          // waiting → called
  onStartServing: (ticketId: string) => void;  // called → serving (or waiting → called → serving)
  onComplete: (ticketId: string) => void;
  onNoShow: (ticketId: string) => void;
  onCancel: (ticketId: string) => void;
  onBan: (ticketId: string) => void;
  onTransfer: (ticketId: string) => void;
  onRequeue: (ticketId: string) => void;
  onItemNote: (itemId: string, note: string) => void;
  /** Online-order Accept (pending_approval → serving). Optional — only the
   *  Queue canvas wires it; the FloorMap doesn't see pending_approval cards. */
  onAcceptOrder?: (ticketId: string, etaMinutes: number) => void;
  onDeclineOrder?: (ticketId: string, reasonKey: string, note: string) => void;
  /** Computed default ETA from cart items' prep times — passed in by parent
   *  because that's where the items array is fully resolved. */
  suggestedEtaMinutes?: number;
  /** Delivery dispatch handlers. Surfaced only on delivery + serving cards.
   *  onDispatch: stamps dispatched_at, sends "out for delivery" WA.
   *  onArrived: stamps arrived_at, sends "driver has arrived" WA.
   *  onDelivered: stamps delivered_at, status → served, sends receipt WA. */
  onDispatchOrder?: (ticketId: string) => void;
  onArriveOrder?: (ticketId: string) => void;
  onDeliverOrder?: (ticketId: string) => void;
  /** Driver portal URL captured from /api/orders/dispatch's response.
   *  When present we render a copy + open button-pair on the card so
   *  the operator can re-paste the link to the rider at any time
   *  without having to dispatch again. */
  riderLink?: string | null;
  /** Re-fetch the driver link (calls dispatch idempotently). Used when
   *  the operator opens Station after a previous shift and needs the
   *  link for an already-dispatched ticket whose URL isn't in memory. */
  onCopyRiderLink?: (ticketId: string) => void;
  /** Available in-house riders (active only, scoped to the org).
   *  Surfaced on the Assign dropdown for delivery+serving tickets
   *  that don't have a rider assigned yet. */
  availableRiders?: Array<{ id: string; name: string; phone: string; last_seen_at: string | null }>;
  /** Operator clicks Assign + picks a rider. Calls /api/orders/assign;
   *  rider gets a WA notification (or queued in outbox if their 24h
   *  window is closed). */
  onAssignRider?: (ticketId: string, riderId: string) => void;
  /** Currently assigned rider (resolved by parent from
   *  ticket.assigned_rider_id → riders table). Shown on the
   *  "Awaiting" / "Out for delivery" stage pill. */
  assignedRider?: { id: string; name: string; phone: string } | null;
}

// ---------------------------------------------------------------------------
// Per-item note editor (inline)
// ---------------------------------------------------------------------------
export function ItemNoteEditor({
  item,
  locale,
  onSave,
  onClose,
}: {
  item: OrderCardItem;
  locale: DesktopLocale;
  onSave: (note: string) => void;
  onClose: () => void;
}) {
  const tl = (key: string) => translate(locale, key);
  const [draft, setDraft] = useState(item.note ?? '');
  const taRef = useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    taRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        marginTop: 4, padding: 8,
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 200))}
        placeholder={tl('no onions, well done...')}
        rows={2}
        style={{
          width: '100%', resize: 'vertical', padding: '5px 8px',
          background: 'var(--surface)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 6,
          fontSize: 12, fontFamily: 'inherit',
          colorScheme: 'light dark',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => onSave(draft.trim())}
          style={btnStyle('var(--primary, #3b82f6)')}
        >
          {tl('Save')}
        </button>
        <button
          onClick={onClose}
          style={btnStyle('var(--text2)', true)}
        >
          {tl('Cancel')}
        </button>
        {item.note && (
          <button
            onClick={() => onSave('')}
            style={btnStyle('var(--danger, #ef4444)', true)}
          >
            {tl('Clear')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function QueueOrderCard({
  ticket,
  items,
  isActive,
  locale,
  serviceName,
  currency,
  decimals,
  onFocus,
  onPark,
  onResume,
  onRecall,
  onAddItems,
  onCall,
  onStartServing,
  onComplete,
  onNoShow,
  onCancel,
  onBan,
  onTransfer,
  onRequeue,
  onItemNote,
  onAcceptOrder,
  onDeclineOrder,
  suggestedEtaMinutes,
  onDispatchOrder,
  onArriveOrder,
  onDeliverOrder,
  riderLink,
  onCopyRiderLink,
  availableRiders,
  onAssignRider,
  assignedRider,
}: QueueOrderCardProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  // itemId → note editor open
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  const tl = (key: string, values?: Record<string, string | number | null | undefined>) =>
    translate(locale, key, values);

  const aggStatus = aggregateKitchenStatus(items);
  const age = ageMinutes(ticket.called_at ?? ticket.created_at);
  const isParked = ticket.status === 'waiting' && !!ticket.parked_at;
  const isWaiting = ticket.status === 'waiting' && !ticket.parked_at;
  const isCalled = ticket.status === 'called';
  const isServing = ticket.status === 'serving';
  // Online order awaiting operator decision — comes in via /m/<slug> or WA.
  const isPending = ticket.status === 'pending_approval';
  // ONLINE pill for orders that arrived via WhatsApp / web menu — distinct
  // from walk-in tickets the operator typed in themselves.
  const isOnlineOrder = ticket.source === 'whatsapp' || ticket.source === 'web';

  // Local UI state for the pending_approval inline panel.
  const [etaInput, setEtaInput] = useState<number>(() => suggestedEtaMinutes ?? 20);
  const [decliningOpen, setDecliningOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState<OrderDeclineReason>('too_busy');
  const [declineNote, setDeclineNote] = useState('');

  // Re-snap ETA whenever the parent recomputes from the cart items.
  React.useEffect(() => {
    if (typeof suggestedEtaMinutes === 'number' && suggestedEtaMinutes > 0) {
      setEtaInput(suggestedEtaMinutes);
    }
  }, [suggestedEtaMinutes]);

  // Parsed delivery address (stored as JSON-stringified TEXT in local SQLite).
  const deliveryAddress = (() => {
    const raw = (ticket as any).delivery_address;
    if (!raw) return null;
    if (typeof raw === 'object') return raw as Record<string, any>;
    try { return JSON.parse(raw) as Record<string, any>; } catch { return null; }
  })();

  // Service type pill
  const svcType = resolveRestaurantServiceType(serviceName);
  const showSvcPill = shouldShowServicePill(svcType);
  const svcVisuals = showSvcPill ? RESTAURANT_SERVICE_VISUALS[svcType] : null;
  const svcLabel = svcType === 'takeout' ? tl('Takeout')
    : svcType === 'delivery' ? tl('Delivery')
    : svcType === 'dine_in' ? tl('Dine in')
    : '';

  // Age badge color
  const ageColor = age < 5 ? 'var(--success, #22c55e)'
    : age < 10 ? 'var(--warning, #f59e0b)'
    : 'var(--danger, #ef4444)';

  // Aggregate status: border color
  const aggBorderColor = aggStatus === 'ready' ? 'var(--success, #22c55e)'
    : aggStatus === 'preparing' ? 'var(--warning, #f59e0b)'
    : aggStatus === 'mixed' ? 'var(--warning, #f59e0b)'
    : isActive ? 'var(--primary, #3b82f6)'
    : 'var(--border)';

  // Status pill
  const statusLabel = isParked ? tl('Parked')
    : isPending ? tl('AWAITING APPROVAL')
    : isWaiting ? tl('WAITING')
    : isCalled ? tl('CALLING')
    : isServing ? tl('NOW SERVING')
    : ticket.status;
  const statusColor = isParked ? 'var(--text3)'
    : isPending ? '#a855f7' // purple — distinct from waiting/calling/serving
    : isWaiting ? 'var(--text3)'
    : isCalled ? '#3b82f6'
    : isServing ? '#22c55e'
    : 'var(--text3)';

  // Running total
  const total = items.reduce((sum, i) => sum + (i.unit_price ?? 0) * i.qty, 0);
  const itemCount = items.reduce((sum, i) => sum + i.qty, 0);

  // Pulse animation when ready
  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: `2px solid ${aggBorderColor}`,
    borderRadius: 12,
    padding: 14,
    cursor: 'pointer',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    boxShadow: isActive
      ? `0 0 0 3px ${aggStatus === 'ready' ? 'rgba(34,197,94,0.25)' : 'rgba(59,130,246,0.25)'}`
      : aggStatus === 'ready'
        ? '0 0 0 2px rgba(34,197,94,0.15), 0 4px 16px rgba(34,197,94,0.1)'
        : '0 2px 8px rgba(0,0,0,0.15)',
    animation: aggStatus === 'ready' ? 'queue-canvas-pulse 2s ease-in-out infinite' : undefined,
  };

  const customerName = getCustomerName(ticket.customer_data) ?? tl('Walk-in Customer');
  const customerPhone = getCustomerPhone(ticket.customer_data);

  return (
    <div
      style={cardStyle}
      onClick={() => onFocus(ticket.id)}
      role="article"
      aria-label={`${ticket.ticket_number} — ${customerName}`}
    >
      {/* Header row: ticket number + age + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
          color: 'var(--text)', letterSpacing: -0.5, lineHeight: 1,
        }}>
          {ticket.ticket_number}
        </span>

        {/* Service-type pill */}
        {svcVisuals && svcLabel && (
          <span style={{
            padding: '2px 8px', borderRadius: 999, fontSize: 11,
            fontWeight: aggStatus === 'ready' ? 800 : 700,
            background: aggStatus === 'ready' ? 'var(--success, #22c55e)' : 'var(--surface2)',
            color: aggStatus === 'ready' ? '#fff' : 'var(--text2)',
            border: aggStatus === 'ready'
              ? '1px solid var(--success, #22c55e)'
              : '1px solid var(--border)',
            lineHeight: 1.5,
            transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
          }}>
            {svcType === 'takeout' ? '🛍️' : svcType === 'delivery' ? '🚲' : ''} {svcLabel}
          </span>
        )}

        {/* Status pill — hidden in 'serving' since the visible
            "+ Add items" + "Complete" buttons already imply serving.
            Still shown for CALLING (urgency cue), Parked (warning),
            and AWAITING APPROVAL (operator must act). */}
        {!isServing && (
          <span style={{
            padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
            background: statusColor + '22', color: statusColor,
            border: `1px solid ${statusColor}55`, lineHeight: 1.5,
            textTransform: 'uppercase',
          }}>
            {statusLabel}
          </span>
        )}

        {/* ONLINE pill — flags tickets that came in via WhatsApp / web menu
            so the operator instantly distinguishes them from walk-ins
            they typed in themselves (matters for tone, billing, liability). */}
        {isOnlineOrder && (
          <span style={{
            padding: '2px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700,
            background: 'rgba(99,102,241,0.15)', color: '#6366f1',
            border: '1px solid rgba(99,102,241,0.4)', lineHeight: 1.5,
            textTransform: 'uppercase',
          }}>
            🌐 {tl('Online')}
          </span>
        )}

        {/* Age badge */}
        <span style={{
          marginInlineStart: 'auto',
          fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
          color: ageColor,
        }}>
          {formatAge(age, locale)}
        </span>

      </div>

      {/* Customer row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1 }} dir="auto">
          {customerName}
        </span>
        {customerPhone && (
          <a
            href={`tel:${customerPhone}`}
            style={{
              fontSize: 12, color: 'var(--primary, #3b82f6)',
              textDecoration: 'none', direction: 'ltr',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {customerPhone}
          </a>
        )}
      </div>

      {/* Delivery address — shown for delivery orders so the rider knows
          where to go without digging through customer notes. When the
          customer shared a WA location pin (lat + lng), we surface a
          clickable "Open in Maps" pill that opens the right map app on
          the operator's device — Google Maps on Android / desktop, Apple
          Maps on iOS — for one-tap navigation. */}
      {svcType === 'delivery' && (deliveryAddress?.street || (deliveryAddress?.lat && deliveryAddress?.lng)) && (() => {
        const lat = typeof deliveryAddress?.lat === 'number' ? deliveryAddress.lat : null;
        const lng = typeof deliveryAddress?.lng === 'number' ? deliveryAddress.lng : null;
        const hasPin = lat != null && lng != null;
        const mapsHref = hasPin
          ? `https://www.google.com/maps/?q=${encodeURIComponent(`${lat},${lng}`)}`
          : null;
        return (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 6,
            fontSize: 12, color: 'var(--text2)',
            padding: '6px 8px', borderRadius: 6,
            background: 'var(--surface2)', border: '1px solid var(--border)',
          }}>
            <span>📍</span>
            <div style={{ flex: 1, lineHeight: 1.4, minWidth: 0 }}>
              {deliveryAddress?.street && (
                <div style={{ fontWeight: 600, color: 'var(--text)', wordBreak: 'break-word' }} dir="auto">
                  {deliveryAddress.street}
                </div>
              )}
              {deliveryAddress?.city && <div>{deliveryAddress.city}</div>}
              {/* When a customer-shared pin is attached, the street text
                  is whatever Nominatim snapped to (often the wrong house
                  number on long blocks). Tell the operator the pin —
                  not the text — is the navigation source of truth. */}
              {hasPin && deliveryAddress?.street && (
                <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text3, #94a3b8)', fontStyle: 'italic' }}>
                  {tl('Address approximate — use pin')}
                </div>
              )}
              {deliveryAddress?.instructions && (
                <div style={{ marginTop: 2, fontStyle: 'italic' }}>{deliveryAddress.instructions}</div>
              )}
              {mapsHref && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: 'inline-block', marginTop: 6,
                    padding: '5px 12px', borderRadius: 6,
                    fontSize: 12, fontWeight: 700,
                    background: '#3b82f6', color: '#fff',
                    border: '1px solid #2563eb',
                    textDecoration: 'none',
                  }}
                >
                  📍 {tl('Go to pin')}
                </a>
              )}
            </div>
          </div>
        );
      })()}

      {/* Dispatched-state row — pill + driver link. Once the operator
          hits Dispatch, the card shows "🛵 Out for delivery" plus the
          driver portal URL with copy + open buttons so the operator
          can re-paste the link to the driver at any time without
          dispatching again. The link is the same HMAC-token URL the
          dispatch API returns; we expose it here as a button-pair so
          it's one tap to copy or open in a browser tab.
          Falls back to a "Get driver link" button when riderLink isn't
          known yet (e.g. ticket was dispatched in a previous Station
          session and the operator just reopened the app). */}
      {svcType === 'delivery' && isServing && (ticket as any).dispatched_at && (() => {
        // Stage-aware pill — reflects exactly where the rider is in
        // the lifecycle. Three colour-coded stages match the
        // customer-facing page so a glance tells the same story on
        // both ends. Rider name is shown when we have one (loaded
        // from /api/riders into availableRiders), so the operator
        // sees "Out for delivery — Mehdi" not just "Out for delivery".
        const isArrived = Boolean((ticket as any).arrived_at);
        const stage = isArrived
          ? { label: tl('At the door'), emoji: '🚪', tint: '#22c55e' }   // green
          : { label: tl('Out for delivery'), emoji: '🛵', tint: '#f59e0b' }; // amber
        const stageLabel = assignedRider
          ? `${stage.label} — ${assignedRider.name}`
          : stage.label;
        // Operator track URL — opens the customer-facing tracking
        // page. That page is read-only (no GPS streaming from the
        // browser), so the operator can monitor the rider's live
        // position without their own browser corrupting the
        // rider_locations stream. Same view the customer sees.
        const cloudUrl = 'https://qflo.net';
        const customerTrack = `${cloudUrl}/q/${(ticket as any).qr_token}`;
        return (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6,
          padding: '8px 10px', borderRadius: 8,
          background: `${stage.tint}15`,
          border: `1px solid ${stage.tint}55`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700,
              background: `${stage.tint}25`, color: stage.tint,
              border: `1px solid ${stage.tint}66`,
            }}>
              {stage.emoji} {stageLabel}
            </div>
            {/* WhatsApp notification status — durable retries per
                whatsapp-outbox.ts. Polls every 30s; flips to red
                with a Resend button when all retries are exhausted. */}
            <NotifyStatusBadge ticketId={ticket.id} locale={locale} />
            {/* Track button — opens the customer tracking page (the
                read-only view) in a new tab. Operator sees rider
                position without streaming GPS from their own
                browser. */}
            {(ticket as any).qr_token && (
              <a
                href={customerTrack}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  marginInlineStart: 'auto',
                  padding: '2px 8px', borderRadius: 999,
                  fontSize: 10, fontWeight: 700,
                  background: 'transparent', color: stage.tint,
                  border: `1px solid ${stage.tint}66`,
                  textDecoration: 'none',
                }}
              >
                🗺️ {tl('Track')}
              </a>
            )}
            {/* Unassign — pulls the order back from the rider mid-flight.
                Operator uses this when a rider is unresponsive or needs
                reshuffling. Clears assigned_rider_id + dispatched_at via
                /api/orders/assign with riderId=null. */}
            {onAssignRider && (
              <button
                onClick={(e) => { e.stopPropagation(); onAssignRider(ticket.id, '__unassign'); }}
                title={tl('Pull this order back from the rider')}
                style={{
                  padding: '2px 8px', borderRadius: 999,
                  fontSize: 10, fontWeight: 700,
                  background: 'transparent', color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.5)',
                  cursor: 'pointer',
                }}
              >
                ✕ {tl('Unassign')}
              </button>
            )}
          </div>
          {riderLink ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              <input
                type="text"
                readOnly
                value={riderLink}
                onClick={(e) => { (e.target as HTMLInputElement).select(); }}
                onFocus={(e) => { e.target.select(); }}
                style={{
                  flex: 1, minWidth: 0,
                  padding: '4px 6px', borderRadius: 4,
                  fontSize: 10, fontFamily: 'monospace',
                  border: '1px solid var(--border)',
                  background: 'var(--surface, #fff)',
                  color: 'var(--text)',
                  colorScheme: 'light dark' as any,
                }}
              />
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await navigator.clipboard.writeText(riderLink);
                  } catch {
                    // Last-ditch fallback for old Electron contexts
                    // without async clipboard — select the input.
                    const el = (e.currentTarget.previousSibling as HTMLInputElement | null);
                    el?.select();
                    try { document.execCommand('copy'); } catch {}
                  }
                }}
                title={tl('Copy driver link to clipboard')}
                style={{
                  padding: '4px 10px', borderRadius: 4,
                  fontSize: 10, fontWeight: 700,
                  background: '#3b82f6', color: '#fff',
                  border: 'none', cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                📋 {tl('Copy')}
              </button>
              <a
                href={riderLink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={tl('Open driver portal in a new tab')}
                style={{
                  padding: '4px 10px', borderRadius: 4,
                  fontSize: 10, fontWeight: 700,
                  background: 'transparent', color: '#3b82f6',
                  border: '1px solid #3b82f6',
                  textDecoration: 'none',
                  flexShrink: 0,
                }}
              >
                🔗 {tl('Open')}
              </a>
            </div>
          ) : (onCopyRiderLink && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopyRiderLink(ticket.id); }}
              style={{
                alignSelf: 'flex-start',
                padding: '4px 10px', borderRadius: 4,
                fontSize: 10, fontWeight: 700,
                background: '#3b82f6', color: '#fff',
                border: 'none', cursor: 'pointer',
              }}
            >
              📋 {tl('Get driver link')}
            </button>
          ))}
        </div>
        );
      })()}

      {/* Customer-supplied order note — captured during the WhatsApp
          order intake (handleOrderNotesInput) AFTER the address step,
          so it can carry both delivery instructions ("3rd floor, ring
          twice") and food preferences ("no onions, mild spicy") in one
          field. Persisted to BOTH tickets.notes (for direct readers
          like this card) AND customer_data.reason_of_visit (the
          canonical column the rest of Qflo reads). We fall back across
          both so the UI is robust whichever path supplied the value:
          legacy operator-typed notes → tickets.notes; new WA-order
          intake → reason_of_visit. RTL-safe via dir="auto". */}
      {(() => {
        const cd: any = (ticket as any).customer_data ?? {};
        const note: string =
          (typeof ticket.notes === 'string' && ticket.notes.trim())
          || (typeof cd.reason_of_visit === 'string' && cd.reason_of_visit.trim())
          || '';
        if (!note) return null;
        return (
          <div style={{
            padding: '6px 8px', borderRadius: 6,
            background: 'rgba(245,158,11,0.10)',
            border: '1px solid rgba(245,158,11,0.35)',
            fontSize: 12, lineHeight: 1.35,
            color: 'var(--warning, #f59e0b)',
            display: 'flex', gap: 6, alignItems: 'flex-start',
          }}>
            <span style={{ flexShrink: 0 }}>📝</span>
            <span dir="auto" style={{ unicodeBidi: 'isolate', wordBreak: 'break-word', flex: 1, fontStyle: 'italic' }}>
              {note}
            </span>
          </div>
        );
      })()}

      {/* Items list — compact, with inline note + price */}
      {items.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 8,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          {items.map((item) => {
            const isDone = item.kitchen_status === 'served';
            const isReady = item.kitchen_status === 'ready';
            const isPrep = item.kitchen_status === 'in_progress';
            const itemColor = isDone ? 'var(--text3)'
              : isReady ? 'var(--text)'
              : isPrep ? 'var(--warning, #f59e0b)'
              : 'var(--text3)';
            const itemWeight: 400 | 600 | 700 = isReady ? 700 : isPrep ? 600 : 400;
            const hasNote = !!(item.note && item.note.trim());
            const isEditingNote = editingNoteId === item.id;

            return (
              <div key={item.id}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: itemColor, fontWeight: itemWeight,
                  textDecoration: isDone ? 'line-through' : 'none',
                  transition: 'color 0.2s ease, font-weight 0.2s ease',
                }}>
                  <span style={{ fontWeight: 700, minWidth: 20, textAlign: 'start', direction: 'ltr', color: itemColor }}>
                    {item.qty}x
                  </span>
                  <span style={{ flex: 1 }} dir="auto">{item.name}</span>

                  {/* Note indicator button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingNoteId(isEditingNote ? null : item.id);
                    }}
                    title={tl('Kitchen note')}
                    style={{
                      padding: '1px 5px', borderRadius: 4, fontSize: 11,
                      border: `1px solid ${hasNote ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                      background: hasNote ? 'rgba(245,158,11,0.15)' : 'transparent',
                      color: hasNote ? 'var(--warning, #f59e0b)' : 'var(--text3)',
                      cursor: 'pointer', lineHeight: 1, flexShrink: 0,
                    }}
                    aria-label={tl('Kitchen note')}
                  >
                    💬
                  </button>

                  {(item.unit_price ?? 0) > 0 && (
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 11 }}>
                      {formatMoney((item.unit_price ?? 0) * item.qty, currency, decimals)}
                    </span>
                  )}
                </div>

                {/* Note rendered on its own line under the item, indented
                    past the qty column so it visually associates with the
                    line above. Italic amber matches the kitchen-instruction
                    convention used elsewhere in the system. */}
                {item.note && !isEditingNote && (
                  <div style={{
                    marginInlineStart: 26,
                    fontSize: 11,
                    color: 'var(--warning, #f59e0b)',
                    fontStyle: 'italic',
                    lineHeight: 1.3,
                    marginTop: 1,
                  }}>
                    {item.note}
                  </div>
                )}

                {/* Inline note editor */}
                {isEditingNote && (
                  <ItemNoteEditor
                    item={item}
                    locale={locale}
                    onSave={(note) => {
                      onItemNote(item.id, note);
                      setEditingNoteId(null);
                    }}
                    onClose={() => setEditingNoteId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer: item count + total + aggregate kitchen status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderTop: items.length > 0 ? '1px solid var(--border)' : undefined,
        paddingTop: items.length > 0 ? 6 : 0,
      }}>
        {items.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text3)', flex: 1 }}>
            {itemCount} {tl('items')} {total > 0 ? `· ${formatMoney(total, currency, decimals)}` : ''}
          </span>
        )}
        {/* Aggregate-status pill removed — the service-type badge in the
            header now carries the "ready" signal (turns green) and the
            card border + glow already encode preparing / mixed. */}
      </div>

      {/* Actions row — clicks do NOT toggle expand */}
      <div
        style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 2 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pending online order: Accept (with editable ETA) / Decline (with reason).
            We render this entire block in place of the normal call/serve buttons —
            the operator can't legitimately Call or Serve a not-yet-accepted order. */}
        {isPending && onAcceptOrder && onDeclineOrder && !decliningOpen && (
          <>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 8px', borderRadius: 6,
                background: 'var(--surface2)', border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{tl('ETA')}</span>
              <button
                type="button"
                onClick={() => setEtaInput((v) => Math.max(5, v - 5))}
                style={{ ...btnStyle('var(--text2)', true), padding: '2px 8px' }}
                aria-label="Decrease ETA"
              >−</button>
              <span style={{ minWidth: 36, textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {etaInput} min
              </span>
              <button
                type="button"
                onClick={() => setEtaInput((v) => Math.min(90, v + 5))}
                style={{ ...btnStyle('var(--text2)', true), padding: '2px 8px' }}
                aria-label="Increase ETA"
              >+</button>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onAcceptOrder(ticket.id, etaInput); }}
              style={btnStyle('var(--success, #22c55e)')}
            >
              ✓ {tl('Accept')}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setDecliningOpen(true); }}
              style={btnStyle('var(--danger, #ef4444)', true)}
            >
              {tl('Decline')}
            </button>
          </>
        )}
        {isPending && decliningOpen && onDeclineOrder && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', gap: 6,
              padding: 8, borderRadius: 8,
              background: 'var(--surface2)', border: '1px solid var(--danger, #ef4444)55',
            }}
          >
            <select
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value as OrderDeclineReason)}
              style={{
                padding: '6px 8px', borderRadius: 6, fontSize: 12,
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border)', colorScheme: 'light dark',
              }}
            >
              {ORDER_DECLINE_REASONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {resolveLocalized(r.label, locale === 'ar' ? 'ar' : locale === 'en' ? 'en' : 'fr')}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value.slice(0, 200))}
              placeholder={tl('Optional note for the customer')}
              style={{
                padding: '6px 8px', borderRadius: 6, fontSize: 12,
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border)',
              }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => {
                  const spec = ORDER_DECLINE_REASONS.find((r) => r.key === declineReason);
                  if (spec?.requires_note && !declineNote.trim()) return; // UI guard
                  onDeclineOrder(ticket.id, declineReason, declineNote.trim());
                  setDecliningOpen(false);
                }}
                style={btnStyle('var(--danger, #ef4444)')}
              >
                {tl('Confirm decline')}
              </button>
              <button
                onClick={() => { setDecliningOpen(false); setDeclineNote(''); }}
                style={btnStyle('var(--text2)', true)}
              >
                {tl('Cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Primary action depends on status */}
        {isParked && (
          <button
            onClick={() => onResume(ticket.id)}
            style={btnStyle('var(--primary, #3b82f6)')}
          >
            {tl('Resume')}
          </button>
        )}
        {/* Waiting (fresh ticket): operator picks Call (announce only)
            or Serve (skip the call, jump straight to serving). Same two
            actions as the rail-list rows, surfaced here so brand-new
            takeout/delivery orders are actionable from the canvas
            without first having to find them in the queue panel. */}
        {isWaiting && (
          <>
            <button
              onClick={() => onCall(ticket.id)}
              style={btnStyle('var(--primary, #3b82f6)', true)}
            >
              {tl('Call')}
            </button>
            <button
              onClick={() => onStartServing(ticket.id)}
              style={btnStyle('var(--success, #22c55e)', true)}
            >
              {tl('Serve')}
            </button>
          </>
        )}
        {isCalled && (
          <button
            onClick={() => onStartServing(ticket.id)}
            style={btnStyle('var(--success, #22c55e)', true)}
          >
            {tl('Serve')}
          </button>
        )}
        {isServing && (() => {
          // Lifecycle-staged actions. Only ONE primary action appears
          // at a time based on the ticket's current delivery state, so
          // the operator never has to think about which button matters
          // right now. Earlier we showed Dispatch + Arrived + Delivered
          // + Add items simultaneously after dispatch — visual noise
          // and a real risk of clicking the wrong one.
          //
          // Delivery flow:
          //   serving, !dispatched         → Dispatch  + Add items
          //   serving, dispatched, !arrived → Arrived (only)
          //   serving, dispatched, arrived  → Delivered (only)
          //
          // Takeout / dine-in: just one Complete button (no rider
          // lifecycle to walk through).
          const isDeliveryTicket = svcType === 'delivery';
          const isDispatched = Boolean((ticket as any).dispatched_at);
          const isArrived = Boolean((ticket as any).arrived_at);

          const isAssignedToRider = Boolean((ticket as any).assigned_rider_id);
          if (isDeliveryTicket && (onDispatchOrder || onDeliverOrder)) {
            // Stage 1 — kitchen done, no rider yet. Show Assign
            // dropdown if the org has riders configured AND we have a
            // handler. Falls back to legacy Dispatch button when no
            // riders are set up (or when assignment isn't wired in
            // this canvas). Once a rider IS assigned but hasn't
            // accepted, show a passive "Awaiting Mehdi" pill — the
            // ACCEPT comes from the rider's WhatsApp, not from the
            // operator clicking anything.
            if (!isDispatched) {
              if (isAssignedToRider) {
                return (
                  <div style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(245,158,11,0.10)',
                    border: '1px solid rgba(245,158,11,0.4)',
                    color: '#f59e0b', fontSize: 12, fontWeight: 700,
                  }}>
                    ⏳ {tl('Pending')} — {assignedRider?.name ?? tl('rider')}
                    {/* Reassign control — small text link in case the
                        operator picked the wrong rider or the rider
                        is unresponsive. Triggers another rider pick. */}
                    {onAssignRider && availableRiders && availableRiders.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const newRiderId = e.target.value;
                          if (newRiderId) onAssignRider(ticket.id, newRiderId);
                        }}
                        style={{
                          marginInlineStart: 'auto',
                          padding: '2px 6px', borderRadius: 4,
                          background: 'transparent', color: '#f59e0b',
                          border: '1px dashed rgba(245,158,11,0.5)',
                          fontSize: 11, fontWeight: 600,
                          colorScheme: 'light dark' as any,
                        }}
                      >
                        <option value="" disabled hidden>{tl('Reassign')}</option>
                        {availableRiders.filter((r) => r.id !== assignedRider?.id).map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    )}
                    {/* Cancel — pulls the assignment back before the
                        rider has accepted. Same /api/orders/assign with
                        riderId=null sentinel. */}
                    {onAssignRider && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAssignRider(ticket.id, '__unassign'); }}
                        title={tl('Cancel assignment — rider has not accepted yet')}
                        style={{
                          marginInlineStart: availableRiders && availableRiders.length > 0 ? 0 : 'auto',
                          padding: '2px 8px', borderRadius: 4,
                          background: 'transparent', color: '#ef4444',
                          border: '1px solid rgba(239,68,68,0.5)',
                          fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        ✕ {tl('Cancel')}
                      </button>
                    )}
                  </div>
                );
              }
              if (onAssignRider && availableRiders && availableRiders.length > 0) {
                return (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const riderId = e.target.value;
                      if (riderId) onAssignRider(ticket.id, riderId);
                    }}
                    style={{
                      flex: 1, padding: '10px 14px', borderRadius: 10,
                      background: 'rgba(245,158,11,0.08)', color: '#f59e0b',
                      border: '2px solid rgba(245,158,11,0.7)',
                      fontWeight: 800, fontSize: 14,
                      cursor: 'pointer',
                      colorScheme: 'light dark' as any,
                    }}
                  >
                    <option value="" disabled hidden>🛵 {tl('Assign rider')}…</option>
                    {availableRiders.map((r) => (
                      <option key={r.id} value={r.id} style={{ background: 'var(--surface)', color: 'var(--text)' }}>
                        {r.name}{r.last_seen_at && (Date.now() - new Date(r.last_seen_at).getTime() < 24 * 60 * 60 * 1000)
                          ? '  ✓ online'
                          : '  ⚠ may be offline'}
                      </option>
                    ))}
                  </select>
                );
              }
              // Empty-state: no riders configured yet. Show a tappable
              // prompt that opens Business Admin → Drivers so the
              // operator knows where to add one. Replaces the legacy
              // Dispatch button which was the wrong affordance here
              // (we want them to set up riders, not dispatch a non-
              // existent driver).
              if (onAssignRider) {
                return (
                  <button
                    onClick={() => {
                      const evt = new CustomEvent('qf:open-business-admin', { detail: { tab: 'riders' } });
                      window.dispatchEvent(evt);
                    }}
                    style={{
                      flex: 1, padding: '8px 10px', borderRadius: 8,
                      background: 'transparent', color: '#f59e0b',
                      border: '1px dashed rgba(245,158,11,0.5)',
                      fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    }}
                    title={tl('Open Business Admin → Drivers')}
                  >
                    🛵 + {tl('Add a driver to assign this order')}
                  </button>
                );
              }
              // Legacy Dispatch fallback (operator cards that don't
              // wire onAssignRider — e.g. from older Station builds
              // still propagating).
              return onDispatchOrder ? (
                <button
                  onClick={() => onDispatchOrder(ticket.id)}
                  style={{ ...btnStyle('#f59e0b'), flex: 1, fontSize: 13, fontWeight: 700 }}
                  title={tl('Notify customer the order is on its way')}
                >
                  🛵 {tl('Dispatch')}
                </button>
              ) : null;
            }
            // Stage 2 — Arrived. Hide Dispatch + Delivered + Add items
            // so the operator's only active choice is "the driver has
            // arrived at the door".
            if (!isArrived) {
              return onArriveOrder ? (
                <button
                  onClick={() => onArriveOrder(ticket.id)}
                  style={{ ...btnStyle('#3b82f6'), flex: 1, fontSize: 13, fontWeight: 700 }}
                  title={tl('Notify customer the driver has arrived')}
                >
                  🚪 {tl('Arrived')}
                </button>
              ) : null;
            }
            // Stage 3 — Delivered. Same single-action rule: hand-off
            // is the only remaining step.
            return onDeliverOrder ? (
              <button
                onClick={() => onDeliverOrder(ticket.id)}
                style={{ ...btnStyle('var(--success, #22c55e)'), flex: 1, fontSize: 13, fontWeight: 700 }}
                title={tl('Mark as delivered and notify the customer')}
              >
                ✓ {tl('Delivered')}
              </button>
            ) : null;
          }
          // Takeout / dine-in fallback — one button.
          return (
            <button
              onClick={() => onComplete(ticket.id)}
              style={btnStyle('var(--success, #22c55e)', true)}
            >
              {tl('Complete')}
            </button>
          );
        })()}
        {/* Add items — visible only while the kitchen is actively
            preparing. Once the operator dispatches the rider the kitchen
            has already finished; adding items at that point would
            require recalling the rider and re-cooking, which is a
            workflow we don't model. So Add items disappears after
            dispatch on delivery tickets, and stays available for
            takeout/dine-in until Complete. */}
        {isServing && (svcType !== 'delivery' || !((ticket as any).dispatched_at)) && (
          <button
            onClick={() => onAddItems(ticket)}
            style={btnStyle('var(--primary, #3b82f6)', true)}
          >
            + {tl('Add items')}
          </button>
        )}

        {/* Recall — for parked or called */}
        {(isParked || isCalled) && (
          <button
            onClick={() => onRecall(ticket.id)}
            style={btnStyle('var(--text2)', true)}
          >
            {tl('Recall')} {ticket.recall_count > 0 ? `(${ticket.recall_count})` : ''}
          </button>
        )}

        {/* Overflow menu */}
        <OverflowMenu
          open={showOverflow}
          onClose={() => setShowOverflow(false)}
          trigger={
            <button
              onClick={(e) => { e.stopPropagation(); setShowOverflow((v) => !v); }}
              style={{
                padding: '4px 8px', borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text2)',
                cursor: 'pointer', fontSize: 14, lineHeight: 1,
              }}
              aria-label={tl('More actions')}
              aria-expanded={showOverflow}
            >
              ···
            </button>
          }
        >
              {(isCalled || isServing) && (
                <OverflowItem label={tl('Park')} color="var(--text2)" onClick={() => { setShowOverflow(false); onPark(ticket.id); }} />
              )}
              {!isCalled && !isServing && (
                <OverflowItem label={tl('No Show')} color="var(--warning, #f59e0b)" onClick={() => { setShowOverflow(false); onNoShow(ticket.id); }} />
              )}
              <OverflowItem label={tl('Back to Queue')} color="var(--text2)" onClick={() => { setShowOverflow(false); onRequeue(ticket.id); }} />
              <OverflowItem label={tl('Transfer')} color="var(--text2)" onClick={() => { setShowOverflow(false); onTransfer(ticket.id); }} />
              <OverflowItem label={tl('Cancel')} color="var(--danger, #ef4444)" onClick={() => { setShowOverflow(false); onCancel(ticket.id); }} />
              <OverflowItem label={tl('Ban')} color="var(--danger, #ef4444)" onClick={() => { setShowOverflow(false); onBan(ticket.id); }} />
        </OverflowMenu>
      </div>
    </div>
  );
}

/**
 * Anchored popover menu with click-outside + Escape-to-close.
 *
 * The previous inline implementation only closed on `onMouseLeave`, which
 * left the menu permanently open if the operator's cursor never crossed
 * its boundary (e.g. they tapped via touch, or moved sideways onto another
 * card). This wrapper attaches a single document-level pointerdown listener
 * while open and dismisses the menu the moment the click lands outside the
 * wrapper element. Esc also closes for keyboard parity.
 */
function OverflowMenu({
  open,
  onClose,
  trigger,
  children,
}: {
  open: boolean;
  onClose: () => void;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDocDown = (ev: MouseEvent | TouchEvent) => {
      const root = wrapRef.current;
      if (!root) return;
      const target = ev.target as Node;
      if (!root.contains(target)) onClose();
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    // pointerdown is more reliable than click — it fires before focus shifts
    // and works for touch + mouse uniformly. Schedule one tick later so the
    // same pointerdown that opened the menu doesn't immediately close it.
    const id = setTimeout(() => {
      document.addEventListener('pointerdown', onDocDown);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return (
    <div ref={wrapRef} style={{ position: 'relative', marginInlineStart: 'auto' }}>
      {trigger}
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', bottom: '100%', insetInlineEnd: 0,
            marginBottom: 4, background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 10,
            padding: '4px 0', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 50, minWidth: 160,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function btnStyle(color: string, outline = false): React.CSSProperties {
  return {
    padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
    fontSize: 12, fontWeight: 700, lineHeight: 1.3,
    border: outline ? `1px solid ${color}55` : 'none',
    background: outline ? `${color}15` : color,
    color: outline ? color : '#fff',
    transition: 'opacity 0.15s',
  };
}

function OverflowItem({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'start',
        padding: '9px 16px', border: 'none', background: 'transparent',
        cursor: 'pointer', fontSize: 13, fontWeight: 600, color,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

/**
 * Small notification-status pill on each delivery card. Polls
 * /api/notifications/status every 30s for the latest WhatsApp job
 * tied to this ticket and shows one of:
 *
 *   pending   ⏳ Notifying            (amber, retries in flight)
 *   sent      ✓  Sent                 (green, accepted by Meta)
 *   delivered ✓✓ Delivered            (green, on the customer's phone)
 *   read      ✓✓ Read                 (blue, customer opened the chat)
 *   failed    ✕  Notify failed [Resend] (red, all retries exhausted)
 *
 * Click "Resend" to re-queue the job for an immediate retry.
 */
export function NotifyStatusBadge({ ticketId, locale }: { ticketId: string; locale: DesktopLocale }) {
  const tl = (key: string) => translate(locale, key);
  const [job, setJob] = useState<{
    id: string; status: string; attempts: number; max_attempts: number;
    last_error: string | null; meta_status: string | null;
  } | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`https://qflo.net/api/notifications/status?ticketIds=${ticketId}`, {
          method: 'GET',
        });
        const data = await res.json();
        if (cancelled) return;
        const j = (data?.jobs ?? []).find((r: any) => r.ticket_id === ticketId);
        setJob(j ? {
          id: j.id, status: j.status, attempts: j.attempts, max_attempts: j.max_attempts,
          last_error: j.last_error, meta_status: j.meta_status,
        } : null);
      } catch { /* network blip — try again on next tick */ }
    };
    fetchStatus();
    // 30s cadence: tight enough to catch sent → delivered → read
    // transitions reasonably fast, slack enough not to thrash the
    // endpoint on a busy queue.
    timer = setInterval(fetchStatus, 30_000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [ticketId]);

  if (!job) return null;

  // Resolve display state. Meta-side status takes precedence over
  // our local status — if Meta said "delivered", we know more than
  // our outbox row (which only knows we shipped to Meta).
  const display = job.meta_status === 'read' ? 'read'
    : job.meta_status === 'delivered' ? 'delivered'
    : job.meta_status === 'failed' ? 'failed'
    : job.status === 'sent' ? 'sent'
    : job.status === 'failed' ? 'failed'
    : 'pending';

  const palette = display === 'read'      ? { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6', text: '✓✓ ' + tl('Read') }
    : display === 'delivered'             ? { bg: 'rgba(34,197,94,0.12)', fg: '#16a34a',  text: '✓✓ ' + tl('Delivered to phone') }
    : display === 'sent'                  ? { bg: 'rgba(34,197,94,0.10)', fg: '#16a34a',  text: '✓ ' + tl('Sent') }
    : display === 'failed'                ? { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444',  text: '✕ ' + tl('Notify failed') }
    :                                       { bg: 'rgba(245,158,11,0.12)', fg: '#f59e0b', text: '⏳ ' + tl('Notifying') + ` (${job.attempts}/${job.max_attempts})` };

  const onResend = async () => {
    setResending(true);
    try {
      await fetch('https://qflo.net/api/notifications/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resendJobId: job.id }),
      });
      // Optimistically flip to pending; the next poll picks up the
      // real status.
      setJob({ ...job, status: 'pending' });
    } catch { /* user can click again */ }
    finally { setResending(false); }
  };

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px', borderRadius: 999,
      fontSize: 10, fontWeight: 700,
      background: palette.bg, color: palette.fg,
      border: `1px solid ${palette.fg}33`,
      maxWidth: '100%',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {palette.text}
      </span>
      {display === 'failed' && (
        <button
          onClick={(e) => { e.stopPropagation(); onResend(); }}
          disabled={resending}
          style={{
            padding: '1px 8px', borderRadius: 999, fontSize: 10,
            background: '#ef4444', color: '#fff',
            border: 'none', cursor: 'pointer', flexShrink: 0,
            opacity: resending ? 0.6 : 1,
          }}
        >
          {resending ? tl('Resending…') : tl('Resend')}
        </button>
      )}
    </div>
  );
}

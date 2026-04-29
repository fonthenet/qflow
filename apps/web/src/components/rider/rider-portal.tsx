'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { MapboxLiveMap, MAPBOX_TOKEN_CONFIGURED } from '@/components/maps/mapbox-live-map';

// Map: static <img>, not iframe. iOS WhatsApp's in-app browser blocks
// third-party iframes via Tracking Prevention — both OSM and Google
// Embed showed as a blank white box even after the env-var was
// configured. Static <img> requests aren't subject to that
// restriction; they always load. Provider chain: Google Maps Static
// API (when key is configured + Static API enabled) → OSM static
// service via <img onError> fallback.

const MAP_W = 640;
const MAP_H = 360;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Public moped emoji image — see order-map.tsx for the rationale. */
const MOPED_ICON_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/1f6f5.png';

function gmapsStaticUrl(
  key: string,
  rider: { lat: number; lng: number } | null,
  dest: { lat: number; lng: number },
): string {
  const params = new URLSearchParams();
  params.set('size', `${MAP_W}x${MAP_H}`);
  params.set('scale', '2');
  params.set('maptype', 'roadmap');
  params.set('key', key);
  // Destination — red H pin.
  params.append('markers', `color:red|label:H|${dest.lat},${dest.lng}`);
  if (rider) {
    // Rider — moped icon, centered on the actual lat/lng.
    params.append('markers', `icon:${MOPED_ICON_URL}|anchor:center|scale:2|${rider.lat},${rider.lng}`);
    params.append('path', `color:0x3b82f6cc|weight:4|${rider.lat},${rider.lng}|${dest.lat},${dest.lng}`);
  } else {
    params.set('center', `${dest.lat},${dest.lng}`);
    params.set('zoom', '15');
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}


/**
 * Rider portal client. Loaded on the driver's phone after they tap
 * the link sent by the operator. Single-purpose page: request
 * geolocation once, stream every ~12s while the page is in foreground,
 * and expose two big tappable buttons:
 *
 *   I've ARRIVED   — stamps tickets.arrived_at + sends customer "🛵 here"
 *   DELIVERED      — stamps delivered_at, status=served, customer "✅ enjoy!"
 *
 * Geolocation strategy
 *   - watchPosition (continuous OS-driven updates) is more battery-friendly
 *     than setInterval+getCurrentPosition; we just throttle the POSTs to
 *     once every 12s so the server doesn't get a row per second.
 *   - We stop streaming when the page is hidden (visibilitychange) and
 *     resume when it returns to the foreground; saves battery during
 *     stoplights / phone in pocket.
 *   - When the ticket flips to delivered (via realtime, server-side
 *     stop, or local Delivered click), watchPosition is cleared
 *     permanently for this load.
 */

const HEARTBEAT_MIN_MS = 12_000;

export interface RiderPortalProps {
  ticketId: string;
  token: string;
  ticketNumber: string;
  orgName: string;
  officeName: string;
  customerName: string;
  customerPhone: string;
  address: string | null;
  addressCity: string | null;
  addressInstructions: string | null;
  destLat: number | null;
  destLng: number | null;
  initialArrivedAt: string | null;
  initialDeliveredAt: string | null;
  initialStatus: string;
  /** Public Supabase creds for the live ticket-state subscription.
   *  Anon key is safe — RLS on tickets allows public SELECT and the
   *  rider portal already exposes the ticket via the HMAC token URL. */
  supabaseUrl: string;
  supabaseAnonKey: string;
}

type GeoStatus = 'idle' | 'requesting' | 'streaming' | 'denied' | 'unavailable' | 'stopped';

export function RiderPortal(props: RiderPortalProps) {
  const {
    ticketId, token, ticketNumber, orgName, officeName,
    customerName, customerPhone, address, addressCity, addressInstructions,
    destLat, destLng,
    initialArrivedAt, initialDeliveredAt,
    supabaseUrl, supabaseAnonKey,
  } = props;

  const [arrivedAt, setArrivedAt] = useState<string | null>(initialArrivedAt);
  const [deliveredAt, setDeliveredAt] = useState<string | null>(initialDeliveredAt);
  // Customer notification status — set from /api/rider/delivered's
  // response. true = WA delivered receipt sent successfully, false =
  // send failed (driver should call customer instead), null = not
  // yet attempted (pre-delivery).
  const [customerNotified, setCustomerNotified] = useState<boolean | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<'arrived' | 'delivered' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentMsRef = useRef<number>(0);

  // Driver's current GPS position + accuracy radius (meters). Null
  // until the first onPos fires. Accuracy renders as "± Xm" so the
  // driver knows when signal is weak (e.g. inside a building) and
  // the map pin may not match their real spot.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);

  const isDelivered = Boolean(deliveredAt);
  const hasArrived = Boolean(arrivedAt);

  // Universal Maps deeplink — Android opens GMaps, iOS opens Apple Maps,
  // desktop opens GMaps web. `dir_action=navigate` flips Google Maps to
  // turn-by-turn directions mode rather than just a pin lookup.
  const mapsHref = (destLat != null && destLng != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destLat},${destLng}`)}&dir_action=navigate`
    : null;

  // ── Geolocation streaming ─────────────────────────────────────────
  useEffect(() => {
    if (isDelivered) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoStatus('unavailable');
      return;
    }

    const post = async (coords: GeolocationCoordinates) => {
      const now = Date.now();
      if (now - lastSentMsRef.current < HEARTBEAT_MIN_MS) return;
      lastSentMsRef.current = now;
      try {
        const res = await fetch('/api/rider/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId,
            token,
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy ?? null,
            heading: typeof coords.heading === 'number' ? coords.heading : null,
            speed: typeof coords.speed === 'number' ? coords.speed : null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.stopped) {
          // Server says we're done — stop the watcher locally too.
          stopWatch();
          setGeoStatus('stopped');
          return;
        }
        setLastBeatAt(now);
      } catch (e: any) {
        console.warn('[rider-portal] heartbeat failed', e?.message);
      }
    };

    const onPos = (p: GeolocationPosition) => {
      setGeoStatus('streaming');
      setError(null);
      // Update local map state on every fix. The new lat/lng goes
      // straight into the static-map URL on the next render.
      if (Number.isFinite(p.coords.latitude) && Number.isFinite(p.coords.longitude)) {
        setRiderPos({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: typeof p.coords.accuracy === 'number' ? p.coords.accuracy : null,
        });
      }
      void post(p.coords);
    };
    const onErr = (e: GeolocationPositionError) => {
      if (e.code === e.PERMISSION_DENIED) setGeoStatus('denied');
      else setGeoStatus('unavailable');
      setError(e.message);
    };

    const startWatch = () => {
      if (watchIdRef.current != null) return;
      setGeoStatus('requesting');
      watchIdRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        // The OS coalesces updates; we additionally throttle in `post`.
        maximumAge: 5_000,
        timeout: 30_000,
      });
    };
    const stopWatch = () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };

    startWatch();

    // Pause when the tab is hidden, resume when it returns. Saves the
    // rider's battery during stop lights / phone in pocket.
    const onVisibility = () => {
      if (document.hidden) stopWatch();
      else if (!isDelivered) startWatch();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopWatch();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ticketId, token, isDelivered]);

  // ── Live ticket-state subscription ────────────────────────────────
  // Two-pronged "never miss an update" pattern (same as UberEats):
  //   1. Supabase Realtime postgres_changes on tickets — fast path
  //      (<1s). The operator's Station mutates the ticket; the
  //      change broadcasts to every subscriber including this rider.
  //   2. 5-second polling fallback in case the websocket disconnects
  //      silently on a flaky carrier network. Whichever path delivers
  //      the new state first wins.
  //
  // Stops once delivered_at is set (terminal state — no more changes
  // to listen for, and the heartbeat endpoint refuses writes too).
  useEffect(() => {
    if (isDelivered) return;
    if (!supabaseUrl || !supabaseAnonKey) return;
    const sb = createBrowserClient(supabaseUrl, supabaseAnonKey);
    let unsubFn: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyRow = (next: any) => {
      if (!next) return;
      if (typeof next.arrived_at !== 'undefined') {
        setArrivedAt(next.arrived_at ?? null);
      }
      if (typeof next.delivered_at !== 'undefined') {
        setDeliveredAt(next.delivered_at ?? null);
      }
    };

    try {
      const channel = sb
        .channel(`rider-track-${ticketId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tickets', filter: `id=eq.${ticketId}` },
          (payload) => applyRow(payload.new),
        )
        .subscribe();
      unsubFn = () => { try { sb.removeChannel(channel); } catch {} };
    } catch (e) {
      console.warn('[rider-portal] realtime subscribe failed', e);
    }

    // Polling fallback — 5 s cadence so the rider's status reflects
    // operator actions reasonably fast even when the websocket is
    // dropped (mobile carriers like to kill long-lived connections).
    const poll = async () => {
      try {
        const { data } = await sb
          .from('tickets')
          .select('status, arrived_at, delivered_at, cancelled_at')
          .eq('id', ticketId)
          .maybeSingle();
        applyRow(data);
      } catch { /* network blip — try again next tick */ }
    };
    pollTimer = setInterval(poll, 5_000);

    return () => {
      unsubFn?.();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [ticketId, supabaseUrl, supabaseAnonKey, isDelivered]);

  // Distance for the header chip — recomputes on every GPS fix.
  const distanceKm = (riderPos && destLat != null && destLng != null)
    ? haversineKm(riderPos, { lat: destLat, lng: destLng })
    : null;

  // Static map URL — Google Static when key configured. Returns null
  // otherwise (we rendered a placeholder rather than a broken OSM
  // fallback that timed out in production testing).
  const gmapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '';
  const dest = (destLat != null && destLng != null) ? { lat: destLat, lng: destLng } : null;
  const mapUrl: string | null = (dest && gmapsKey)
    ? gmapsStaticUrl(gmapsKey, riderPos, dest)
    : null;

  const callApi = async (path: 'arrived' | 'delivered'): Promise<any> => {
    setBusy(path);
    setError(null);
    try {
      const res = await fetch(`/api/rider/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId, token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `HTTP ${res.status}`);
        return null;
      }
      return data;
    } catch (e: any) {
      setError(e?.message ?? 'Network error');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const handleArrived = async () => {
    const data = await callApi('arrived');
    if (data?.arrived_at || data?.noop) setArrivedAt(data.arrived_at ?? new Date().toISOString());
  };
  const handleDelivered = async () => {
    const data = await callApi('delivered');
    if (data?.delivered_at || data?.noop) setDeliveredAt(data.delivered_at ?? new Date().toISOString());
    if (typeof data?.notified === 'boolean') setCustomerNotified(data.notified);
  };

  // ── UI ────────────────────────────────────────────────────────────
  return (
    <main style={pageWrap}>
      {/* Compact hero — ticket number on the same row as a tracking
          status dot so the driver sees both at a glance. */}
      {/* Header — quiet by default. Restaurant name + ticket as a pill,
          GPS status as a tiny dot+pill on the right. No big numbers,
          no emoji. Looks like Linear / UberEats — refined, not loud. */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '4px 2px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 13, fontWeight: 600, color: '#0f172a',
            letterSpacing: -0.2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {orgName || officeName}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 600, color: '#64748b',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}>
            {ticketNumber}
          </span>
        </div>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '3px 8px', borderRadius: 999,
          background: geoStatus === 'streaming' ? '#dcfce7'
            : geoStatus === 'denied' || geoStatus === 'unavailable' ? '#fee2e2'
            : '#f1f5f9',
          color: geoStatus === 'streaming' ? '#15803d'
            : geoStatus === 'denied' || geoStatus === 'unavailable' ? '#b91c1c'
            : '#64748b',
          fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: geoStatus === 'streaming' ? '#22c55e'
              : geoStatus === 'requesting' ? '#f59e0b'
              : geoStatus === 'denied' || geoStatus === 'unavailable' ? '#ef4444'
              : '#94a3b8',
            boxShadow: geoStatus === 'streaming' ? '0 0 0 3px rgba(34,197,94,0.18)' : 'none',
          }} />
          {geoStatus === 'streaming' && (lastBeatAt ? `LIVE · ${Math.max(1, Math.round((Date.now() - lastBeatAt) / 1000))}s` : 'LIVE')}
          {geoStatus === 'requesting' && 'LOCATING'}
          {geoStatus === 'denied' && 'GPS BLOCKED'}
          {geoStatus === 'unavailable' && 'NO GPS'}
          {geoStatus === 'stopped' && 'OFF'}
          {geoStatus === 'idle' && 'STARTING'}
        </span>
      </header>

      {/* Customer card — refined: large name, smaller phone underneath
          as a tap-to-call link, dotted divider, then a quieter address
          row with the navigate link as a subtle outlined pill. No big
          shouting green button — Call moves to a circular icon button
          for visual restraint. */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontWeight: 700, fontSize: 17, letterSpacing: -0.3,
              color: '#0f172a', lineHeight: 1.2,
            }} dir="auto">
              {customerName || '—'}
            </div>
            {customerPhone && (
              <a
                href={`tel:${customerPhone}`}
                style={{
                  fontSize: 13, color: '#475569', textDecoration: 'none',
                  direction: 'ltr', display: 'inline-block', marginTop: 2,
                }}
              >
                {customerPhone}
              </a>
            )}
          </div>
          {customerPhone && (
            <a
              href={`tel:${customerPhone}`}
              aria-label="Call customer"
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: '#16a34a', color: '#fff',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                textDecoration: 'none', flexShrink: 0,
                boxShadow: '0 4px 12px rgba(22,163,74,0.30)',
                fontSize: 18,
              }}
            >
              {/* Inline phone glyph — no emoji to keep tone refined */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
              </svg>
            </a>
          )}
        </div>
        {address && (
          <>
            <div style={{ height: 1, background: '#e2e8f0', margin: '12px 0' }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 }}>
                  Drop-off
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a', lineHeight: 1.35 }} dir="auto">
                  {address}
                </div>
                {(addressCity || addressInstructions) && (
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    {addressCity ?? ''}{addressCity && addressInstructions ? ' · ' : ''}{addressInstructions ?? ''}
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
                    letterSpacing: 0.1, whiteSpace: 'nowrap', flexShrink: 0,
                    boxShadow: '0 2px 6px rgba(15,23,42,0.18)',
                  }}
                >
                  Navigate →
                </a>
              )}
            </div>
          </>
        )}
      </section>

      {/* Static map image (NOT iframe — iOS WhatsApp blocks third-
          party iframes). Refreshes whenever riderPos changes; the
          new URL forces the browser to fetch a new image. Tap the
          image to open the route in Google/Apple Maps. Hidden when
          the operator never captured lat/lng. */}
      {mapUrl && (
        <section style={{
          borderRadius: 14, overflow: 'hidden',
          background: '#fff',
          boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
        }}>
          {/* Map header — clean, two metrics with proper hierarchy.
              Distance to drop-off is the primary number (large, dark);
              accuracy is a quiet subtitle when relevant. */}
          <div style={{
            padding: '12px 14px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, borderBottom: '1px solid #f1f5f9',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 600, color: '#94a3b8',
                letterSpacing: 0.4, textTransform: 'uppercase',
              }}>
                Distance to drop-off
              </div>
              <div style={{
                fontSize: 22, fontWeight: 700, color: '#0f172a',
                letterSpacing: -0.5, marginTop: 2, lineHeight: 1,
              }}>
                {distanceKm == null
                  ? '—'
                  : distanceKm < 0.1
                    ? <>&lt; 100<span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginInlineStart: 3 }}>m</span></>
                    : <>{distanceKm.toFixed(distanceKm < 10 ? 1 : 0)}<span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginInlineStart: 3 }}>km</span></>}
              </div>
            </div>
            {riderPos?.accuracy != null && (
              <div style={{ textAlign: 'end' }}>
                <div style={{
                  fontSize: 10, fontWeight: 600, color: '#94a3b8',
                  letterSpacing: 0.4, textTransform: 'uppercase',
                }}>
                  GPS accuracy
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 600, marginTop: 2, lineHeight: 1,
                  color: riderPos.accuracy > 50 ? '#b45309' : '#15803d',
                }}>
                  ±{Math.round(riderPos.accuracy)}m
                </div>
              </div>
            )}
          </div>
          {MAPBOX_TOKEN_CONFIGURED && dest ? (
            // Live interactive map (UberEats / DoorDash-style). The
            // 🛵 marker animates smoothly between GPS fixes — no
            // tile re-fetch, no flicker.
            <MapboxLiveMap
              destLat={dest.lat}
              destLng={dest.lng}
              riderLat={riderPos?.lat ?? null}
              riderLng={riderPos?.lng ?? null}
              height={300}
              fitBoth={false /* don't fight the driver's pinch-zoom */}
            />
          ) : (
            <a
              href={mapsHref ?? undefined}
              target="_blank"
              rel="noreferrer"
              style={{ display: 'block' }}
            >
              <img
                src={mapUrl}
                alt="map"
                width={MAP_W}
                height={MAP_H}
                style={{
                  width: '100%', height: 'auto', display: 'block',
                  aspectRatio: `${MAP_W} / ${MAP_H}`,
                  objectFit: 'cover',
                  background: '#e2e8f0',
                }}
              />
            </a>
          )}
        </section>
      )}

      {/* Action bar — refined buttons. Two-state primary action:
          "I'm at the door" (amber) → "Mark delivered" (deep green).
          Once arrived, the button morphs rather than stacking two
          buttons. Cleaner UX, no decision fatigue. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {!isDelivered && !hasArrived && (
          <button
            type="button"
            onClick={handleArrived}
            disabled={busy === 'arrived'}
            style={{
              ...bigBtn,
              background: '#0f172a', color: '#fff',
              boxShadow: '0 6px 16px rgba(15,23,42,0.20)',
              opacity: busy === 'arrived' ? 0.6 : 1,
              fontSize: 15, padding: '14px 16px',
              letterSpacing: 0.1,
            }}
          >
            {busy === 'arrived' ? 'Sending…' : "I've arrived at the address"}
          </button>
        )}
        {!isDelivered && hasArrived && (
          <div style={{
            padding: '10px 14px', borderRadius: 12,
            background: '#fef3c7', border: '1px solid #fde68a',
            color: '#92400e', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            Customer notified — waiting for handoff.
          </div>
        )}
        <button
          type="button"
          onClick={handleDelivered}
          disabled={busy === 'delivered' || isDelivered}
          style={{
            ...bigBtn,
            background: isDelivered ? '#dcfce7' : '#16a34a',
            color: isDelivered ? '#15803d' : '#fff',
            border: isDelivered ? '1px solid #86efac' : 'none',
            boxShadow: isDelivered ? 'none' : '0 6px 16px rgba(22,163,74,0.30)',
            opacity: busy === 'delivered' ? 0.6 : 1,
            fontSize: 15, padding: '14px 16px',
            letterSpacing: 0.1,
          }}
        >
          {isDelivered ? 'Delivered' : (busy === 'delivered' ? 'Sending…' : 'Mark as delivered')}
        </button>
      </section>

      {error && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
          ⚠ {error}
        </div>
      )}

      {/* Delivered confirmation — refined card with a subtle outline,
          inline check glyph, clear hierarchy (status → secondary line
          → small attribution). No saturated green emoji block. */}
      {isDelivered && (
        <div style={{
          marginTop: 14, padding: '16px 18px', borderRadius: 14,
          background: '#fff',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{
            width: 32, height: 32, borderRadius: '50%',
            background: '#dcfce7', color: '#15803d',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', letterSpacing: -0.2, lineHeight: 1.2 }}>
              Order delivered
            </div>
            {customerNotified === true && (
              <div style={{ color: '#475569', fontSize: 13, marginTop: 4 }}>
                Customer notified via WhatsApp.
              </div>
            )}
            {customerNotified === false && (
              <div style={{ color: '#b45309', fontSize: 13, marginTop: 4, fontWeight: 500 }}>
                Couldn't reach customer on WhatsApp — please confirm receipt by phone.
              </div>
            )}
            {customerNotified === null && (
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
                You can close this page.
              </div>
            )}
          </div>
        </div>
      )}

      <p style={{ marginTop: 18, fontSize: 11, color: '#94a3b8', textAlign: 'center', letterSpacing: 0.1 }}>
        Live location stops automatically once the order is delivered.
      </p>
    </main>
  );
}

const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '14px 14px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 10,
};
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 14, padding: '14px 16px',
  boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
};
const bigBtn: React.CSSProperties = {
  padding: '14px 16px', borderRadius: 12, border: 'none',
  fontWeight: 700, fontSize: 15, cursor: 'pointer',
  letterSpacing: 0.1,
  fontFamily: 'inherit',
};
// Kept for backwards-compatibility with any deeper component code.
const greenBtn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 999,
  background: '#16a34a', color: '#fff',
  fontWeight: 600, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 999,
  background: '#0f172a', color: '#fff',
  fontWeight: 600, fontSize: 12, textDecoration: 'none',
};
// Silence unused warnings for the kept-for-compat exports above.
void greenBtn; void primaryBtn;

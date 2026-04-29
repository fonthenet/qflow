'use client';

import { useEffect, useRef, useState } from 'react';

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
  if (rider) {
    params.append('markers', `color:blue|label:D|${rider.lat},${rider.lng}`);
    params.append('markers', `color:red|label:H|${dest.lat},${dest.lng}`);
    params.append('path', `color:0x3b82f6cc|weight:4|${rider.lat},${rider.lng}|${dest.lat},${dest.lng}`);
  } else {
    params.append('markers', `color:red|label:H|${dest.lat},${dest.lng}`);
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
}

type GeoStatus = 'idle' | 'requesting' | 'streaming' | 'denied' | 'unavailable' | 'stopped';

export function RiderPortal(props: RiderPortalProps) {
  const {
    ticketId, token, ticketNumber, orgName, officeName,
    customerName, customerPhone, address, addressCity, addressInstructions,
    destLat, destLng,
    initialArrivedAt, initialDeliveredAt,
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

  // Driver's current GPS position. Null until the first onPos fires.
  // We use this for the map image and the distance chip.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);

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
        setRiderPos({ lat: p.coords.latitude, lng: p.coords.longitude });
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
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{ticketNumber}</div>
        <span style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: geoStatus === 'streaming' ? '#22c55e'
            : geoStatus === 'requesting' ? '#f59e0b'
            : geoStatus === 'denied' || geoStatus === 'unavailable' ? '#ef4444'
            : '#94a3b8',
        }} />
        <span style={{ flex: 1, fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {geoStatus === 'streaming' && (lastBeatAt ? `Live · ${Math.max(1, Math.round((Date.now() - lastBeatAt) / 1000))}s ago` : 'Live')}
          {geoStatus === 'requesting' && 'Requesting location…'}
          {geoStatus === 'denied' && 'Location denied'}
          {geoStatus === 'unavailable' && 'GPS unavailable'}
          {geoStatus === 'stopped' && 'Tracking off'}
          {geoStatus === 'idle' && 'Starting…'}
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {orgName || officeName}
        </span>
      </header>

      {/* Customer + address combined in one card. Single tap-to-call,
          single tap-to-navigate, no extra UPPERCASE labels. */}
      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }} dir="auto">{customerName || '—'}</div>
            {customerPhone && (
              <div style={{ fontSize: 12, color: '#64748b', direction: 'ltr' }}>{customerPhone}</div>
            )}
          </div>
          {customerPhone && (
            <a href={`tel:${customerPhone}`} style={greenBtn}>📞 Call</a>
          )}
        </div>
        {address && (
          <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: '#f1f5f9', fontSize: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }} dir="auto">{address}</div>
            {(addressCity || addressInstructions) && (
              <div style={{ color: '#64748b', marginTop: 2 }}>
                {addressCity ?? ''}{addressCity && addressInstructions ? ' · ' : ''}{addressInstructions ?? ''}
              </div>
            )}
            {mapsHref && (
              <a href={mapsHref} target="_blank" rel="noreferrer" style={{ ...primaryBtn, display: 'inline-block', marginTop: 6, padding: '6px 10px', fontSize: 12 }}>
                🗺️ Navigate
              </a>
            )}
          </div>
        )}
      </section>

      {/* Static map image (NOT iframe — iOS WhatsApp blocks third-
          party iframes). Refreshes whenever riderPos changes; the
          new URL forces the browser to fetch a new image. Tap the
          image to open the route in Google/Apple Maps. Hidden when
          the operator never captured lat/lng. */}
      {mapUrl && (
        <section style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff' }}>
          <div style={{
            padding: '6px 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            background: '#f8fafc', fontSize: 12,
          }}>
            <span style={{ color: '#64748b', fontWeight: 700 }}>
              🗺️ {riderPos ? 'Your route' : 'Destination'}
            </span>
            <span style={{ fontWeight: 800, color: '#3b82f6' }}>
              {distanceKm == null
                ? 'Locating…'
                : `${distanceKm < 0.1 ? '<0.1' : distanceKm.toFixed(1)} km to drop-off`}
            </span>
          </div>
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
        </section>
      )}

      {/* Action buttons — disabled state mirrors the lifecycle. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {!isDelivered && (
          <button
            type="button"
            onClick={handleArrived}
            disabled={busy === 'arrived' || hasArrived}
            style={{
              ...bigBtn,
              background: hasArrived ? '#22c55e22' : '#f59e0b',
              color: hasArrived ? '#22c55e' : '#fff',
              border: hasArrived ? '1px solid #22c55e' : 'none',
              opacity: busy === 'arrived' ? 0.6 : 1,
            }}
          >
            {hasArrived ? '✓ Arrived' : (busy === 'arrived' ? 'Sending…' : '🛵 I\'ve Arrived')}
          </button>
        )}
        <button
          type="button"
          onClick={handleDelivered}
          disabled={busy === 'delivered' || isDelivered}
          style={{
            ...bigBtn,
            background: isDelivered ? '#22c55e' : '#16a34a',
            color: '#fff',
            opacity: busy === 'delivered' ? 0.6 : 1,
          }}
        >
          {isDelivered ? '✅ Delivered' : (busy === 'delivered' ? 'Sending…' : '✅ Mark Delivered')}
        </button>
      </section>

      {error && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
          ⚠ {error}
        </div>
      )}

      {isDelivered && (
        <div style={{
          marginTop: 16, padding: '14px 16px', borderRadius: 10,
          background: 'rgba(34,197,94,0.10)',
          border: '1px solid rgba(34,197,94,0.4)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, lineHeight: 1, marginBottom: 6 }}>✅</div>
          <div style={{ color: '#16a34a', fontWeight: 800, fontSize: 15 }}>
            Order delivered
          </div>
          {/* Notification status — green tick when the WA receipt was
              accepted by Meta, amber warning when it failed (rider
              should call the customer to confirm receipt). Hidden
              when status is unknown (e.g. delivered in a previous
              session, before this code shipped). */}
          {customerNotified === true && (
            <div style={{ color: '#475569', fontSize: 12, marginTop: 6 }}>
              ✓ Customer notified via WhatsApp.
            </div>
          )}
          {customerNotified === false && (
            <div style={{ color: '#b45309', fontSize: 12, marginTop: 6, fontWeight: 600 }}>
              ⚠ Customer not reached on WhatsApp — please confirm receipt by phone.
            </div>
          )}
          {customerNotified === null && (
            <div style={{ color: '#475569', fontSize: 12, marginTop: 6 }}>
              You can close this page.
            </div>
          )}
        </div>
      )}

      <p style={{ marginTop: 16, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        Live location stops automatically when the order is delivered.
      </p>
    </main>
  );
}

const pageWrap: React.CSSProperties = {
  maxWidth: 480, margin: '0 auto', padding: '12px 12px 16px',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  color: '#0f172a', background: '#f8fafc', minHeight: '100vh',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const card: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 10,
  border: '1px solid #e2e8f0',
};
const greenBtn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 8,
  background: '#22c55e', color: '#fff',
  fontWeight: 700, fontSize: 14, textDecoration: 'none', whiteSpace: 'nowrap',
};
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8,
  background: '#3b82f6', color: '#fff',
  fontWeight: 700, fontSize: 13, textDecoration: 'none',
};
const bigBtn: React.CSSProperties = {
  padding: '12px 16px', borderRadius: 10, border: 'none',
  fontWeight: 800, fontSize: 14, cursor: 'pointer',
  letterSpacing: 0.3,
};

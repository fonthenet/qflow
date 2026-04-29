'use client';

import { useEffect, useRef, useState } from 'react';

// Leaflet via CDN — same pattern as order-map.tsx. Loads once and
// shares the global window.L instance across the page.
const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS  = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

declare global {
  interface Window {
    L?: any;
  }
}

let leafletLoadPromise: Promise<void> | null = null;
function ensureLeaflet(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Leaflet')));
      return;
    }
    const s = document.createElement('script');
    s.src = LEAFLET_JS;
    s.async = true;
    s.crossOrigin = '';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(s);
  });
  return leafletLoadPromise;
}

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
  const [geoStatus, setGeoStatus] = useState<GeoStatus>('idle');
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<'arrived' | 'delivered' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastSentMsRef = useRef<number>(0);

  // Driver's current GPS position (separate from the heartbeat queue —
  // we update this on every onPos so the map animates smoothly even
  // between server posts). Null until the first GPS read lands.
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);

  // Map refs — same pattern as order-map.tsx. Map renders only when
  // we have both a destination and Leaflet has loaded.
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const riderMarkerRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const [mapReady, setMapReady] = useState(false);

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
      // Update local map state on every fix so the rider's pin moves
      // smoothly even though we only POST to the server every 12s.
      // The server-side position is throttled separately inside `post`.
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

  // ── Map: initialize once we have a destination. Skip entirely if
  //    the operator never captured lat/lng — the driver still has the
  //    Navigate button (which opens GMaps externally) so they're not
  //    stuck.
  useEffect(() => {
    if (destLat == null || destLng == null) return;
    let cancelled = false;
    ensureLeaflet().then(() => {
      if (cancelled || !window.L || !mapContainerRef.current) return;
      const L = window.L;
      const map = L.map(mapContainerRef.current, {
        center: [destLat, destLng],
        zoom: 14,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      const destIcon = L.divIcon({
        className: 'qflo-rider-dest-icon',
        html: '<div style="font-size:32px;line-height:1;transform:translate(-50%,-100%)">📍</div>',
        iconSize: [32, 32],
      });
      destMarkerRef.current = L.marker([destLat, destLng], { icon: destIcon }).addTo(map);
      mapRef.current = map;
      setMapReady(true);

      // Same invalidateSize defense as the customer map — Leaflet often
      // mounts in a 0-height frame and locks in a broken viewport.
      requestAnimationFrame(() => { try { map.invalidateSize(); } catch {} });
      const onResize = () => { try { map.invalidateSize(); } catch {} };
      window.addEventListener('resize', onResize);
      let ro: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        ro = new ResizeObserver(() => { try { map.invalidateSize(); } catch {} });
        ro.observe(mapContainerRef.current);
      }
      (map as any)._qfloCleanup = () => {
        window.removeEventListener('resize', onResize);
        ro?.disconnect();
      };
    }).catch((e) => {
      console.warn('[rider-portal] Leaflet load failed', e);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { (mapRef.current as any)._qfloCleanup?.(); } catch {}
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
  }, [destLat, destLng]);

  // Animate the rider pin + draw a thin connecting line every time a
  // new GPS fix arrives. fitBounds on first appearance only — after
  // that we leave the viewport alone so the driver can pinch-zoom to
  // see street detail without us yanking them back.
  const fitOnceRef = useRef(false);
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    if (!riderPos || destLat == null || destLng == null) return;
    const L = window.L;

    if (!riderMarkerRef.current) {
      const riderIcon = L.divIcon({
        className: 'qflo-rider-self-icon',
        html: '<div style="font-size:30px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">🛵</div>',
        iconSize: [30, 30],
      });
      riderMarkerRef.current = L.marker([riderPos.lat, riderPos.lng], { icon: riderIcon }).addTo(mapRef.current);
    } else {
      riderMarkerRef.current.setLatLng([riderPos.lat, riderPos.lng]);
    }

    // Straight dashed line rider → destination. Visual aid only; the
    // real route comes from the external Maps app launched via
    // Navigate.
    const latlngs = [[riderPos.lat, riderPos.lng], [destLat, destLng]] as any;
    if (!lineRef.current) {
      lineRef.current = L.polyline(latlngs, {
        color: '#3b82f6', weight: 3, opacity: 0.7, dashArray: '6 6',
      }).addTo(mapRef.current);
    } else {
      lineRef.current.setLatLngs(latlngs);
    }

    if (!fitOnceRef.current) {
      const bounds = L.latLngBounds([
        [riderPos.lat, riderPos.lng],
        [destLat, destLng],
      ]);
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      fitOnceRef.current = true;
    }
  }, [riderPos, mapReady, destLat, destLng]);

  // Distance for the header chip — recomputes on every GPS fix.
  const distanceKm = (riderPos && destLat != null && destLng != null)
    ? haversineKm(riderPos, { lat: destLat, lng: destLng })
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

      {/* Embedded map — destination pin (📍) + driver's own pin (🛵)
          + dashed line between them. Helps the driver eyeball whether
          they're heading the right way without leaving the page. The
          turn-by-turn route still comes from the external Maps app
          launched via the Navigate button above. Hidden when the
          operator never captured lat/lng (just text address). */}
      {destLat != null && destLng != null && (
        <section style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff' }}>
          <div style={{
            padding: '6px 10px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            background: '#f8fafc', fontSize: 12,
          }}>
            <span style={{ color: '#64748b', fontWeight: 700 }}>🗺️ Route preview</span>
            <span style={{ fontWeight: 800, color: '#3b82f6' }}>
              {distanceKm == null
                ? 'Locating…'
                : `${distanceKm < 0.1 ? '<0.1' : distanceKm.toFixed(1)} km away`}
            </span>
          </div>
          <div ref={mapContainerRef} style={{ width: '100%', height: 220 }} />
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
        <div style={{ marginTop: 18, textAlign: 'center', color: '#22c55e', fontWeight: 700 }}>
          Order completed. Safe travels! 🚗
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
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

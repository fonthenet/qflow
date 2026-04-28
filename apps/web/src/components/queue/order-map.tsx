'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Live delivery map for the customer tracking page.
 *
 * Two pins:
 *   📍 Customer destination (static, taken from delivery_address.lat/lng)
 *   🛵 Rider live position (updates every ~12 s as the rider's portal
 *      streams heartbeats; we subscribe via Supabase Realtime on
 *      rider_locations)
 *
 * No bundled map dep — Leaflet + OSM raster tiles loaded from CDN once
 * per session. Keeps the customer page bundle thin (~5KB of glue) and
 * avoids needing a Mapbox / Google Maps API key. Trade-off: tiles are a
 * touch slower than vector. Acceptable for a tracking UI that's only
 * open for the few minutes between Dispatch and Delivered.
 *
 * Straight-line ETA: distance(customer, rider) ÷ rider.speed (or 30 km/h
 * fallback). ±20% accuracy, no Directions API call. Good enough for
 * "your driver is ~7 min away".
 */

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
const LEAFLET_JS  = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;

// Leaflet attaches itself to window.L when the script loads.
declare global {
  interface Window {
    L?: any;
  }
}

export interface OrderMapProps {
  ticketId: string;
  destLat: number;
  destLng: number;
  /** Public anon key + URL for the realtime subscription. */
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** Locale tag for the "X min away" copy. */
  locale: 'ar' | 'fr' | 'en';
}

interface RiderPin {
  lat: number;
  lng: number;
  speedMps: number | null;
  recordedAt: string;
}

function tr(locale: 'ar' | 'fr' | 'en', en: string, fr: string, ar: string) {
  return locale === 'ar' ? ar : locale === 'fr' ? fr : en;
}

/** Haversine distance in metres. */
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let leafletLoadPromise: Promise<void> | null = null;
function ensureLeaflet(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    // CSS — only inject once.
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

export default function OrderMap({ ticketId, destLat, destLng, supabaseUrl, supabaseAnonKey, locale }: OrderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const riderMarkerRef = useRef<any>(null);

  const [rider, setRider] = useState<RiderPin | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const dest = useMemo(() => ({ lat: destLat, lng: destLng }), [destLat, destLng]);

  // ── Load Leaflet + initialize the map (one shot per mount) ────────
  useEffect(() => {
    let cancelled = false;
    ensureLeaflet().then(() => {
      if (cancelled || !window.L || !containerRef.current) return;
      const L = window.L;
      const map = L.map(containerRef.current, {
        center: [dest.lat, dest.lng],
        zoom: 14,
        zoomControl: true,
        attributionControl: true,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      // Customer destination — static, large emoji marker.
      const destIcon = L.divIcon({
        className: 'qflo-dest-icon',
        html: '<div style="font-size:32px;line-height:1;transform:translate(-50%,-100%)">📍</div>',
        iconSize: [32, 32],
      });
      destMarkerRef.current = L.marker([dest.lat, dest.lng], { icon: destIcon }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    }).catch((e) => {
      console.warn('[OrderMap] Leaflet load failed', e);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
    };
    // dest is memoized; only re-init when ticket destination genuinely changes.
  }, [dest]);

  // ── Initial fetch + Realtime: rider_locations for this ticket ────
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const sb = createBrowserClient(supabaseUrl, supabaseAnonKey);

    // Initial — show the latest known pin so the customer doesn't see
    // an empty "rider location unknown" state on the first render.
    sb.from('rider_locations')
      .select('lat, lng, speed_mps, recorded_at')
      .eq('ticket_id', ticketId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data) {
          setRider({
            lat: data.lat, lng: data.lng,
            speedMps: typeof data.speed_mps === 'number' ? data.speed_mps : null,
            recordedAt: data.recorded_at,
          });
        }
      });

    const channel = sb
      .channel(`rider-track-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rider_locations', filter: `ticket_id=eq.${ticketId}` },
        (payload) => {
          const r = payload.new as any;
          if (typeof r?.lat === 'number' && typeof r?.lng === 'number') {
            setRider({
              lat: r.lat, lng: r.lng,
              speedMps: typeof r.speed_mps === 'number' ? r.speed_mps : null,
              recordedAt: r.recorded_at,
            });
          }
        },
      )
      .subscribe();
    unsub = () => { try { sb.removeChannel(channel); } catch {} };

    return () => unsub?.();
  }, [ticketId, supabaseUrl, supabaseAnonKey]);

  // ── Update the rider marker + viewport whenever a new pin arrives ─
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.L) return;
    const L = window.L;
    if (!rider) return;

    if (!riderMarkerRef.current) {
      const riderIcon = L.divIcon({
        className: 'qflo-rider-icon',
        html: '<div style="font-size:28px;line-height:1;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.3))">🛵</div>',
        iconSize: [28, 28],
      });
      riderMarkerRef.current = L.marker([rider.lat, rider.lng], { icon: riderIcon }).addTo(mapRef.current);
    } else {
      riderMarkerRef.current.setLatLng([rider.lat, rider.lng]);
    }

    // Auto-frame both markers — a touch of padding so the pins aren't
    // glued to the edge of the viewport.
    const bounds = L.latLngBounds([
      [rider.lat, rider.lng],
      [dest.lat, dest.lng],
    ]);
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [rider, dest, mapReady]);

  // ── Straight-line ETA ─────────────────────────────────────────────
  const eta = useMemo(() => {
    if (!rider) return null;
    const distM = haversineM({ lat: rider.lat, lng: rider.lng }, dest);
    // Use rider's last reported speed if it's plausible (>1 m/s, <30 m/s).
    // Otherwise fall back to ~30 km/h ≈ 8.3 m/s — a generic urban pace
    // that reads sane to most customers.
    const speedMps = rider.speedMps && rider.speedMps > 1 && rider.speedMps < 30
      ? rider.speedMps
      : 8.3;
    const seconds = distM / speedMps;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return { distKm: distM / 1000, minutes };
  }, [rider, dest]);

  return (
    <section style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff' }}>
      <div style={{
        padding: '10px 14px', borderBlockEnd: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: '#f8fafc',
      }}>
        <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700 }}>
          🗺️ {tr(locale, 'Live driver tracking', 'Suivi du livreur en direct', 'تتبع السائق مباشر')}
        </div>
        {eta && (
          <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>
            ~{eta.minutes} min · {eta.distKm.toFixed(1)} km
          </div>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: 280 }} />
      {!rider && (
        <div style={{ padding: 12, fontSize: 12, color: '#64748b', textAlign: 'center', background: '#f8fafc' }}>
          {tr(locale,
            'Waiting for the driver to start sharing their location…',
            'En attente du partage de position du livreur…',
            'بانتظار بدء السائق مشاركة موقعه…',
          )}
        </div>
      )}
    </section>
  );
}

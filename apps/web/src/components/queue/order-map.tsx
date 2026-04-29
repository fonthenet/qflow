'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Live delivery map for the customer tracking page.
 *
 * Implementation: an iframe of OpenStreetMap's embed.html, re-keyed
 * whenever the rider's position changes. Earlier we used Leaflet via
 * CDN, but the script load was racing the layout in production and
 * leaving the customer with a blank white box. The iframe version:
 *   - Loads reliably on every device (no JS dep, no CDN race)
 *   - Single marker per frame; we show the RIDER position when we
 *     have one (the customer's main question is "where's my driver
 *     right now?"), falling back to the destination otherwise
 *   - Re-renders on every heartbeat by passing a different `key`,
 *     which forces a fresh iframe load with the new bbox + marker.
 *     ~12s cadence matches the rider portal's heartbeat throttle.
 *
 * Straight-line ETA calculated from the rider's reported speed (or
 * a 30 km/h fallback) and the Haversine distance to the destination.
 * Good enough for "your driver is ~7 min away".
 */

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

/**
 * Build the OSM embed URL for a single point. The bbox is a small
 * square around the focus point — wider zoom would lose street
 * detail, tighter would clip the marker shadow.
 */
function osmEmbedUrl(focus: { lat: number; lng: number }, span = 0.008): string {
  const minLng = focus.lng - span;
  const maxLng = focus.lng + span;
  const minLat = focus.lat - span;
  const maxLat = focus.lat + span;
  const params = new URLSearchParams({
    bbox: `${minLng},${minLat},${maxLng},${maxLat}`,
    layer: 'mapnik',
    marker: `${focus.lat},${focus.lng}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

export default function OrderMap({ ticketId, destLat, destLng, supabaseUrl, supabaseAnonKey, locale }: OrderMapProps) {
  const [rider, setRider] = useState<RiderPin | null>(null);

  const dest = useMemo(() => ({ lat: destLat, lng: destLng }), [destLat, destLng]);

  // ── Initial fetch + Realtime: rider_locations for this ticket ────
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const sb = createBrowserClient(supabaseUrl, supabaseAnonKey);

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

  // Map focus + iframe key. The key changes every time the rider
  // position changes so React tears down and re-mounts the iframe,
  // forcing a fresh load with the new bbox + marker.
  const mapFocus = rider ?? dest;
  const iframeKey = rider
    ? `${rider.lat.toFixed(5)}_${rider.lng.toFixed(5)}`
    : `dest_${dest.lat.toFixed(5)}_${dest.lng.toFixed(5)}`;
  const mapUrl = osmEmbedUrl(mapFocus);

  // Larger map link so the customer can open the rider's pin in
  // Google / Apple Maps if they want a richer view.
  const fullMapHref = `https://www.openstreetmap.org/?mlat=${mapFocus.lat}&mlon=${mapFocus.lng}#map=15/${mapFocus.lat}/${mapFocus.lng}`;

  // ── Straight-line ETA ─────────────────────────────────────────────
  const eta = useMemo(() => {
    if (!rider) return null;
    const distM = haversineM({ lat: rider.lat, lng: rider.lng }, dest);
    const speedMps = rider.speedMps && rider.speedMps > 1 && rider.speedMps < 30
      ? rider.speedMps
      : 8.3;
    const seconds = distM / speedMps;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return { distKm: distM / 1000, minutes };
  }, [rider, dest]);

  return (
    <section style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid #e2e8f0', background: '#fff' }}>
      <div style={{
        padding: '6px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        background: '#f8fafc', fontSize: 12,
      }}>
        <span style={{ color: '#64748b', fontWeight: 700 }}>
          🛵 {tr(locale, 'Driver location', 'Position du livreur', 'موقع السائق')}
        </span>
        {eta ? (
          <span style={{ fontWeight: 800, color: '#3b82f6' }}>~{eta.minutes} min · {eta.distKm.toFixed(1)} km</span>
        ) : (
          <span style={{ color: '#94a3b8' }}>
            {tr(locale, 'Waiting for driver…', 'En attente du livreur…', 'بانتظار السائق…')}
          </span>
        )}
      </div>
      <iframe
        key={iframeKey}
        src={mapUrl}
        title="map"
        style={{ width: '100%', height: 220, border: 0, display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <a
        href={fullMapHref}
        target="_blank"
        rel="noreferrer"
        style={{
          display: 'block', textAlign: 'center',
          padding: '6px 10px', fontSize: 11,
          color: '#3b82f6', background: '#f8fafc',
          textDecoration: 'none', fontWeight: 600,
          borderTop: '1px solid #e2e8f0',
        }}
      >
        🔍 {tr(locale, 'View larger map', 'Voir la carte', 'عرض الخريطة')}
      </a>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Live delivery map for the customer tracking page.
 *
 * Provider chain (first one with creds wins):
 *   1. Google Maps Embed API — preferred. Looks great, reliable, free
 *      with no usage cap on the Embed product. Requires
 *      NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY in Vercel env. Lock the key
 *      to your domain in Google Cloud console — it's safe to expose
 *      because the Embed API checks Referer.
 *   2. OpenStreetMap iframe — fallback. No key, no setup, but the
 *      tiles are slower and the look is generic.
 *
 * Re-keyed on every heartbeat so the iframe reloads with the new
 * marker position. ~12s cadence matches the rider portal throttle.
 *
 * Straight-line ETA = Haversine distance ÷ rider's reported speed
 * (or 30 km/h fallback). Good enough for "your driver is ~7 min away".
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
 * Build the Google Maps Embed URL. Uses 'directions' mode when we
 * have both a rider and a destination so the customer sees the
 * actual route + drive time. Falls back to 'place' mode for a
 * single point.
 */
function gmapsEmbedUrl(
  key: string,
  rider: { lat: number; lng: number } | null,
  dest: { lat: number; lng: number },
): string {
  if (rider) {
    const params = new URLSearchParams({
      key,
      origin: `${rider.lat},${rider.lng}`,
      destination: `${dest.lat},${dest.lng}`,
      mode: 'driving',
    });
    return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
  }
  const params = new URLSearchParams({
    key,
    q: `${dest.lat},${dest.lng}`,
    zoom: '15',
  });
  return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
}

/**
 * OSM iframe fallback. Single marker at the rider's current position
 * (or destination if no rider yet). Re-rendered with a different `key`
 * each time the focus moves so the iframe reloads.
 */
function osmEmbedUrl(focus: { lat: number; lng: number }): string {
  const span = 0.008;
  const minLng = focus.lng - span;
  const maxLng = focus.lng + span;
  const minLat = focus.lat - span;
  const maxLat = focus.lat + span;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik&marker=${focus.lat},${focus.lng}`;
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

  // Resolve provider — Google if key is set, else OSM.
  const gmapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '';
  const useGmaps = Boolean(gmapsKey);

  const mapUrl = useGmaps
    ? gmapsEmbedUrl(gmapsKey, rider ? { lat: rider.lat, lng: rider.lng } : null, dest)
    : osmEmbedUrl(rider ? { lat: rider.lat, lng: rider.lng } : dest);

  // Re-key the iframe when the focus moves so it reloads with the new
  // markers / route.
  const iframeKey = rider
    ? `r_${rider.lat.toFixed(5)}_${rider.lng.toFixed(5)}`
    : `d_${dest.lat.toFixed(5)}_${dest.lng.toFixed(5)}`;

  // External "view in maps" link — universal q= URL works on Google
  // Maps web, Apple Maps (iOS), and falls back gracefully elsewhere.
  const fullMapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${(rider ?? dest).lat},${(rider ?? dest).lng}`)}`;

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
        style={{ width: '100%', height: 240, border: 0, display: 'block' }}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
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
        🔍 {tr(locale, 'Open in Google Maps', 'Ouvrir dans Google Maps', 'افتح في خرائط جوجل')}
      </a>
    </section>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { MapboxLiveMap, MAPBOX_TOKEN_CONFIGURED } from '@/components/maps/mapbox-live-map';

/**
 * Live delivery map for the customer tracking page.
 *
 * Why static IMAGE not iframe:
 *   - iOS WhatsApp's in-app browser (and iOS Safari with Intelligent
 *     Tracking Prevention enabled) blocks third-party iframes —
 *     openstreetmap.org / google.com/maps/embed all show as a blank
 *     white box. Customers see the "Reduce Protections" banner.
 *   - <img src="...staticmap.png"> is exempt from tracking prevention.
 *     It always loads regardless of WebView restrictions.
 *
 * Provider chain:
 *   1. Google Maps Static API — preferred. Requires the same key as
 *      the Embed API but with the "Maps Static API" service enabled
 *      in Google Cloud (and billing). Gives the recognizable Google
 *      look + custom markers + a path line between rider and dest.
 *   2. staticmap.openstreetmap.de — free public OSM static service.
 *      No key needed. Falls back via the <img onError> handler if
 *      the Google call fails (key not configured, Static API not
 *      enabled, billing missing, network).
 *
 * The image src changes on every rider heartbeat so the map "moves"
 * — image refresh is silent (browser caches by URL, new URL = new
 * fetch). Customer feels live tracking without iframe baggage.
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

const MAP_W = 640;
const MAP_H = 360;

/**
 * Public moped emoji image — Twemoji 🛵 hosted on jsdelivr's CDN.
 * Google Static Maps fetches this URL to render the rider's pin as
 * a recognizable moped icon instead of a plain colored circle.
 * Twemoji is open-source and the jsdelivr mirror is rock-solid.
 */
const MOPED_ICON_URL = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/1f6f5.png';

/** Google Static Maps URL with rider + destination markers + a thin
 *  path line between them. Rider uses the moped icon; destination
 *  stays as a flag-style red pin so it's distinguishable. */
function gmapsStaticUrl(
  key: string,
  rider: { lat: number; lng: number } | null,
  dest: { lat: number; lng: number },
): string {
  const params = new URLSearchParams();
  params.set('size', `${MAP_W}x${MAP_H}`);
  params.set('scale', '2'); // retina
  params.set('maptype', 'roadmap');
  params.set('key', key);
  // Destination — small red pin labeled H (home).
  params.append('markers', `color:red|label:H|${dest.lat},${dest.lng}`);

  if (rider) {
    // Rider — custom moped icon. anchor:center keeps the icon's
    // optical center at the actual lat/lng. scale:2 doubles the icon
    // for retina output sharpness.
    params.append('markers', `icon:${MOPED_ICON_URL}|anchor:center|scale:2|${rider.lat},${rider.lng}`);
    params.append('path', `color:0x3b82f6cc|weight:4|${rider.lat},${rider.lng}|${dest.lat},${dest.lng}`);
    // No center/zoom — Google auto-fits to all elements.
  } else {
    params.set('center', `${dest.lat},${dest.lng}`);
    params.set('zoom', '15');
  }
  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
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

  // Build the Google Static Maps URL when the key is available; that's
  // the only reliable provider for in-app WebViews. OSM static was
  // tested DNS-unreachable in production — leaving it as a fallback
  // wedged the map in a 'forever loading' state for users hitting the
  // primary fail. When the key is missing, render a placeholder card
  // with an "Open in Maps" button instead.
  const gmapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '';
  const imgSrc = gmapsKey
    ? gmapsStaticUrl(gmapsKey, rider ? { lat: rider.lat, lng: rider.lng } : null, dest)
    : null;

  // External "open in maps" link — universal q= URL works on Google
  // Maps web, Apple Maps (iOS), and falls back gracefully elsewhere.
  const focus = rider ?? dest;
  const fullMapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${focus.lat},${focus.lng}`)}`;

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
      {/* Live map. Mapbox GL JS when NEXT_PUBLIC_MAPBOX_TOKEN is
          set (renders to <canvas>, animates the rider pin smoothly
          without re-fetching tiles — same approach UberEats uses).
          Falls back to Google Static when no Mapbox token, then to
          a tappable placeholder when no Google key either. */}
      {MAPBOX_TOKEN_CONFIGURED ? (
        <MapboxLiveMap
          destLat={dest.lat}
          destLng={dest.lng}
          riderLat={rider?.lat ?? null}
          riderLng={rider?.lng ?? null}
          height={360}
        />
      ) : (
        <a href={fullMapHref} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={tr(locale, 'Map showing driver and destination', 'Carte du livreur', 'خريطة السائق')}
              width={MAP_W}
              height={MAP_H}
              style={{
                width: '100%', height: 'auto', display: 'block',
                aspectRatio: `${MAP_W} / ${MAP_H}`,
                objectFit: 'cover',
                background: '#e2e8f0',
              }}
            />
          ) : (
            <div style={{
              width: '100%',
              aspectRatio: `${MAP_W} / ${MAP_H}`,
              background: '#e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#64748b', fontSize: 13, fontWeight: 600,
            }}>
              🗺️ {tr(locale, 'Tap to open map', 'Voir la carte', 'افتح الخريطة')}
            </div>
          )}
        </a>
      )}
      <div style={{
        textAlign: 'center', padding: '6px 10px', fontSize: 11,
        color: '#3b82f6', background: '#f8fafc', fontWeight: 600,
        borderTop: '1px solid #e2e8f0',
      }}>
        🔍 {tr(locale, 'Tap map to open in Google Maps', 'Toucher pour ouvrir dans Maps', 'اضغط للفتح في خرائط')}
      </div>
    </section>
  );
}

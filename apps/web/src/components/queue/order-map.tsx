'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

/**
 * "23s" / "2 min" / "5 min" — short relative-time string used in the
 * stale-heartbeat banner. Locale-aware unit ('s' / 'min'), no fancy
 * pluralisation since this is a glance-able badge, not prose.
 */
function formatStale(sec: number, loc: 'en' | 'fr' | 'ar'): string {
  if (sec < 60) {
    if (loc === 'ar') return `${sec} ث`;
    return `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  if (loc === 'ar') return `${m} د`;
  return `${m} min`;
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
  // `rider`        — most recent server-confirmed position
  // `displayRider` — what we actually render; lerps toward `rider` over
  //                  ~700ms so the marker glides instead of teleporting
  const [rider, setRider] = useState<RiderPin | null>(null);
  const [displayRider, setDisplayRider] = useState<RiderPin | null>(null);
  // `lastEventAt` — wall-clock of the most recent realtime push OR
  // poll fetch. Drives the staleness banner + the polling fallback.
  const [lastEventAt, setLastEventAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  const dest = useMemo(() => ({ lat: destLat, lng: destLng }), [destLat, destLng]);

  // ── Initial fetch + Realtime: rider_locations for this ticket ────
  useEffect(() => {
    const sb = createBrowserClient(supabaseUrl, supabaseAnonKey);
    let cancelled = false;

    const ingest = (data: any, source: 'fetch' | 'realtime' | 'poll') => {
      if (cancelled) return;
      if (typeof data?.lat !== 'number' || typeof data?.lng !== 'number') return;
      setRider({
        lat: data.lat, lng: data.lng,
        speedMps: typeof (data.speed_mps ?? data.speedMps) === 'number'
          ? (data.speed_mps ?? data.speedMps) : null,
        recordedAt: data.recorded_at ?? data.recordedAt,
      });
      setLastEventAt(Date.now());
      // Suppress unused warning; useful for log forensics.
      void source;
    };

    sb.from('rider_locations')
      .select('lat, lng, speed_mps, recorded_at')
      .eq('ticket_id', ticketId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: any }) => { if (data) ingest(data, 'fetch'); });

    const channel = sb
      .channel(`rider-track-${ticketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rider_locations', filter: `ticket_id=eq.${ticketId}` },
        (payload) => ingest(payload.new, 'realtime'),
      )
      .subscribe();

    // ── Polling fallback ─────────────────────────────────────────────
    // Realtime websockets drop silently on flaky carrier networks. If
    // we haven't seen any event in ~25 s we kick on a 5 s polling loop
    // until realtime resumes (each successful realtime event resets
    // lastEventAt and the poll naturally idles). Cheap insurance —
    // worst case 12 reqs/min on a stuck connection vs. a dead map.
    const pollTimer = setInterval(async () => {
      if (cancelled) return;
      if (Date.now() - lastEventAtRef.current < 25_000) return;
      const { data } = await sb.from('rider_locations')
        .select('lat, lng, speed_mps, recorded_at')
        .eq('ticket_id', ticketId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) ingest(data, 'poll');
    }, 5_000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      try { sb.removeChannel(channel); } catch {}
    };
  }, [ticketId, supabaseUrl, supabaseAnonKey]);

  // Mirror lastEventAt into a ref so the poll closure sees fresh values.
  const lastEventAtRef = useRef(lastEventAt);
  useEffect(() => { lastEventAtRef.current = lastEventAt; }, [lastEventAt]);

  // ── Marker interpolation — lerp displayRider toward rider over 700ms ──
  // Smooth glide between fixes (matches the UberEats / DoorDash feel).
  // requestAnimationFrame loop runs at the browser's native ~60 fps and
  // shuts off automatically when the tab is hidden.
  useEffect(() => {
    if (!rider) { setDisplayRider(null); return; }
    const start = performance.now();
    const from = displayRider ?? rider;
    const duration = 700;
    let raf = 0;

    const tick = (t: number) => {
      const elapsed = t - start;
      const k = Math.min(1, elapsed / duration);
      // ease-out cubic — feels organic without overshoot
      const e = 1 - Math.pow(1 - k, 3);
      setDisplayRider({
        lat: from.lat + (rider.lat - from.lat) * e,
        lng: from.lng + (rider.lng - from.lng) * e,
        speedMps: rider.speedMps,
        recordedAt: rider.recordedAt,
      });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally only depending on `rider` — we want a fresh
    // animation per server fix, not on every interpolation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rider]);

  // ── Staleness clock — re-renders the banner once a second ─────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  // Stale = no server update in > 45 s. We're conservative — at the
  // 4 s heartbeat cadence, missing ~10 in a row is a real problem
  // (phone locked, signal lost, browser tab killed).
  const recordedAtMs = rider?.recordedAt ? new Date(rider.recordedAt).getTime() : null;
  const staleSec = recordedAtMs ? Math.max(0, Math.floor((now - recordedAtMs) / 1000)) : null;
  const isStale = staleSec != null && staleSec > 45;

  // Build the Google Static Maps URL when the key is available; that's
  // the only reliable provider for in-app WebViews. OSM static was
  // tested DNS-unreachable in production — leaving it as a fallback
  // wedged the map in a 'forever loading' state for users hitting the
  // primary fail. When the key is missing, render a placeholder card
  // with an "Open in Maps" button instead.
  const gmapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '';
  // Static-image src is rebuilt on every interpolated frame — that
  // would hammer Google's Static API. Anchor it on the actual server
  // rider position (changes only on each heartbeat), not the lerped
  // displayRider. Vector map uses displayRider for smooth motion;
  // static fallback stays at heartbeat resolution.
  const imgSrc = gmapsKey
    ? gmapsStaticUrl(gmapsKey, rider ? { lat: rider.lat, lng: rider.lng } : null, dest)
    : null;

  // External "open in maps" link — universal q= URL works on Google
  // Maps web, Apple Maps (iOS), and falls back gracefully elsewhere.
  const focus = displayRider ?? rider ?? dest;
  const fullMapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${focus.lat},${focus.lng}`)}`;

  // ── Straight-line ETA ─────────────────────────────────────────────
  // Uses the lerped position so the distance counts down smoothly
  // alongside the moving pin. Server position would tick in 4s jumps.
  const eta = useMemo(() => {
    if (!displayRider) return null;
    const distM = haversineM({ lat: displayRider.lat, lng: displayRider.lng }, dest);
    const speedMps = displayRider.speedMps && displayRider.speedMps > 1 && displayRider.speedMps < 30
      ? displayRider.speedMps
      : 8.3;
    const seconds = distM / speedMps;
    const minutes = Math.max(1, Math.round(seconds / 60));
    return { distKm: distM / 1000, minutes };
  }, [displayRider, dest]);

  return (
    <section style={{
      borderRadius: 14, overflow: 'hidden', background: '#fff',
      boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 4px 12px rgba(15,23,42,0.04)',
    }}>
      {/* Two-stat header — ETA on the left, distance on the right.
          Refined typography (uppercase muted micro-labels, large dark
          numbers). Same visual language as the driver portal. */}
      <div style={{
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, borderBottom: '1px solid #f1f5f9',
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 600, color: '#94a3b8',
            letterSpacing: 0.4, textTransform: 'uppercase',
          }}>
            {eta ? tr(locale, 'Arriving in', 'Arrivée dans', 'الوصول خلال') : tr(locale, 'Status', 'Statut', 'الحالة')}
          </div>
          <div style={{
            fontSize: 22, fontWeight: 700, color: '#0f172a',
            letterSpacing: -0.5, marginTop: 2, lineHeight: 1,
          }}>
            {eta
              ? <>~{eta.minutes}<span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginInlineStart: 3 }}>min</span></>
              : <span style={{ fontSize: 14, fontWeight: 500, color: '#94a3b8' }}>
                  {tr(locale, 'Waiting for driver…', 'En attente du livreur…', 'بانتظار السائق…')}
                </span>}
          </div>
        </div>
        {eta && (
          <div style={{ textAlign: 'end' }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: '#94a3b8',
              letterSpacing: 0.4, textTransform: 'uppercase',
            }}>
              {tr(locale, 'Distance', 'Distance', 'المسافة')}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 600, color: '#0f172a',
              marginTop: 2, lineHeight: 1,
            }}>
              {eta.distKm < 0.1
                ? <>&lt; 100<span style={{ fontSize: 11, color: '#94a3b8', marginInlineStart: 2 }}>m</span></>
                : <>{eta.distKm.toFixed(eta.distKm < 10 ? 1 : 0)}<span style={{ fontSize: 11, color: '#94a3b8', marginInlineStart: 2 }}>km</span></>}
            </div>
          </div>
        )}
      </div>
      {/* Live map. Mapbox GL JS when NEXT_PUBLIC_MAPBOX_TOKEN is
          set (renders to <canvas>, animates the rider pin smoothly
          without re-fetching tiles — same approach UberEats uses).
          Falls back to Google Static when no Mapbox token, then to
          a tappable placeholder when no Google key either. */}
      {MAPBOX_TOKEN_CONFIGURED ? (
        <div style={{ position: 'relative' }}>
          <MapboxLiveMap
            destLat={dest.lat}
            destLng={dest.lng}
            riderLat={displayRider?.lat ?? null}
            riderLng={displayRider?.lng ?? null}
            height={360}
          />
          {/* Stale-heartbeat banner — appears in the top-left corner of
              the map when the last server update is older than 45 s.
              Pulses subtly to draw the eye without being alarming.
              Honest UX: customer sees we know we don't have fresh data
              instead of being misled by a stale-but-confidently-rendered
              pin. */}
          {isStale && rider && (
            <div style={{
              position: 'absolute', top: 12, insetInlineStart: 12,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 999,
              background: 'rgba(15,23,42,0.78)',
              color: '#fff',
              fontSize: 11, fontWeight: 600,
              letterSpacing: 0.2,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              boxShadow: '0 4px 14px rgba(15,23,42,0.18)',
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: '#f59e0b',
                boxShadow: '0 0 0 3px rgba(245,158,11,0.28)',
                animation: 'qfo-pulse-soft 1.4s ease-in-out infinite',
              }} />
              {tr(
                locale,
                `Reconnecting · last seen ${formatStale(staleSec ?? 0, 'en')} ago`,
                `Reconnexion · vu il y a ${formatStale(staleSec ?? 0, 'fr')}`,
                `إعادة الاتصال · آخر ظهور قبل ${formatStale(staleSec ?? 0, 'ar')}`,
              )}
            </div>
          )}
        </div>
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

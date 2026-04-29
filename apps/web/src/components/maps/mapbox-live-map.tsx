'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live interactive map shared by the customer tracking page and the
 * driver portal.
 *
 * Engine selection:
 *   1. Google Maps JS SDK — preferred when NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY
 *      is set AND Maps JavaScript API is enabled on the Google Cloud
 *      project (with billing). Familiar Google Maps look + tiles.
 *   2. MapLibre GL JS + OpenFreeMap — used when Google fails to load
 *      (no key, billing not enabled, network blocked, script error).
 *      No account, no cost, OSM-styled vector tiles.
 *
 * Both engines render to <canvas> via WebGL — no iframes — so iOS
 * WhatsApp's Tracking Prevention can't block them. Marker movement
 * is a CSS transform (no tile re-fetch), same approach UberEats and
 * DoorDash use for live tracking.
 *
 * Why dual-engine instead of one: Google Maps gives the brand-
 * recognized look most customers expect. MapLibre + OpenFreeMap is
 * the safety net so the map ALWAYS renders even if the Google
 * project's billing breaks, key expires, or the user's network
 * blocks googleapis.com. The fallback is silent and automatic.
 */

const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_JS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const MOPED_ICON = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/1f6f5.png';
const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY ?? '';

declare global {
  interface Window {
    maplibregl?: any;
    google?: any;
  }
}

// ── Loaders ──────────────────────────────────────────────────────────

let maplibreLoadPromise: Promise<any> | null = null;
function ensureMaplibre(): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (maplibreLoadPromise) return maplibreLoadPromise;
  maplibreLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPLIBRE_JS}"]`);
    if (existing) {
      if (window.maplibregl) return resolve(window.maplibregl);
      existing.addEventListener('load', () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibregl missing')));
      existing.addEventListener('error', () => reject(new Error('maplibre script error')));
      return;
    }
    const s = document.createElement('script');
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.onload = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error('maplibregl missing'));
    s.onerror = () => reject(new Error('maplibre script error'));
    document.head.appendChild(s);
  });
  return maplibreLoadPromise;
}

let gmapsLoadPromise: Promise<any> | null = null;
function ensureGoogleMaps(key: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (gmapsLoadPromise) return gmapsLoadPromise;
  gmapsLoadPromise = new Promise((resolve, reject) => {
    const cbName = `__qfloGmCb_${Math.random().toString(36).slice(2, 10)}`;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (window as any)[cbName] = () => {
      if (timer) clearTimeout(timer);
      try { delete (window as any)[cbName]; } catch {}
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error('gmaps callback missing maps'));
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&callback=${cbName}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => {
      if (timer) clearTimeout(timer);
      reject(new Error('gmaps script error'));
    };
    document.head.appendChild(s);
    // Hard timeout — if Google's loader hangs (billing not enabled,
    // API not authorised, network firewall), give up so the fallback
    // can take over. 6s is generous; usually loads in <2s.
    timer = setTimeout(() => reject(new Error('gmaps load timeout')), 6000);
  });
  return gmapsLoadPromise;
}

// ── Engine abstraction ──────────────────────────────────────────────

interface MapEngine {
  setRiderPos(lat: number, lng: number): void;
  fitBoth(): void;
  destroy(): void;
}

function createGoogleEngine(
  gmaps: any,
  container: HTMLDivElement,
  destLat: number,
  destLng: number,
): MapEngine {
  const map = new gmaps.Map(container, {
    center: { lat: destLat, lng: destLng },
    zoom: 14,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: true,
    gestureHandling: 'greedy',
  });
  // Custom destination icon — flag-shaped SVG data URL. Cleaner than
  // Google's default red pin with an "H" label, and consistent with
  // the visual language (rounded shapes, soft drop-shadow).
  const DEST_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <defs><filter id="s" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/></filter></defs>
      <path filter="url(#s)" fill="#ef4444" d="M18 0C8.06 0 0 7.6 0 17c0 12.75 18 27 18 27s18-14.25 18-27C36 7.6 27.94 0 18 0z"/>
      <circle cx="18" cy="17" r="6" fill="#fff"/>
    </svg>`,
  );
  const destMarker = new gmaps.Marker({
    position: { lat: destLat, lng: destLng },
    map,
    icon: {
      url: DEST_ICON,
      scaledSize: new gmaps.Size(36, 44),
      anchor: new gmaps.Point(18, 44),
    },
  });
  let riderMarker: any = null;
  let routeLine: any = null;

  // Bigger moped icon with a proper shadow — the previous 40px size
  // looked tiny against a 14-zoom street view. 56px reads at a glance
  // even on a small phone screen.
  const RIDER_ICON_SIZE = 56;

  return {
    setRiderPos(lat: number, lng: number) {
      const pos = new gmaps.LatLng(lat, lng);
      if (!riderMarker) {
        riderMarker = new gmaps.Marker({
          position: pos,
          map,
          icon: {
            url: MOPED_ICON,
            scaledSize: new gmaps.Size(RIDER_ICON_SIZE, RIDER_ICON_SIZE),
            anchor: new gmaps.Point(RIDER_ICON_SIZE / 2, RIDER_ICON_SIZE / 2),
          },
          // Slight z-index bump so the moped is always on top of the
          // route line and destination marker.
          zIndex: 999,
        });
      } else {
        riderMarker.setPosition(pos);
      }
      const path = [pos, new gmaps.LatLng(destLat, destLng)];
      if (!routeLine) {
        routeLine = new gmaps.Polyline({
          path,
          strokeColor: '#3b82f6',
          strokeOpacity: 0,                  // hide the solid line
          strokeWeight: 4,
          // Dotted symbol pattern — looks more refined than a solid
          // line, hints at "approximate route" (we don't do real
          // routing, just rider-to-dest).
          icons: [
            { icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, strokeColor: '#3b82f6', scale: 3 },
              offset: '0', repeat: '14px' },
          ],
          map,
        });
      } else {
        routeLine.setPath(path);
      }
    },
    fitBoth() {
      if (!riderMarker) return;
      const bounds = new gmaps.LatLngBounds();
      bounds.extend(riderMarker.getPosition());
      bounds.extend(new gmaps.LatLng(destLat, destLng));
      map.fitBounds(bounds, 60);
    },
    destroy() {
      try { destMarker.setMap(null); } catch {}
      if (riderMarker) try { riderMarker.setMap(null); } catch {}
      if (routeLine) try { routeLine.setMap(null); } catch {}
    },
  };
}

async function createMaplibreEngine(
  ml: any,
  container: HTMLDivElement,
  destLat: number,
  destLng: number,
): Promise<MapEngine> {
  const map = new ml.Map({
    container,
    style: MAP_STYLE_URL,
    center: [destLng, destLat],
    zoom: 14,
    attributionControl: { compact: true },
    scrollZoom: false,
    dragPan: true,
  });
  // Custom flag-shaped destination marker — same SVG used on the
  // Google engine so the visual is consistent regardless of which
  // engine ends up rendering.
  const destEl = document.createElement('div');
  destEl.innerHTML = `
    <svg width="36" height="44" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.25));display:block">
      <path fill="#ef4444" d="M18 0C8.06 0 0 7.6 0 17c0 12.75 18 27 18 27s18-14.25 18-27C36 7.6 27.94 0 18 0z"/>
      <circle cx="18" cy="17" r="6" fill="#fff"/>
    </svg>`;
  destEl.style.cssText = 'user-select:none;cursor:default';
  const destMarker = new ml.Marker({ element: destEl, anchor: 'bottom' })
    .setLngLat([destLng, destLat])
    .addTo(map);

  // Wait for the style to load before adding sources/layers
  await new Promise<void>((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.on('load', () => resolve());
  });
  if (!map.getSource('rider-path')) {
    map.addSource('rider-path', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
    });
    map.addLayer({
      id: 'rider-path-line',
      type: 'line',
      source: 'rider-path',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#3b82f6', 'line-width': 4, 'line-opacity': 0.7, 'line-dasharray': [2, 1] },
    });
  }

  let riderMarker: any = null;

  // Auto-resize on container size change
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => { try { map.resize(); } catch {} });
    ro.observe(container);
  }

  return {
    setRiderPos(lat: number, lng: number) {
      if (!riderMarker) {
        const el = document.createElement('div');
        // Bigger moped (56px) so it reads at a glance on a phone, with
        // a soft drop-shadow for depth. White circular halo behind the
        // emoji adds contrast against busy map tiles.
        el.innerHTML = `
          <div style="position:relative;width:56px;height:56px;">
            <div style="position:absolute;inset:6px;border-radius:50%;background:rgba(255,255,255,0.92);box-shadow:0 4px 14px rgba(15,23,42,0.22);"></div>
            <img src="${MOPED_ICON}" width="44" height="44" alt="" style="position:absolute;top:6px;left:6px;display:block;user-select:none;-webkit-user-drag:none;"/>
          </div>`;
        el.style.cssText = 'user-select:none;cursor:default;line-height:0;';
        riderMarker = new ml.Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .addTo(map);
      } else {
        riderMarker.setLngLat([lng, lat]);
      }
      const src = map.getSource('rider-path');
      if (src && src.setData) {
        src.setData({
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: [[lng, lat], [destLng, destLat]] },
        });
      }
    },
    fitBoth() {
      if (!riderMarker) return;
      const r = riderMarker.getLngLat();
      const bounds = new ml.LngLatBounds([r.lng, r.lat], [r.lng, r.lat]).extend([destLng, destLat]);
      try { map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 1200 }); } catch {}
    },
    destroy() {
      ro?.disconnect();
      try { destMarker.remove(); } catch {}
      if (riderMarker) try { riderMarker.remove(); } catch {}
      try { map.remove(); } catch {}
    },
  };
}

// ── Component ────────────────────────────────────────────────────────

export interface MapboxLiveMapProps {
  destLat: number;
  destLng: number;
  riderLat: number | null;
  riderLng: number | null;
  /** Map height in pixels. Defaults to 320. */
  height?: number;
  /** When true (default), auto-fit bounds on every rider update. */
  fitBoth?: boolean;
}

export function MapboxLiveMap({
  destLat, destLng, riderLat, riderLng, height = 320, fitBoth = true,
}: MapboxLiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const [provider, setProvider] = useState<'google' | 'maplibre' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Engine setup ──────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    const container = containerRef.current;

    async function setup() {
      // Try Google Maps first when key is configured.
      if (GMAPS_KEY) {
        try {
          const gmaps = await ensureGoogleMaps(GMAPS_KEY);
          if (cancelled) return;
          engineRef.current = createGoogleEngine(gmaps, container, destLat, destLng);
          setProvider('google');
          return;
        } catch (e: any) {
          console.warn('[live-map] Google Maps unavailable, falling back to OpenFreeMap:', e?.message);
        }
      }
      // Fallback: MapLibre + OpenFreeMap. Always-free, no key.
      try {
        const ml = await ensureMaplibre();
        if (cancelled) return;
        engineRef.current = await createMaplibreEngine(ml, container, destLat, destLng);
        if (cancelled) {
          engineRef.current?.destroy();
          engineRef.current = null;
          return;
        }
        setProvider('maplibre');
      } catch (e: any) {
        console.warn('[live-map] both engines failed:', e?.message);
        setError(e?.message ?? 'load_failed');
      }
    }
    setup();

    return () => {
      cancelled = true;
      if (engineRef.current) {
        engineRef.current.destroy();
        engineRef.current = null;
      }
      setProvider(null);
    };
  }, [destLat, destLng]);

  // ── Rider position update ─────────────────────────────────────────
  useEffect(() => {
    if (!engineRef.current) return;
    if (riderLat == null || riderLng == null) return;
    engineRef.current.setRiderPos(riderLat, riderLng);
    if (fitBoth) engineRef.current.fitBoth();
  }, [riderLat, riderLng, provider, fitBoth]);

  if (error) {
    return (
      <div style={{
        height, background: '#f1f5f9',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: '#64748b', fontSize: 13, gap: 4,
      }}>
        <span style={{ fontSize: 28 }}>🗺️</span>
        <span>Map unavailable on this connection.</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height, background: '#e2e8f0' }} />
      {/* Tiny provider badge so the operator can debug which engine
          is live. Not visible to customers (positioned bottom-left,
          translucent, 10px). */}
      {provider && (
        <span style={{
          position: 'absolute', bottom: 4, left: 4,
          fontSize: 9, padding: '1px 4px', borderRadius: 3,
          background: 'rgba(255,255,255,0.7)', color: '#94a3b8',
          pointerEvents: 'none',
        }}>
          {provider === 'google' ? 'Google Maps' : 'OpenStreetMap'}
        </span>
      )}
    </div>
  );
}

/** Always render — engine selects itself at runtime, falls back
 *  silently when needed. Kept exported for source compatibility. */
export const MAPBOX_TOKEN_CONFIGURED = true;

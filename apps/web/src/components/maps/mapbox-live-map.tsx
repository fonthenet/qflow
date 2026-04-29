'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live interactive map component shared by the customer tracking page
 * and the driver portal. Uses MapLibre GL JS (open-source fork of
 * Mapbox GL JS, identical API) with free OpenFreeMap vector tiles —
 * no account required anywhere.
 *
 * Why this stack:
 *   - WebGL + <canvas> rendering — NOT an iframe, so iOS WhatsApp's
 *     Tracking Prevention can't block it. Same architecture UberEats
 *     and DoorDash use for their live tracking pages.
 *   - Marker.setLngLat() repositions the DOM marker via a CSS
 *     transform — no tile re-fetch, no flicker. Smooth animation
 *     between GPS fixes.
 *   - MapLibre GL JS is BSD-3 licensed, OpenFreeMap is donation-
 *     funded with Bunny CDN backing. Free for commercial use, no
 *     API key, no rate limit at our usage scale.
 *
 * Failure modes handled:
 *   - CDN script fails to load → 'map_unavailable' placeholder
 *   - WebGL not supported by browser → caught at init, placeholder
 *   - OpenFreeMap CDN unreachable → tiles fail to load but the map
 *     shell still renders; we don't fall over
 *   - dest lat/lng missing → caller shouldn't render this component
 *     (handled in the parent JSX)
 *
 * Cost: $0. No account, no API key, no env var.
 */

const MAPLIBRE_VERSION = '4.7.1';
const MAPLIBRE_JS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.js`;
const MAPLIBRE_CSS = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css`;

// OpenFreeMap "liberty" style — clean, modern look, OSM data with
// a colourful but not-overwhelming palette. Other styles available:
//   /styles/positron (light grey, less detail)
//   /styles/bright   (vivid, high-contrast)
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

declare global {
  interface Window { maplibregl?: any }
}

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
      if (window.maplibregl) {
        resolve(window.maplibregl);
        return;
      }
      existing.addEventListener('load', () => {
        if (window.maplibregl) resolve(window.maplibregl);
        else reject(new Error('maplibregl not on window'));
      });
      existing.addEventListener('error', () => reject(new Error('Failed to load maplibre-gl')));
      return;
    }
    const s = document.createElement('script');
    s.src = MAPLIBRE_JS;
    s.async = true;
    s.onload = () => {
      if (window.maplibregl) resolve(window.maplibregl);
      else reject(new Error('maplibregl not on window'));
    };
    s.onerror = () => reject(new Error('Failed to load maplibre-gl'));
    document.head.appendChild(s);
  });
  return maplibreLoadPromise;
}

export interface MapboxLiveMapProps {
  destLat: number;
  destLng: number;
  /** Rider position — null until the driver starts streaming GPS. */
  riderLat: number | null;
  riderLng: number | null;
  /** Map height in pixels. Defaults to 320. */
  height?: number;
  /** When true (default), the map auto-fits bounds to include both
   *  rider and destination on every update. Set false if you want
   *  the user to control the viewport (e.g. driver pinching to
   *  zoom street detail). */
  fitBoth?: boolean;
}

export function MapboxLiveMap({
  destLat, destLng, riderLat, riderLng, height = 320, fitBoth = true,
}: MapboxLiveMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const destMarkerRef = useRef<any>(null);
  const riderMarkerRef = useRef<any>(null);
  const lineSourceAddedRef = useRef<boolean>(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Initialise the map once we have a destination ────────────────
  useEffect(() => {
    let cancelled = false;
    ensureMaplibre().then((ml) => {
      if (cancelled || !containerRef.current) return;
      try {
        const map = new ml.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [destLng, destLat],
          zoom: 14,
          attributionControl: { compact: true },
          // Touch gestures only — desktop-style scroll-wheel zoom is
          // jarring inside a chat WebView where the page itself is
          // also scrollable.
          scrollZoom: false,
          dragPan: true,
        });
        mapRef.current = map;

        // Destination marker
        const destEl = document.createElement('div');
        destEl.style.cssText = 'font-size:32px;line-height:1;user-select:none;cursor:default';
        destEl.textContent = '📍';
        destMarkerRef.current = new ml.Marker({ element: destEl, anchor: 'bottom' })
          .setLngLat([destLng, destLat])
          .addTo(map);

        // Add a route line source/layer once the style finishes loading.
        // We populate the geometry in the rider-update effect.
        map.on('load', () => {
          if (cancelled) return;
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
              paint: {
                'line-color': '#3b82f6',
                'line-width': 4,
                'line-opacity': 0.7,
                'line-dasharray': [2, 1],
              },
            });
            lineSourceAddedRef.current = true;
          }
          setReady(true);
        });

        map.on('error', (e: any) => {
          // Tile errors are common (network blips) — don't crash. Only
          // surface a hard error when the style itself fails to load.
          if (e?.error?.message && /style/i.test(e.error.message)) {
            console.warn('[maplibre] style error', e.error);
          }
        });

        // Auto-resize when the container changes size (parent layout
        // shifts, viewport rotation). MapLibre doesn't observe its
        // own container — without this the map stretches with bad math.
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          const ro = new ResizeObserver(() => {
            try { map.resize(); } catch {}
          });
          ro.observe(containerRef.current);
          (map as any)._qfloRO = ro;
        }
      } catch (e: any) {
        console.warn('[maplibre] init failed', e);
        setError(e?.message ?? 'init_failed');
      }
    }).catch((e) => {
      console.warn('[maplibre] CDN load failed', e);
      setError(e?.message ?? 'load_failed');
    });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        try { (mapRef.current as any)._qfloRO?.disconnect(); } catch {}
        try { mapRef.current.remove(); } catch {}
        mapRef.current = null;
      }
      destMarkerRef.current = null;
      riderMarkerRef.current = null;
      lineSourceAddedRef.current = false;
    };
  }, [destLat, destLng]);

  // ── Update rider marker + path on every position change ──────────
  useEffect(() => {
    const map = mapRef.current;
    const ml = window.maplibregl;
    if (!ready || !map || !ml) return;

    if (riderLat == null || riderLng == null) {
      if (riderMarkerRef.current) {
        try { riderMarkerRef.current.remove(); } catch {}
        riderMarkerRef.current = null;
      }
      return;
    }

    if (!riderMarkerRef.current) {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:34px;line-height:1;user-select:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.35));transition:transform 0.6s ease-out';
      el.textContent = '🛵';
      riderMarkerRef.current = new ml.Marker({ element: el, anchor: 'center' })
        .setLngLat([riderLng, riderLat])
        .addTo(map);
    } else {
      // setLngLat repositions the DOM marker via CSS transform.
      // No tile re-fetch, no map redraw — just a smooth move.
      riderMarkerRef.current.setLngLat([riderLng, riderLat]);
    }

    // Update the dashed path between rider and destination.
    if (lineSourceAddedRef.current) {
      const src = map.getSource('rider-path');
      if (src && src.setData) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [[riderLng, riderLat], [destLng, destLat]],
          },
        });
      }
    }

    // Auto-fit bounds with a smooth fly animation.
    if (fitBoth) {
      try {
        const bounds = new ml.LngLatBounds([riderLng, riderLat], [destLng, destLat])
          .extend([destLng, destLat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 1200 });
      } catch {}
    }
  }, [ready, riderLat, riderLng, destLat, destLng, fitBoth]);

  // ── Render ────────────────────────────────────────────────────────
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

  return <div ref={containerRef} style={{ width: '100%', height, background: '#e2e8f0' }} />;
}

/**
 * Always true — MapLibre + OpenFreeMap requires no env var. Kept as
 * a constant export so the call sites' conditional render syntax
 * doesn't have to change.
 */
export const MAPBOX_TOKEN_CONFIGURED = true;

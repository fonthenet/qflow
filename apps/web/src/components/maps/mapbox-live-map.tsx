'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Live interactive map component shared by the customer tracking page
 * and the driver portal. Renders Mapbox GL JS via CDN — uses WebGL +
 * <canvas>, NOT an iframe, so iOS WhatsApp's Tracking Prevention
 * doesn't block it the way it blocked openstreetmap.org / Google
 * Maps Embed.
 *
 * Behaviour:
 *   - First mount: load mapbox-gl JS + CSS from jsdelivr CDN once
 *     (cached across page navigations within the session)
 *   - Initialise map centred on the destination
 *   - Add a 📍 marker for the destination (static)
 *   - Add a 🛵 marker for the rider (animates via Marker.setLngLat
 *     as new positions arrive — no full re-render, no tile re-fetch)
 *   - On position update, smoothly pan/zoom to fit both points so
 *     the customer/driver always sees the route at a useful scale
 *
 * Failure modes:
 *   - No token configured → render an "ask the operator to set
 *     NEXT_PUBLIC_MAPBOX_TOKEN" placeholder
 *   - Script load fails (CDN down, offline, CSP) → render a
 *     "map unavailable" placeholder so the rest of the page works
 *   - WebGL not supported → onWebglContextLost fires, we render
 *     the placeholder
 */

const MAPBOX_VERSION = '3.7.0';
const MAPBOX_JS = `https://cdn.jsdelivr.net/npm/mapbox-gl@${MAPBOX_VERSION}/dist/mapbox-gl.js`;
const MAPBOX_CSS = `https://cdn.jsdelivr.net/npm/mapbox-gl@${MAPBOX_VERSION}/dist/mapbox-gl.css`;

declare global {
  interface Window { mapboxgl?: any }
}

let mapboxLoadPromise: Promise<any> | null = null;
function ensureMapbox(token: string): Promise<any> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.mapboxgl) {
    if (!window.mapboxgl.accessToken) window.mapboxgl.accessToken = token;
    return Promise.resolve(window.mapboxgl);
  }
  if (mapboxLoadPromise) return mapboxLoadPromise;
  mapboxLoadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPBOX_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPBOX_JS}"]`);
    if (existing) {
      if (window.mapboxgl) {
        if (!window.mapboxgl.accessToken) window.mapboxgl.accessToken = token;
        resolve(window.mapboxgl);
        return;
      }
      existing.addEventListener('load', () => {
        if (!window.mapboxgl) return reject(new Error('mapbox-gl not on window'));
        if (!window.mapboxgl.accessToken) window.mapboxgl.accessToken = token;
        resolve(window.mapboxgl);
      });
      existing.addEventListener('error', () => reject(new Error('Failed to load mapbox-gl')));
      return;
    }
    const s = document.createElement('script');
    s.src = MAPBOX_JS;
    s.async = true;
    s.onload = () => {
      if (!window.mapboxgl) return reject(new Error('mapbox-gl not on window'));
      window.mapboxgl.accessToken = token;
      resolve(window.mapboxgl);
    };
    s.onerror = () => reject(new Error('Failed to load mapbox-gl'));
    document.head.appendChild(s);
  });
  return mapboxLoadPromise;
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

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  // ── Initialise the map once we have a destination + token ────────
  useEffect(() => {
    if (!token) {
      setError('no_token');
      return;
    }
    let cancelled = false;
    ensureMapbox(token).then((mb) => {
      if (cancelled || !containerRef.current) return;
      try {
        const map = new mb.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [destLng, destLat],
          zoom: 14,
          attributionControl: false,
          // Touch gestures only — desktop-style scroll-wheel zoom is
          // jarring inside a chat WebView where the page itself is
          // also scrollable.
          scrollZoom: false,
          dragPan: true,
        });
        mapRef.current = map;

        // Destination marker
        const destEl = document.createElement('div');
        destEl.style.cssText = 'font-size:32px;line-height:1;user-select:none';
        destEl.textContent = '📍';
        destMarkerRef.current = new mb.Marker({ element: destEl, anchor: 'bottom' })
          .setLngLat([destLng, destLat])
          .addTo(map);

        // Add a route line source/layer once the style finishes loading.
        // We populate the line geometry in the rider-update effect.
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

        // Auto-resize when the container changes size (parent layout
        // shifts, viewport rotation). Mapbox doesn't observe its own
        // container — without this the map stretches with bad math.
        if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
          const ro = new ResizeObserver(() => {
            try { map.resize(); } catch {}
          });
          ro.observe(containerRef.current);
          (map as any)._qfloRO = ro;
        }
      } catch (e: any) {
        console.warn('[mapbox] init failed', e);
        setError(e?.message ?? 'init_failed');
      }
    }).catch((e) => {
      console.warn('[mapbox] CDN load failed', e);
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
  }, [destLat, destLng, token]);

  // ── Update rider marker + path on every position change ──────────
  useEffect(() => {
    const map = mapRef.current;
    const mb = window.mapboxgl;
    if (!ready || !map || !mb) return;

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
      riderMarkerRef.current = new mb.Marker({ element: el, anchor: 'center' })
        .setLngLat([riderLng, riderLat])
        .addTo(map);
    } else {
      // setLngLat animates the marker DOM element to the new position.
      // No tile re-fetch, no map redraw — just a CSS transform under
      // the hood. Smooth.
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
        const bounds = new mb.LngLatBounds([riderLng, riderLat], [destLng, destLat])
          .extend([destLng, destLat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 1200 });
      } catch {}
    }
  }, [ready, riderLat, riderLng, destLat, destLng, fitBoth]);

  // ── Render ────────────────────────────────────────────────────────
  if (error) {
    const reason = error === 'no_token'
      ? 'Map not configured.'
      : 'Map unavailable on this connection.';
    return (
      <div style={{
        height, background: '#f1f5f9',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: '#64748b', fontSize: 13, gap: 4,
      }}>
        <span style={{ fontSize: 28 }}>🗺️</span>
        <span>{reason}</span>
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height, background: '#e2e8f0' }} />;
}

export const MAPBOX_TOKEN_CONFIGURED = Boolean(
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
);

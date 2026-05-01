/**
 * Delivery distance + ETA helpers.
 *
 * We deliberately stay free of any external API for V1 (Google Distance
 * Matrix is great but adds a key/cost surface). Haversine + a configurable
 * urban speed gives a good-enough estimate for an 8-15 km city delivery,
 * which is the 95% case for in-house restaurant fleets in DZ/MENA.
 *
 * Used by:
 *   - /api/orders/assign — rider WA assignment ping ("📍 8 km · ~12 min")
 *   - rider portal — header line under the order id
 *
 * If lat/lng is missing on EITHER end we return null, and callers fall
 * back to omitting the metric line entirely (degrades gracefully).
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DeliveryMetrics {
  /** Great-circle distance in kilometers, rounded to 1 decimal. */
  distanceKm: number;
  /** Coarse ETA in minutes, integer. Includes a small buffer for traffic
   *  and last-mile fiddling. */
  etaMinutes: number;
}

/**
 * Average urban delivery speed (km/h). Tuned for dense DZ/MENA cities
 * where a moped weaves through traffic. Adjust per market if needed
 * (e.g. via org country override) — but keep this as the global default.
 */
const URBAN_SPEED_KMH = 22;

/** Constant-time minutes added to the raw drive time to account for
 *  traffic stops, parking, and finding the entrance. */
const LAST_MILE_BUFFER_MINUTES = 2;

/**
 * Haversine distance (km) between two lat/lng pairs.
 * Source: standard great-circle formula with Earth radius 6371 km.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compute (distance, ETA) for a kitchen → drop-off pair.
 * Returns null when either coordinate is missing or invalid.
 */
export function computeDeliveryMetrics(
  kitchen: { latitude: number | null; longitude: number | null } | null | undefined,
  dropoff: { lat: number | null | undefined; lng: number | null | undefined } | null | undefined,
): DeliveryMetrics | null {
  if (!kitchen || kitchen.latitude == null || kitchen.longitude == null) return null;
  if (!dropoff || dropoff.lat == null || dropoff.lng == null) return null;

  const a = { lat: kitchen.latitude, lng: kitchen.longitude };
  const b = { lat: dropoff.lat, lng: dropoff.lng };

  // Guard against obviously bogus coordinates (0,0 in the Atlantic, or
  // anything outside the lat/lng bounds — happens when geocode fails
  // and we accidentally store the placeholder).
  const valid = (p: LatLng) =>
    Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
    p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180 &&
    !(p.lat === 0 && p.lng === 0);
  if (!valid(a) || !valid(b)) return null;

  const distanceKm = haversineKm(a, b);
  // Sanity cap: anything > 50 km is almost certainly a geocode mistake
  // (same-city delivery), suppress rather than send a misleading "120 km"
  // line that would scare the rider off.
  if (distanceKm > 50) return null;

  const driveTimeMin = (distanceKm / URBAN_SPEED_KMH) * 60;
  const etaMinutes = Math.max(1, Math.round(driveTimeMin + LAST_MILE_BUFFER_MINUTES));

  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    etaMinutes,
  };
}

/**
 * Localised one-liner the rider WA template uses, e.g.
 *   "📍 8 km · ~12 min from kitchen"  (en)
 *   "📍 8 km · ~12 min depuis la cuisine"  (fr)
 *   "📍 8 كم · ~12 د من المطبخ"  (ar)
 */
export function formatDeliveryMetricsLine(
  metrics: DeliveryMetrics,
  locale: 'en' | 'fr' | 'ar',
): string {
  const { distanceKm, etaMinutes } = metrics;
  if (locale === 'ar') {
    return `📍 ${distanceKm} كم · ~${etaMinutes} د من المطبخ`;
  }
  if (locale === 'en') {
    return `📍 ${distanceKm} km · ~${etaMinutes} min from kitchen`;
  }
  return `📍 ${distanceKm} km · ~${etaMinutes} min depuis la cuisine`;
}

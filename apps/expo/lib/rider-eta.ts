/**
 * Haversine distance + ETA helpers for the rider map.
 *
 * No external dependencies — pure math. Exported for use in
 * RiderRouteMap and in the rider screen's ETA readout.
 */

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance between two lat/lng points in metres. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Human-readable distance string.
 *   < 1000 m  → "350 m"   (rounded to nearest 10 m)
 *   ≥ 1000 m  → "1.2 km"  (one decimal)
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Estimated time of arrival string.
 *
 * Speeds (straight-line, then add a 1.4x urban road factor):
 *   scooter  25 km/h avg  ≈ 6.944 m/s
 *   car      35 km/h avg  ≈ 9.722 m/s
 *
 * A 90-second parking/handoff fudge is added on top.
 * Result is rounded to the nearest minute; "<1 min" when < 30 s.
 */
export function formatEta(
  meters: number,
  mode: 'scooter' | 'car' = 'scooter',
): string {
  const speedMs = mode === 'car' ? 35 / 3.6 : 25 / 3.6;
  // 1.4x road-distance multiplier over straight-line haversine
  const travelSeconds = (meters * 1.4) / speedMs;
  const totalSeconds = travelSeconds + 90; // parking fudge

  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) return '<1 min';
  return `~${minutes} min`;
}

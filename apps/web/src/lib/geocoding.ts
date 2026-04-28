import 'server-only';

/**
 * Server-side reverse geocoding via OpenStreetMap Nominatim.
 *
 * Why Nominatim and not Google / Mapbox:
 *   - Free, no API key, no billing surprises
 *   - We only call it ONCE per delivery order (at submission time);
 *     the result is cached in tickets.delivery_address.street, so the
 *     Station / customer page never re-fetch
 *   - Volume: a single restaurant's daily delivery count is well under
 *     Nominatim's "absolute max 1 request per second per IP" guideline
 *
 * Quality note: Nominatim is good for cities with full OSM coverage
 * (Algiers, Paris, Lyon, etc.) — typical output is "12 Rue Hassan, El
 * Mouradia, Alger". For rural / under-mapped areas it can fall back to
 * just a town name or "unnamed road". When that happens we keep the
 * coords-with-label fallback so the operator at least sees the pin and
 * can tap "Open in Maps" for the real location.
 *
 * Best practice (per Nominatim's usage policy):
 *   - Identify yourself with a meaningful User-Agent
 *   - Set a short timeout so a slow response doesn't block the order flow
 *   - Don't retry on 429; just use the fallback
 */

export interface ReverseGeocodeResult {
  /** A human-readable single-line street address, e.g. "12 Rue Hassan, Alger". */
  street: string;
  /** City / town extracted from the structured response, when available. */
  city: string | null;
  /** Country, when available. */
  country: string | null;
  /** The raw display_name string from Nominatim, kept for debugging. */
  raw_display_name: string;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'Qflo/1.0 (https://qflo.net; ops@qflo.net)';
const TIMEOUT_MS = 4000;

/**
 * Reverse-geocode a lat/lng to a street address. Returns null on any
 * failure (network, rate-limit, no result) — caller falls back to
 * "Shared location (lat, lng)" or whatever it had before.
 *
 * `acceptLanguage` should match the customer's locale so the response
 * comes back in the right script — French address parts for fr-FR, etc.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  acceptLanguage: string = 'en',
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // zoom=18 gives us street-level detail; addressdetails=1 returns the
  // structured `address` object so we can extract city / country.
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lng.toString());
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': acceptLanguage,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      display_name?: string;
      address?: Record<string, string | undefined>;
    };
    if (!data?.display_name) return null;

    const a = data.address ?? {};
    // Build a compact one-line street: house number + road, fallback to
    // suburb / village if no road is mapped (common in unfamiliar rural
    // pins). Nominatim's full display_name is too long for a chat bubble
    // ("12 Rue Hassan, Hassan, Bach Djerrah, El Mouradia, Alger Centre,
    // Alger, 16000, Algeria") — we keep it for raw_display_name only.
    const houseNumber = a.house_number?.trim() ?? '';
    const road = a.road ?? a.pedestrian ?? a.footway ?? '';
    const neighborhood = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.village ?? a.town ?? '';
    const city = a.city ?? a.town ?? a.village ?? a.county ?? null;

    let street = '';
    if (road) {
      street = houseNumber ? `${houseNumber} ${road}` : road;
      if (neighborhood && neighborhood !== road) street += `, ${neighborhood}`;
    } else if (neighborhood) {
      street = neighborhood;
    } else {
      // No usable structured fields — take the first 2 commas of display_name
      // so we don't echo back an entire postal-style address.
      street = data.display_name.split(',').slice(0, 2).join(',').trim();
    }

    return {
      street: street || data.display_name,
      city: city ?? null,
      country: a.country ?? null,
      raw_display_name: data.display_name,
    };
  } catch (e) {
    // Timeout / network / abort / parse — caller falls back to coords.
    console.warn('[geocoding] reverseGeocode failed', (e as any)?.message);
    return null;
  }
}

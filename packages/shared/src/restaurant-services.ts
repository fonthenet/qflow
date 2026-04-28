/**
 * restaurant-services.ts — Service-type resolution for the restaurant vertical.
 *
 * Single source of truth for the regex patterns that classify a service name
 * (free-text, operator-defined) into one of four canonical types. The same
 * patterns were originally inlined in desk.tsx around the `serviceBadgeEl`
 * block. They have been extracted here so the KDS (Expo, Station, Web) and
 * the notify-ticket edge function can all classify without diverging.
 *
 * Regex coverage:
 *   takeout  — "takeout", "take-out", "take out", "takeaway",
 *              "à emporter", "emporter" (FR)
 *   delivery — "delivery", "deliver", "livraison" (FR), "livrais…" (partial)
 *   dine_in  — "dine-in", "dine in", "dinein", "sur place", "surplace" (FR)
 *   other    — everything else (queue-type services, etc.)
 *
 * Keep the patterns in sync with the copy comment in
 * supabase/functions/notify-ticket/index.ts if this file is ever modified.
 */

export type RestaurantServiceType = 'takeout' | 'delivery' | 'dine_in' | 'other';

const TAKEOUT_RE  = /take.?out|à emporter|emporter|takeaway/i;
const DELIVERY_RE = /deliver|livrais/i;
const DINE_IN_RE  = /dine.?in|sur place|surplace/i;

/**
 * Classify a service name into a canonical restaurant service type.
 *
 * Rules (in priority order):
 *   1. takeout  — matched first (e.g. "Takeout sur place" → takeout)
 *   2. delivery — second
 *   3. dine_in  — third
 *   4. other    — fallback for null / empty / unrecognised names
 *
 * The input is lower-cased internally; callers do not need to normalise it.
 */
export function resolveRestaurantServiceType(
  serviceName: string | null | undefined,
): RestaurantServiceType {
  if (!serviceName) return 'other';
  const lower = serviceName.toLowerCase();
  if (TAKEOUT_RE.test(lower))  return 'takeout';
  if (DELIVERY_RE.test(lower)) return 'delivery';
  if (DINE_IN_RE.test(lower))  return 'dine_in';
  return 'other';
}

/**
 * Visual configuration for each service type.
 *
 * `color`    — hex literal; matches the values used in desk.tsx exactly.
 *              dine_in uses the success green token; we pin it to the hex
 *              value that the Expo theme resolves for `colors.success` so
 *              non-Expo consumers (web, Station) get consistent output.
 * `icon`     — Ionicons glyph name (used by Expo + Station vanilla JS as a
 *              text label; web KDS renders the emoji equivalent instead).
 * `labelKey` — i18n key under the `service.*` namespace that every locale
 *              file must carry.
 *
 * Hide the pill when type is 'other' or 'dine_in' (dine-in is the default
 * and the table label already signals it; 'other' has no meaningful icon).
 */
export const RESTAURANT_SERVICE_VISUALS: Record<
  RestaurantServiceType,
  { color: string; icon: string; labelKey: string }
> = {
  takeout:  { color: '#f59e0b', icon: 'bag-handle',  labelKey: 'service.takeout'  },
  delivery: { color: '#8b5cf6', icon: 'bicycle',     labelKey: 'service.delivery' },
  dine_in:  { color: '#22c55e', icon: 'restaurant',  labelKey: 'service.dineIn'   },
  other:    { color: '#64748b', icon: 'apps-outline', labelKey: 'service.other'   },
};

/**
 * Returns true when the service type should show a pill on KDS cards.
 * Dine-in is the default (table label is its signal); 'other' has no
 * meaningful icon. Only takeout + delivery need explicit KDS signalling.
 */
export function shouldShowServicePill(type: RestaurantServiceType): boolean {
  return type === 'takeout' || type === 'delivery';
}

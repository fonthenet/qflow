// ── Delivery feature gate ──────────────────────────────────────────
/**
 * Whether the org's delivery feature surface (in-house riders,
 * "out for delivery" rail, rider mobile app, /api/orders/assign WA
 * flow, etc.) should be visible.
 *
 * Source of truth is `organizations.delivery_enabled` (boolean
 * column). Restaurant + cafe verticals are pre-flipped to true via
 * migration 20260501270000 — every other vertical stays off until
 * an operator opts in via the admin toggle.
 *
 * Pass either the org row directly, or `{ delivery_enabled }` from
 * a settings/context object — both shapes are accepted for the
 * common cases where callers have only a partial org reference.
 */
export function isDeliveryEnabled(
  org: { delivery_enabled?: boolean | null } | null | undefined,
): boolean {
  return Boolean(org?.delivery_enabled);
}

/**
 * Verticals that get delivery_enabled=true on creation. Used by the
 * onboarding pipeline so a new restaurant doesn't have to manually
 * toggle it on. Other verticals can still flip it on later via the
 * admin UI.
 *
 * Mirrors the migration backfill list — keep in sync if it changes.
 */
export const DEFAULT_DELIVERY_VERTICALS: ReadonlySet<string> = new Set([
  'restaurant',
  'cafe',
]);

/**
 * Returns true if a freshly-created org of this vertical should have
 * delivery enabled by default. Onboarding code reads this to set the
 * column on insert without a follow-up update.
 */
export function shouldDefaultDeliveryEnabled(
  vertical: string | null | undefined,
): boolean {
  if (!vertical) return false;
  return DEFAULT_DELIVERY_VERTICALS.has(vertical);
}

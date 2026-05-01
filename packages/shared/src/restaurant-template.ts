/**
 * Universal restaurant template — the canonical setup every new
 * restaurant / cafe gets on signup.
 *
 * One template covers all four restaurant flows:
 *   - Dine-in (with table seating; can be disabled via tables toggle)
 *   - Takeout (counter pickup)
 *   - Delivery (in-house riders + WhatsApp ACCEPT/DONE flow)
 *   - Walk-ins (operator types orders into Station's Order Pad)
 *   - Online orders (WhatsApp + web menu, both go through pending_approval)
 *
 * The seeding logic lives in /api/onboarding/create-business — when
 * category === 'restaurant' (or 'cafe'), it overrides the single-service
 * default with the trio defined here AND stamps the restaurant settings
 * onto organizations.settings so /api/moderate-ticket, /api/orders/*,
 * QueueOrderCard, and the rider system all agree on the contract.
 *
 * Tables can be toggled off later (settings.restaurant_tables_enabled =
 * false): the dine-in service flips inactive, the kiosk hides it, but
 * takeout + delivery keep working — useful for ghost kitchens / cloud
 * restaurants that don't have a dining room.
 */

import type { LocalizedText } from './setup-wizard/categories';

export interface RestaurantSeedService {
  /** Canonical type used by resolveRestaurantServiceType — keeps the
   *  WhatsApp-ordering, kitchen-prep, and rider flows in sync. */
  type: 'dine_in' | 'takeout' | 'delivery';
  /** Three-letter code prefix shown on tickets (e.g. DIN-0001). */
  code: string;
  /** Localized customer-facing name. The names are matched against
   *  TAKEOUT_RE / DELIVERY_RE / DINE_IN_RE so all three locales must
   *  contain the trigger word ("takeout/à emporter", "delivery/livraison",
   *  "dine-in/sur place"). Don't change these without updating the
   *  classifier regexes in restaurant-services.ts. */
  name: LocalizedText;
  /** Operator-facing short label for kiosk pills. Same pill is rendered
   *  on Station, web menu, and the customer tracking page. */
  estimatedMinutes: number;
  /** Whether this service is part of the toggleable "tables" feature.
   *  Only dine-in flips off when restaurant_tables_enabled = false. */
  controlledByTablesToggle: boolean;
}

/**
 * Three services every new restaurant gets seeded with. Order matters
 * for the kiosk: dine-in shows first because that's the default
 * walk-in experience; takeout second; delivery last.
 */
export const RESTAURANT_DEFAULT_SERVICES: ReadonlyArray<RestaurantSeedService> = [
  {
    type: 'dine_in',
    code: 'DIN',
    name: { en: 'Dine-in', fr: 'Sur place', ar: 'تناول في المطعم' },
    estimatedMinutes: 45,
    controlledByTablesToggle: true,
  },
  {
    type: 'takeout',
    code: 'TKO',
    name: { en: 'Takeout', fr: 'À emporter', ar: 'طلب خارجي' },
    estimatedMinutes: 20,
    controlledByTablesToggle: false,
  },
  {
    type: 'delivery',
    code: 'DLV',
    name: { en: 'Delivery', fr: 'Livraison', ar: 'توصيل' },
    estimatedMinutes: 35,
    controlledByTablesToggle: false,
  },
];

/**
 * Restaurant-specific keys we stamp onto organizations.settings during
 * onboarding. Other apps (Station, web menu, rider system) read these
 * to decide which flows to enable.
 *
 * Why stamp at signup: relying on the absence of a key is fragile —
 * makes the order/cancel/dispatch handlers branch on `?? defaults`
 * everywhere. A single source of truth on org.settings keeps the
 * logic boring and explicit.
 */
export interface RestaurantSettings {
  /** Master switch for the dine-in flow. When false, Station hides
   *  table-seating UI and the dine-in service goes is_active=false.
   *  Takeout + delivery continue to work. Default true. */
  restaurant_tables_enabled: boolean;
  /** Online orders (WhatsApp/web) created as pending_approval so the
   *  operator confirms each one before the kitchen starts. We always
   *  set this true for restaurants — false would let bots flood the
   *  kitchen with unscreened orders. */
  require_ticket_approval: boolean;
  /** Allow customer-side CANCEL while the order is still in
   *  pending_approval / waiting / called. Once approved (status='serving')
   *  cancellation is blocked server-side — see messaging-commands.ts
   *  cannot_cancel_serving. */
  allow_cancellation: boolean;
  /** Optional: business contact phone, surfaced in the
   *  cannot_cancel_serving message ("📞 +213…"). Operator sets this
   *  later in Business Admin if not collected at signup. */
  business_phone?: string;
}

/**
 * Defaults stamped onto organizations.settings for every new restaurant.
 * Existing keys (collected at signup, e.g. business_category, country,
 * timezone, locale_primary) are merged in by the caller — this is just
 * the restaurant-specific overlay.
 */
export const RESTAURANT_DEFAULT_SETTINGS: RestaurantSettings = {
  restaurant_tables_enabled: true,
  require_ticket_approval: true,
  allow_cancellation: true,
};

/**
 * True when the org should run the restaurant flow. Used by Station,
 * Order Pad, and the WA dispatcher to gate restaurant-specific UI.
 *
 * We accept both 'restaurant' and 'cafe' categories — they share the
 * same workflow (kitchen prep, ticket lifecycle, rider option). Future
 * food categories (bakery, food-truck, ghost-kitchen) would also flow
 * here once added to the categories spec.
 */
export function isRestaurantCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const c = category.toLowerCase().trim();
  return c === 'restaurant' || c === 'cafe' || c === 'café' || c === 'coffee';
}

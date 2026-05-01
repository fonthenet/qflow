/**
 * Universal salon / barber template — the canonical setup every new
 * beauty / spa / barber business gets on signup.
 *
 * One template covers the full range:
 *   - Walk-in queue (chairs / barber stations)
 *   - Appointments with a specific stylist of the customer's choice
 *   - Hybrid mode (book ahead OR walk in)
 *   - Multi-stylist / multi-chair shops
 *   - Per-customer regular-stylist memory (rebook same person)
 *
 * The seeding logic lives in /api/onboarding/create-business — when
 * isSalonCategory(category) is true it overrides the single-service
 * default with the trio defined here AND stamps salon settings on
 * organizations.settings.
 *
 * Stylist↔service matrix (which stylist can do which service) lives
 * on a `staff_services` join table — see the migration in
 * supabase/migrations/20260501_*. Without rows for a given stylist,
 * UI assumes they can do EVERY service (sensible default for a
 * single-chair shop). Operators add rows as they hire specialists.
 */

import type { LocalizedText } from './setup-wizard/categories';

export interface SalonSeedService {
  /** Canonical type — drives kiosk grouping ("Hair", "Skin", "Combo")
   *  and analytics roll-ups. Stylists rename freely, but the type tag
   *  keeps the dashboard consistent across operators. */
  type: 'haircut' | 'beard' | 'color' | 'styling' | 'combo' | 'other';
  /** Three-letter prefix for ticket numbers (CUT-0001). */
  code: string;
  /** Localized customer-facing name (FR/AR/EN). */
  name: LocalizedText;
  estimatedMinutes: number;
  /** Whether this service is gated by the seasonal / off-day toggle.
   *  Color services are often disabled when the salon's colorist is
   *  on holiday — so we tag them. Single-flag for now; the toggle UI
   *  is a follow-up. */
  controlledByExpertiseToggle: boolean;
}

/**
 * Five default services every new salon / barber gets seeded with.
 * Order is the kiosk display order — the most common walk-in service
 * (Haircut) appears first; Color last because it's the biggest time
 * sink and you want the kiosk biased toward fast services.
 */
export const SALON_DEFAULT_SERVICES: ReadonlyArray<SalonSeedService> = [
  {
    type: 'haircut',
    code: 'CUT',
    name: { en: 'Haircut', fr: 'Coupe', ar: 'قص الشعر' },
    estimatedMinutes: 30,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'beard',
    code: 'BRD',
    name: { en: 'Beard / Shave', fr: 'Barbe / Rasage', ar: 'حلاقة اللحية' },
    estimatedMinutes: 20,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'combo',
    code: 'CMB',
    name: { en: 'Cut + Beard', fr: 'Coupe + Barbe', ar: 'قص + حلاقة' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'styling',
    code: 'STY',
    name: { en: 'Styling / Blowout', fr: 'Coiffage / Brushing', ar: 'تصفيف الشعر' },
    estimatedMinutes: 40,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'color',
    code: 'COL',
    name: { en: 'Color / Treatment', fr: 'Coloration / Soin', ar: 'صبغ / علاج' },
    estimatedMinutes: 90,
    controlledByExpertiseToggle: true,
  },
];

/**
 * Salon-specific keys we stamp onto organizations.settings during
 * onboarding. Mirror of RESTAURANT_DEFAULT_SETTINGS shape.
 */
export interface SalonSettings {
  /** Master switch for the chairs feature. When false, the booking flow
   *  hides chair-by-chair UI and treats the whole salon as one resource
   *  pool. Useful for tiny shops with one operator. Default true. */
  salon_chairs_enabled: boolean;
  /** Whether the customer can pick a specific stylist when booking
   *  (vs. "next available"). Default true — most MENA salons sell on
   *  the stylist relationship, so customer choice is the headline
   *  feature. Operators of mass-market chains can flip this off. */
  salon_stylist_choice_enabled: boolean;
  /** Walk-ins allowed alongside appointments. Default true — Algerian
   *  shops are walk-in dominant. Operators of high-end appointment-
   *  only salons can flip off. */
  salon_walk_ins_enabled: boolean;
  /** Appointments require operator approval before they're confirmed.
   *  ON by default — we don't want spam bookings filling a stylist's
   *  day. The same gate the restaurant template uses for orders. */
  require_appointment_approval: boolean;
  /** Customer-side cancellation allowed (during pending / confirmed).
   *  Already enforced server-side: 'serving' status blocks cancels. */
  allow_cancellation: boolean;
  /** Optional: business contact phone for the cannot_cancel_serving
   *  message ("📞 +213…"). Operator sets later in Business Admin
   *  if not collected at signup. */
  business_phone?: string;
}

/**
 * Defaults stamped onto organizations.settings for every new salon.
 * Other keys (business_category, country, timezone, locale_primary)
 * are merged in by the caller — this is just the salon overlay.
 */
export const SALON_DEFAULT_SETTINGS: SalonSettings = {
  salon_chairs_enabled: true,
  salon_stylist_choice_enabled: true,
  salon_walk_ins_enabled: true,
  require_appointment_approval: true,
  allow_cancellation: true,
};

/**
 * True when the org should run the salon flow. Matches the
 * `beauty` BusinessCategory value plus the looser legacy strings
 * ('salon', 'barber', 'spa') for forward / backward compatibility.
 */
export function isSalonCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const c = category.toLowerCase().trim();
  return c === 'beauty'
    || c === 'salon'
    || c === 'barber'
    || c === 'barbershop'
    || c === 'spa';
}

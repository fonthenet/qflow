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
 * Sub-type-specific service templates. Earlier we shipped one
 * universal SALON_DEFAULT_SERVICES that was barber-leaning — wrong
 * for nail salons (no nail services) and spas (no massage). Now each
 * personal-care category gets its own set, picked at onboarding via
 * getSalonTemplateForCategory().
 */

/**
 * Barbershop services — calibrated for Algerian shop menus. The order
 * mirrors how a wall menu is typically arranged (simple cuts first,
 * specialty services lower) so the kiosk reads naturally. Operators
 * delete what they don't offer.
 */
export const BARBERSHOP_SERVICES: ReadonlyArray<SalonSeedService> = [
  {
    type: 'haircut', code: 'CUT',
    name: { en: 'Simple Haircut', fr: 'Coupe Simple', ar: 'حلاقة عادية' },
    estimatedMinutes: 25,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'haircut', code: 'FAD',
    name: { en: 'Fade', fr: 'Dégradé', ar: 'تدريج' },
    estimatedMinutes: 35,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'beard', code: 'BRD',
    name: { en: 'Beard Trim', fr: 'Taille de Barbe', ar: 'تشذيب اللحية' },
    estimatedMinutes: 15,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'beard', code: 'SHV',
    name: { en: 'Razor Shave', fr: 'Rasage Traditionnel', ar: 'حلاقة بالموس' },
    estimatedMinutes: 25,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'combo', code: 'CMB',
    name: { en: 'Cut + Beard', fr: 'Coupe + Barbe', ar: 'قص + حلاقة' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'haircut', code: 'KID',
    name: { en: 'Kids Cut', fr: 'Coupe Enfant', ar: 'قص للأطفال' },
    estimatedMinutes: 20,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'EYE',
    name: { en: 'Eyebrows', fr: 'Sourcils', ar: 'الحواجب' },
    estimatedMinutes: 10,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'styling', code: 'WSH',
    name: { en: 'Hair Wash', fr: 'Lavage Cheveux', ar: 'غسيل الشعر' },
    estimatedMinutes: 15,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'color', code: 'COL',
    name: { en: "Men's Color", fr: 'Coloration Homme', ar: 'صبغة شعر رجالية' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: true,
  },
];

/**
 * Hair Salon (women's) — comprehensive Algerian shop menu. Includes
 * lissage brésilien, mise en plis, coiffure mariée — the staples
 * every neighborhood salon advertises.
 */
export const HAIR_SALON_SERVICES: ReadonlyArray<SalonSeedService> = [
  {
    type: 'haircut', code: 'CUT',
    name: { en: 'Cut & Style', fr: 'Coupe & Coiffage', ar: 'قص وتصفيف' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'styling', code: 'BLW',
    name: { en: 'Blowout', fr: 'Brushing', ar: 'سيشوار' },
    estimatedMinutes: 40,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'styling', code: 'MEP',
    name: { en: 'Set & Style', fr: 'Mise en Plis', ar: 'تصفيف' },
    estimatedMinutes: 50,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'color', code: 'COL',
    name: { en: 'Color', fr: 'Coloration', ar: 'صبغ الشعر' },
    estimatedMinutes: 120,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'color', code: 'HLT',
    name: { en: 'Highlights / Balayage', fr: 'Mèches / Balayage', ar: 'هاي لايت / باليياج' },
    estimatedMinutes: 150,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'color', code: 'DEC',
    name: { en: 'Bleach', fr: 'Décoloration', ar: 'صبغة فاتحة' },
    estimatedMinutes: 120,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'styling', code: 'LIS',
    name: { en: 'Brazilian Smoothing', fr: 'Lissage Brésilien', ar: 'فرد برازيلي' },
    estimatedMinutes: 180,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'styling', code: 'PER',
    name: { en: 'Perm', fr: 'Permanente', ar: 'تجعيد دائم' },
    estimatedMinutes: 150,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'BRD',
    name: { en: 'Bridal Hairstyle', fr: 'Coiffure Mariée', ar: 'تسريحة عروس' },
    estimatedMinutes: 90,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'styling', code: 'TRT',
    name: { en: 'Deep Treatment', fr: 'Soin Capillaire', ar: 'علاج الشعر' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'color', code: 'HEN',
    name: { en: 'Henna', fr: 'Henné Cheveux', ar: 'حناء الشعر' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'styling', code: 'WSH',
    name: { en: 'Wash & Brushing', fr: 'Shampoing + Brushing', ar: 'غسيل وسيشوار' },
    estimatedMinutes: 35,
    controlledByExpertiseToggle: false,
  },
];

/**
 * Nail Salon — Algerian shop menu. Vernis semi-permanent + pose de
 * gel are dominant; nail art and French manucure are upsells.
 */
export const NAIL_SALON_SERVICES: ReadonlyArray<SalonSeedService> = [
  {
    type: 'other', code: 'MAN',
    name: { en: 'Manicure', fr: 'Manucure Simple', ar: 'مانيكير' },
    estimatedMinutes: 30,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'PED',
    name: { en: 'Pedicure', fr: 'Pédicure', ar: 'باديكير' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'combo', code: 'MPC',
    name: { en: 'Mani + Pedi', fr: 'Mani + Pédi', ar: 'مانيكير + باديكير' },
    estimatedMinutes: 75,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'VSP',
    name: { en: 'Semi-Permanent Polish', fr: 'Vernis Semi-Permanent', ar: 'طلاء شبه دائم' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'GEL',
    name: { en: 'Gel Extensions', fr: 'Pose de Gel', ar: 'تركيب جل' },
    estimatedMinutes: 75,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'ACR',
    name: { en: 'Acrylic Extensions', fr: 'Pose Acrylique', ar: 'تركيب أكريليك' },
    estimatedMinutes: 90,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'FRC',
    name: { en: 'French Manicure', fr: 'French Manucure', ar: 'مانيكير فرنسي' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'ART',
    name: { en: 'Nail Art', fr: 'Nail Art', ar: 'فن الأظافر' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'REM',
    name: { en: 'Removal / Soak Off', fr: 'Dépose', ar: 'إزالة الجل' },
    estimatedMinutes: 25,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'RPR',
    name: { en: 'Repair / Fill', fr: 'Renforcement / Remplissage', ar: 'إصلاح / تعبئة' },
    estimatedMinutes: 30,
    controlledByExpertiseToggle: false,
  },
];

/**
 * Spa & Wellness — Algerian shop menu. Hammam is the anchor service;
 * gommage and épilation are universally offered. Henné corps shows
 * up on most spa menus too.
 */
export const SPA_SERVICES: ReadonlyArray<SalonSeedService> = [
  {
    type: 'other', code: 'HMM',
    name: { en: 'Hammam', fr: 'Hammam', ar: 'حمام' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'GOM',
    name: { en: 'Body Scrub', fr: 'Gommage Corps', ar: 'تقشير الجسم' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'MSG',
    name: { en: 'Relaxing Massage', fr: 'Massage Relaxant', ar: 'مساج للاسترخاء' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'MTH',
    name: { en: 'Therapeutic Massage', fr: 'Massage Thérapeutique', ar: 'مساج علاجي' },
    estimatedMinutes: 75,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'FCL',
    name: { en: 'Facial Treatment', fr: 'Soin du Visage', ar: 'تنظيف بشرة' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'EPL',
    name: { en: 'Waxing / Hair Removal', fr: 'Épilation', ar: 'إزالة الشعر' },
    estimatedMinutes: 45,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'SUR',
    name: { en: 'Eyebrow Shaping', fr: 'Sourcils', ar: 'تنظيف الحواجب' },
    estimatedMinutes: 15,
    controlledByExpertiseToggle: false,
  },
  {
    type: 'other', code: 'HEN',
    name: { en: 'Body Henna', fr: 'Henné Corps', ar: 'حناء الجسم' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'other', code: 'ARO',
    name: { en: 'Aromatherapy', fr: 'Aromathérapie', ar: 'علاج بالروائح' },
    estimatedMinutes: 60,
    controlledByExpertiseToggle: true,
  },
  {
    type: 'combo', code: 'PKG',
    name: { en: 'Wellness Package', fr: 'Forfait Bien-être', ar: 'باقة العافية' },
    estimatedMinutes: 150,
    controlledByExpertiseToggle: true,
  },
];

/**
 * Mixed beauty — when the operator picks the legacy 'beauty' catch-all
 * we seed a representative slice from each sub-type so they have
 * options to start with. They'll prune what doesn't apply.
 */
export const SALON_DEFAULT_SERVICES: ReadonlyArray<SalonSeedService> = [
  BARBERSHOP_SERVICES[0],   // Haircut
  HAIR_SALON_SERVICES[2],   // Color
  NAIL_SALON_SERVICES[2],   // Mani + Pedi
  SPA_SERVICES[0],          // Massage
  SPA_SERVICES[1],          // Facial
];

/**
 * Pick the right service template for an onboarding category. Returns
 * the mixed default when the category isn't a personal-care one (so
 * non-salon callers get the safe fallback, not undefined).
 */
export function getSalonTemplateForCategory(
  category: string | null | undefined,
): ReadonlyArray<SalonSeedService> {
  const c = (category ?? '').toLowerCase().trim();
  if (c === 'barbershop' || c === 'barber') return BARBERSHOP_SERVICES;
  if (c === 'hair_salon' || c === 'salon') return HAIR_SALON_SERVICES;
  if (c === 'nail_salon' || c === 'nails') return NAIL_SALON_SERVICES;
  if (c === 'spa') return SPA_SERVICES;
  return SALON_DEFAULT_SERVICES;
}

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
  return c === 'beauty'        // legacy catch-all
    || c === 'salon'           // legacy / DB slug
    || c === 'barber'          // DB slug
    || c === 'barbershop'      // V2 specific
    || c === 'hair_salon'      // V2 specific
    || c === 'nail_salon'      // V2 specific
    || c === 'nails'           // alias
    || c === 'spa';            // legacy + V2 specific
}

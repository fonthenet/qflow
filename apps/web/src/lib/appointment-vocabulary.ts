/**
 * Category-aware vocabulary for "appointment"-style customer messages.
 *
 * Default copy (rendez-vous / appointment / موعد) reads weird for a
 * restaurant — customers there expect "reservation" / "réservation" /
 * "حجز", and the post-arrival text ("a ticket will be issued") makes
 * no sense when they're sitting down for dinner. This helper resolves
 * the right vocabulary at render time so the WhatsApp templates,
 * tracking page, and admin UI can all share one source of truth.
 *
 * Returns a tuple of substitutions every template needs:
 *   - noun           — the booking-noun ("appointment" / "reservation")
 *   - service_emoji  — emoji prefix for the service line (was 🏥 by default)
 *   - arrival_line   — full sentence about what happens on arrival
 *   - cancel_cmd     — the CANCEL keyword shown to the customer
 *
 * Categories are normalised to a small set: 'restaurant', 'cafe',
 * 'salon' / 'barber' / 'spa' (personal care), and 'default' (everything
 * else — clinics, gov, gyms, banks, professional services, etc.). The
 * normalisation is intentionally lenient so a typo like "resto" or
 * "Café" still routes to the right copy.
 */

// Accepts any locale string but only varies copy on the three the
// templates are translated into; everything else falls back to English.
type SupportedLocale = 'ar' | 'fr' | 'en';

function narrow(locale: string): SupportedLocale {
  return locale === 'ar' || locale === 'fr' ? locale : 'en';
}

export interface ApptVocab {
  noun: string;          // "reservation" / "appointment" / etc.
  service_emoji: string; // 🍽️ / 💈 / 📋
  arrival_line: string;  // sentence shown after time / service block
  cancel_cmd: string;    // "CANCEL RESERVATION" / "CANCEL BOOKING" / "إلغاء الحجز"
}

function normalizeCategory(raw: string | null | undefined): 'restaurant' | 'salon' | 'default' {
  if (!raw) return 'default';
  const k = raw.toLowerCase().trim();
  if (k.includes('restaurant') || k.includes('resto') || k.includes('café') || k.includes('cafe')
      || k.includes('food') || k.includes('eatery') || k.includes('bistro')) {
    return 'restaurant';
  }
  if (k.includes('salon') || k.includes('barber') || k.includes('spa') || k.includes('beauty')
      || k.includes('hair') || k.includes('nails') || k.includes('coiffure')) {
    return 'salon';
  }
  return 'default';
}

export function getApptVocab(
  category: string | null | undefined,
  locale: string,
  /**
   * Restaurant tickets split into three sub-flows that expect different
   * customer-facing nouns:
   *   - dine_in           → "reservation" (booking a table)
   *   - takeout / delivery → "order"      (food being prepared, no table)
   *
   * Pass the resolved service type so the approval / declined / cancelled
   * templates render the right noun. Without this, takeout & delivery
   * orders read "Your reservation has been approved" — confusing because
   * nothing was reserved. Default (undefined / null) → reservation copy
   * to keep dine-in behaviour unchanged.
   */
  serviceTypeHint?: 'dine_in' | 'takeout' | 'delivery' | null,
): ApptVocab {
  const c = normalizeCategory(category);
  const L = narrow(locale);

  // Restaurant + takeout / delivery → ORDER vocabulary
  if (c === 'restaurant' && (serviceTypeHint === 'takeout' || serviceTypeHint === 'delivery')) {
    const isDeliv = serviceTypeHint === 'delivery';
    return {
      noun: L === 'ar' ? 'طلب' : L === 'en' ? 'order' : 'commande',
      service_emoji: isDeliv ? '🛵' : '🥡',
      // After approval the customer wants to know what happens next —
      // delivery: driver leaves shortly; takeout: ready-for-pickup ping.
      arrival_line: isDeliv
        ? (L === 'ar'
            ? '🛵 سنُعلمك عند مغادرة السائق.'
            : L === 'en'
              ? "🛵 We'll notify you when the driver leaves."
              : '🛵 Nous vous préviendrons au départ du livreur.')
        : (L === 'ar'
            ? '🥡 سنُعلمك عندما يصبح طلبك جاهزًا للاستلام.'
            : L === 'en'
              ? "🥡 We'll notify you when your order is ready for pickup."
              : '🥡 Nous vous préviendrons quand votre commande sera prête à emporter.'),
      cancel_cmd: L === 'ar' ? 'إلغاء الطلب' : L === 'en' ? 'CANCEL ORDER' : 'ANNULER COMMANDE',
    };
  }

  if (c === 'restaurant') {
    return {
      noun: L === 'ar' ? 'حجز' : L === 'en' ? 'reservation' : 'réservation',
      service_emoji: '🍽️',
      arrival_line: L === "ar"
        ? '🍽️ ستكون طاولتك جاهزة عند وصولك.'
        : L === "en"
          ? "🍽️ Your table will be ready when you arrive."
          : '🍽️ Votre table sera prête à votre arrivée.',
      cancel_cmd: L === "ar" ? 'إلغاء الحجز' : L === "en" ? 'CANCEL RESERVATION' : 'ANNULER RÉSERVATION',
    };
  }

  if (c === 'salon') {
    return {
      noun: L === "ar" ? 'موعد' : L === "en" ? 'appointment' : 'rendez-vous',
      service_emoji: '💈',
      arrival_line: L === "ar"
        ? '✂️ سنستقبلك عند وصولك.'
        : L === "en"
          ? "✂️ We'll be ready for you when you arrive."
          : '✂️ Nous vous accueillerons à votre arrivée.',
      cancel_cmd: L === "ar" ? 'إلغاء موعد' : L === "en" ? 'CANCEL APPOINTMENT' : 'ANNULER RDV',
    };
  }

  // Default: clinic / gov / professional services / etc.
  return {
    noun: L === "ar" ? 'موعد' : L === "en" ? 'appointment' : 'rendez-vous',
    service_emoji: '📋',
    arrival_line: L === "ar"
      ? '🎫 ستستلم تذكرتك عند وصولك إلى المكان.'
      : L === "en"
        ? '🎫 A ticket will be issued when you check in at the location.'
        : '🎫 Un ticket vous sera remis à votre arrivée sur place.',
    cancel_cmd: L === "ar" ? 'إلغاء موعد' : L === "en" ? 'CANCEL BOOKING' : 'ANNULER RDV',
  };
}

/**
 * Convenience that flattens the vocab into a `Record<string, string>`
 * suitable for handing straight to the t() substitution function.
 */
export function getApptVocabVars(
  category: string | null | undefined,
  locale: string,
  serviceTypeHint?: 'dine_in' | 'takeout' | 'delivery' | null,
): Record<string, string> {
  const v = getApptVocab(category, locale, serviceTypeHint);
  return {
    appt: v.noun,
    appt_capital: v.noun.charAt(0).toUpperCase() + v.noun.slice(1),
    service_emoji: v.service_emoji,
    arrival_line: v.arrival_line,
    cancel_cmd: v.cancel_cmd,
  };
}

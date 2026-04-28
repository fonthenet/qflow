/**
 * Shared types & helpers for the WhatsApp/web restaurant ordering flow.
 *
 * The same DTOs are consumed by:
 *   - `apps/web/src/app/(public)/m/[officeSlug]` → public ordering page
 *   - `apps/web/src/app/api/orders/place` → server handler that creates the
 *     pending_approval ticket
 *   - `apps/desktop` Station UI → operator accept/decline panel
 *   - `apps/web/src/app/api/whatsapp-webhook` → reply with menu link
 *
 * Keeping DTOs and decline-reason labels here is what prevents drift between
 * what the customer sees, what the server validates, and what the operator
 * picks from a dropdown.
 */

import type { LocalizedText, CategoryLocale } from './setup-wizard/categories';

// ── Order channel & service ─────────────────────────────────────────

/** Where the order originated. Operator UI shows a pill per channel. */
export type OrderChannel = 'whatsapp' | 'web' | 'kiosk' | 'in_person';

/** Restaurant service modes. Dine-in goes through the booking path; only
 *  takeout and delivery flow through the ordering page. */
export type OrderServiceMode = 'takeout' | 'delivery';

// ── Cart shape ───────────────────────────────────────────────────────

export interface CartItem {
  /** Server-side menu_item id (UUID). */
  menu_item_id: string;
  /** Snapshot of the item name at order time (so renaming doesn't rewrite history). */
  name: string;
  /** Snapshot of the unit price. NULL items can't be ordered (validated server-side). */
  unit_price: number;
  /** Quantity. Server enforces 1..99. */
  qty: number;
  /** Optional per-line note (e.g. "no ice"). */
  note?: string | null;
}

export interface DeliveryAddress {
  /** Free-form street + number. Required. */
  street: string;
  /** Optional city / commune. */
  city?: string | null;
  /** Driver-facing instructions ("ring twice", floor, building name). */
  instructions?: string | null;
  /** Map coords if geocoded. Optional — many small shops don't geocode. */
  lat?: number | null;
  lng?: number | null;
  /** Original raw input, kept for debugging if structured fields are wrong. */
  raw?: string | null;
}

export interface PlaceOrderRequest {
  office_slug: string;
  service: OrderServiceMode;
  channel: OrderChannel;
  /** ISO-639-1 locale used by the customer; drives WA template language. */
  locale: CategoryLocale;
  customer: {
    name: string;
    phone: string;
    /** Optional — operator may already have this from the WA conversation. */
    notes?: string | null;
  };
  items: CartItem[];
  /** Required for delivery, must be omitted/null for takeout. */
  delivery_address?: DeliveryAddress | null;
}

export interface PlaceOrderResponse {
  ok: true;
  ticket_id: string;
  ticket_number: string;
  qr_token: string;
  /** "https://qflo.net/q/<token>" — sent in the WA confirmation. */
  track_url: string;
  /** Total amount; matches customer's view. Always 2 decimals worth (DZ). */
  total: number;
  /** Currency symbol/code resolved server-side (e.g. "DA"). */
  currency: string;
  /** Estimated minutes until ready, computed from prep times. */
  eta_minutes: number;
}

// ── ETA computation ──────────────────────────────────────────────────

/**
 * ETA model: kitchen items prep in parallel, so the bottleneck item wins.
 * If the kitchen already has a backlog of N active orders, we add a small
 * queue padding so the operator's quoted time doesn't undershoot reality.
 *
 * Items with no prep_time_minutes (drinks, pre-made desserts) contribute 0.
 *
 * @param prepTimes  per-item prep_time_minutes (null/undefined = 0)
 * @param activeOrdersInKitchen  count of currently `serving` tickets
 * @returns minutes; floor 5, ceiling 90, rounded to nearest 5
 */
export function computeOrderEtaMinutes(
  prepTimes: ReadonlyArray<number | null | undefined>,
  activeOrdersInKitchen: number = 0,
): number {
  const sane = prepTimes
    .map((p) => (typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : 0));
  const longestItem = sane.reduce((m, n) => (n > m ? n : m), 0);
  // Queue padding: +5 min per 3-order tranche of active backlog (caps at +20).
  const padding = Math.min(20, Math.floor(activeOrdersInKitchen / 3) * 5);
  const raw = longestItem + padding;
  // Snap to 5-min increments — cleaner customer-facing copy ("ready in ~25 min")
  // and matches the operator's Accept-modal +/- 5 buttons.
  const snapped = Math.max(5, Math.round(raw / 5) * 5);
  return Math.min(90, snapped);
}

// ── Decline reasons (operator picks one when rejecting) ──────────────

export type OrderDeclineReason =
  | 'closed'
  | 'too_busy'
  | 'item_unavailable'
  | 'outside_delivery_zone'
  | 'invalid_address'
  | 'duplicate'
  | 'other';

interface DeclineReasonSpec {
  key: OrderDeclineReason;
  /** Operator-facing label in the Decline picker. */
  label: LocalizedText;
  /** Customer-facing message body sent over WhatsApp on decline. */
  customer_message: LocalizedText;
  /** Whether a free-text note is required (e.g. for 'other'). */
  requires_note?: boolean;
}

export const ORDER_DECLINE_REASONS: ReadonlyArray<DeclineReasonSpec> = [
  {
    key: 'closed',
    label: { en: 'We are closed', fr: 'Nous sommes fermés', ar: 'نحن مغلقون' },
    customer_message: {
      en: 'Sorry — we are closed right now and cannot take this order.',
      fr: "Désolé — nous sommes actuellement fermés et ne pouvons pas prendre cette commande.",
      ar: 'عذرًا — نحن مغلقون حاليًا ولا يمكننا قبول هذا الطلب.',
    },
  },
  {
    key: 'too_busy',
    label: { en: 'Kitchen overloaded', fr: 'Cuisine saturée', ar: 'المطبخ مزدحم' },
    customer_message: {
      en: 'Sorry — the kitchen is overloaded right now. Please try again in a bit.',
      fr: "Désolé — la cuisine est saturée pour le moment. Réessayez dans un moment, s'il vous plaît.",
      ar: 'عذرًا — المطبخ مزدحم الآن. يرجى المحاولة بعد قليل.',
    },
  },
  {
    key: 'item_unavailable',
    label: { en: 'An item is out of stock', fr: 'Un article est en rupture', ar: 'منتج غير متوفر' },
    customer_message: {
      en: "Sorry — one of the items you ordered is out of stock. Please pick something else.",
      fr: "Désolé — l'un des articles commandés est en rupture. Veuillez choisir autre chose.",
      ar: 'عذرًا — أحد المنتجات في طلبك غير متوفر. يرجى اختيار بديل.',
    },
  },
  {
    key: 'outside_delivery_zone',
    label: { en: 'Outside delivery zone', fr: 'Hors zone de livraison', ar: 'خارج منطقة التوصيل' },
    customer_message: {
      en: 'Sorry — your address is outside our delivery zone. You can place a takeout order instead.',
      fr: 'Désolé — votre adresse est hors de notre zone de livraison. Vous pouvez passer une commande à emporter.',
      ar: 'عذرًا — عنوانك خارج منطقة التوصيل. يمكنك طلب الاستلام من المطعم بدلاً من ذلك.',
    },
  },
  {
    key: 'invalid_address',
    label: { en: 'Address unclear', fr: 'Adresse incomplète', ar: 'العنوان غير واضح' },
    customer_message: {
      en: "Sorry — we couldn't locate the delivery address you provided. Please re-send the order with a clearer address.",
      fr: "Désolé — nous n'avons pas pu localiser l'adresse de livraison. Renvoyez la commande avec une adresse plus précise.",
      ar: 'عذرًا — لم نتمكن من تحديد عنوان التوصيل. يُرجى إعادة إرسال الطلب بعنوان أوضح.',
    },
  },
  {
    key: 'duplicate',
    label: { en: 'Duplicate order', fr: 'Commande en double', ar: 'طلب مكرر' },
    customer_message: {
      en: 'It looks like this order is a duplicate of one we already received. The first one is being prepared.',
      fr: 'Cette commande semble être un doublon de celle déjà reçue. La première est en préparation.',
      ar: 'يبدو أن هذا الطلب مكرّر — الطلب الأول قيد التحضير بالفعل.',
    },
  },
  {
    key: 'other',
    label: { en: 'Other (reason required)', fr: 'Autre (raison requise)', ar: 'سبب آخر (مطلوب)' },
    customer_message: {
      en: 'Sorry — we cannot fulfill this order.',
      fr: 'Désolé — nous ne pouvons pas honorer cette commande.',
      ar: 'عذرًا — لا يمكننا تلبية هذا الطلب.',
    },
    requires_note: true,
  },
];

export function getDeclineReasonSpec(key: OrderDeclineReason): DeclineReasonSpec | undefined {
  return ORDER_DECLINE_REASONS.find((r) => r.key === key);
}

// ── Cart validation (used both client + server-side) ─────────────────

export interface CartValidationError {
  code:
    | 'empty_cart'
    | 'invalid_qty'
    | 'invalid_price'
    | 'missing_customer'
    | 'missing_address'
    | 'invalid_service'
    | 'too_many_items';
  message: string;
}

export function validatePlaceOrderRequest(req: PlaceOrderRequest): CartValidationError | null {
  if (!req.items?.length) {
    return { code: 'empty_cart', message: 'Cart is empty.' };
  }
  if (req.items.length > 50) {
    return { code: 'too_many_items', message: 'Cart has too many items.' };
  }
  for (const it of req.items) {
    if (!Number.isFinite(it.qty) || it.qty < 1 || it.qty > 99) {
      return { code: 'invalid_qty', message: `Invalid quantity for "${it.name}".` };
    }
    if (!Number.isFinite(it.unit_price) || it.unit_price < 0) {
      return { code: 'invalid_price', message: `Invalid price for "${it.name}".` };
    }
  }
  if (!req.customer?.name?.trim() || !req.customer?.phone?.trim()) {
    return { code: 'missing_customer', message: 'Name and phone are required.' };
  }
  if (req.service !== 'takeout' && req.service !== 'delivery') {
    return { code: 'invalid_service', message: 'Service must be takeout or delivery.' };
  }
  if (req.service === 'delivery') {
    if (!req.delivery_address?.street?.trim()) {
      return { code: 'missing_address', message: 'Delivery address is required.' };
    }
  }
  return null;
}

// ── Lifecycle event keys for WA notifications ────────────────────────
// Centralised so the webhook router, the notify-ticket edge function, and
// the Station UI all agree on which keys map to which template.

export const ORDER_LIFECYCLE_EVENTS = {
  RECEIVED: 'order_received',
  ACCEPTED: 'order_accepted',
  DECLINED: 'order_declined',
  READY: 'order_ready',
  OUT_FOR_DELIVERY: 'order_out_for_delivery',
} as const;

export type OrderLifecycleEvent = typeof ORDER_LIFECYCLE_EVENTS[keyof typeof ORDER_LIFECYCLE_EVENTS];

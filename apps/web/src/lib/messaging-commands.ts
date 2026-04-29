import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { assertBookingAllowed, BookingGuardError } from '@/lib/booking-guard';
import { getApptVocabVars } from '@/lib/appointment-vocabulary';
import { upsertCustomerFromBooking } from '@/lib/upsert-customer';
import { getQueuePosition } from '@/lib/queue-position';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';
import { resolveWilaya, formatWilaya } from '@/lib/wilayas';
import { APP_BASE_URL } from '@/lib/config';
import { resolveRestaurantServiceType } from '@qflo/shared';
import { startWhatsappOrderFlow, tryHandleWhatsappOrderState } from '@/lib/whatsapp-ordering';

/**
 * If the picked service is takeout or delivery, kick off the in-WhatsApp
 * ordering flow (numbered menu, cart in chat, confirm by message) and
 * skip the queue-intake. Returns true when the routing fired so the
 * caller stops the standard JOIN-confirmation path.
 *
 * Pure-WhatsApp by user request: no link is ever sent to the customer.
 * Dine-in keeps the existing intake flow because party-size + name make
 * sense for table seating.
 */
async function routeRestaurantServiceToOrdering(
  serviceName: string,
  organizationId: string,
  officeId: string,
  serviceId: string,
  departmentId: string,
  identifier: string,
  channel: Channel,
  locale: Locale,
  sendMessage: SendFn,
): Promise<boolean> {
  const t = resolveRestaurantServiceType(serviceName);
  if (t !== 'takeout' && t !== 'delivery') return false;
  // WhatsApp-only ordering: messenger doesn't have the same template
  // discipline yet, so for now we only run the in-chat flow on WhatsApp.
  if (channel !== 'whatsapp') return false;
  return await startWhatsappOrderFlow(
    identifier, channel, locale,
    organizationId, officeId, serviceId, departmentId, serviceName,
    sendMessage,
  );
}

// ── Phone normalization ──────────────────────────────────────────────
// Single source of truth for WhatsApp phone identifiers. Stores E.164
// without the leading "+", because Meta Cloud webhooks deliver in this
// format. Handles Algerian (+213) and US (+1) numbers explicitly, plus
// any other E.164 input that already includes a country code.
//
// Inputs that may arrive (real examples observed):
//   "whatsapp:+16612346622"  → "16612346622"
//   "+16612346622"           → "16612346622"
//   "16612346622"            → "16612346622"
//   "+213669864728"          → "213669864728"
//   "0669864728"             → "213669864728"   (Algerian local format)
//   "213669864728"           → "213669864728"
//   "00213669864728"         → "213669864728"   (international 00 prefix)
//
// Returns digits-only E.164 with country code, no leading +.
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim();
  // Strip channel prefix and any non-digit chars
  s = s.replace(/^whatsapp:/i, '');
  s = s.replace(/[^\d+]/g, '');
  // Handle "00" international prefix
  if (s.startsWith('00')) s = s.slice(2);
  // Drop leading +
  if (s.startsWith('+')) s = s.slice(1);
  // Algerian local format: leading 0 + 9 digits → prepend country code 213
  if (s.length === 10 && s.startsWith('0')) {
    s = '213' + s.slice(1);
  }
  // 9-digit Algerian without leading 0 (rare): assume Algerian
  else if (s.length === 9 && /^[5-7]/.test(s)) {
    s = '213' + s;
  }
  return s;
}

/**
 * Returns all candidate identifier strings to try when looking up an
 * existing session/ticket by phone. Order matters: most-specific first.
 * This makes lookups robust during the transition while old data may
 * still be stored under the raw inbound format.
 */
export function phoneLookupCandidates(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const norm = normalizePhone(raw);
  const candidates = new Set<string>();
  if (norm) candidates.add(norm);
  if (raw) candidates.add(String(raw).trim());
  if (raw) candidates.add(String(raw).replace(/^whatsapp:/i, ''));
  if (norm) candidates.add('+' + norm);
  // Algerian local form for backward compat
  if (norm.startsWith('213') && norm.length === 12) {
    candidates.add('0' + norm.slice(3));
    candidates.add(norm.slice(3)); // 9-digit without leading 0
  }
  // US/Canada: strip country code 1 → 10-digit local
  if (norm.startsWith('1') && norm.length === 11) {
    candidates.add(norm.slice(1));
  }
  // Generic fallback: try last 10 and last 9 digits for any country code
  const digits = norm.replace(/\D/g, '');
  if (digits.length > 10) candidates.add(digits.slice(-10));
  if (digits.length > 9) candidates.add(digits.slice(-9));
  return Array.from(candidates).filter(Boolean);
}

// ── Directory locale cache (in-memory, 10-min TTL) ──────────────────
// When a user sends LIST/القائمة, we store their detected locale so the
// follow-up bare number reply (e.g. "3") uses the same language.
const directoryLocaleCache = new Map<string, { locale: Locale; ts: number }>();
const DIRECTORY_LOCALE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Pending join confirmation (DB-backed via whatsapp_sessions) ──────
// When a user sends JOIN <code>, we insert a whatsapp_sessions row with
// state='pending_confirmation' and ticket_id=null. On YES, we look it
// up, create the ticket, and promote it to 'active'.
const PENDING_JOIN_TTL_MINUTES = 3;

function setDirectoryLocale(identifier: string, locale: Locale): void {
  directoryLocaleCache.set(identifier, { locale, ts: Date.now() });
  // Prune old entries periodically (every 100 writes)
  if (directoryLocaleCache.size > 200) {
    const now = Date.now();
    for (const [key, val] of directoryLocaleCache) {
      if (now - val.ts > DIRECTORY_LOCALE_TTL) directoryLocaleCache.delete(key);
    }
  }
}

function getDirectoryLocale(identifier: string): Locale | null {
  const entry = directoryLocaleCache.get(identifier);
  if (!entry) return null;
  if (Date.now() - entry.ts > DIRECTORY_LOCALE_TTL) {
    directoryLocaleCache.delete(identifier);
    return null;
  }
  return entry.locale;
}

// ── Types ────────────────────────────────────────────────────────────

export type Channel = 'whatsapp' | 'messenger';

export type SendFn = (params: { to: string; body: string }) => Promise<{ ok: boolean }>;

interface OrgContext {
  id: string;
  name: string;
  settings: Record<string, any>;
}

/** Locales implemented for WhatsApp/Messenger channels. LINE/KakaoTalk/Zalo (ja/ko/vi) use their own handlers. */
/**
 * Supported locales for customer-facing messaging.
 *
 * **Fully translated** (production-ready):
 *   - en: English
 *   - fr: French (incl. Algerian French)
 *   - ar: Arabic (MSA + Darija with transliteration support)
 *
 * **MVP/Fallback** (fallback to English if key missing):
 *   - ja: Japanese (LINE channel)
 *   - ko: Korean (KakaoTalk channel)
 *   - vi: Vietnamese (Zalo channel)
 *
 * Template builders fall back to English gracefully if ja/ko/vi entries
 * are not yet translated, ensuring no broken rendering.
 */
export type Locale = 'fr' | 'ar' | 'en' | 'ja' | 'ko' | 'vi';

// ── i18n translations ────────────────────────────────────────────────
// Templates can omit ja/ko/vi entries; the `t()` function falls back to English.

const messages: Record<string, Partial<Record<Locale, string>> & Record<'en' | 'fr' | 'ar', string>> = {
  welcome: {
    fr: [
      '👋 Bienvenue sur *Qflo* !',
      '',
      '📋 *Commandes disponibles :*',
      '',
      '🎫 *File d\'attente (aujourd\'hui)*',
      '• *REJOINDRE <code>* — rejoindre une file (ex: REJOINDRE HADABI)',
      '• *STATUT* — voir votre position',
      '• *ANNULER* — quitter la file',
      '',
      '📅 *Réservations (futures)*',
      '• *RDV <code>* — réserver (ex: RDV HADABI)',
      '• *MES RDV* — voir vos réservations à venir',
      '• *ANNULER RDV* — annuler une réservation',
      '',
      '🔎 *Autres*',
      '• *LISTE* — parcourir les entreprises',
      '',
      'Le code se trouve sur l\'affiche QR de l\'entreprise.',
    ].join('\n'),
    ar: [
      'مرحبًا بك في *Qflo*! 👋',
      '',
      '📋 *الأوامر المتاحة:*',
      '',
      '🎫 *طابور الانتظار (اليوم)*',
      '• *انضم <الرمز>* — الانضمام إلى طابور (مثال: انضم HADABI)',
      '• *حالة* — معرفة موقعك',
      '• *الغاء* — مغادرة الطابور',
      '',
      '📅 *الحجوزات (المستقبلية)*',
      '• *موعد <الرمز>* — حجز موعد (مثال: موعد HADABI)',
      '• *مواعيدي* — عرض حجوزاتك القادمة',
      '• *الغاء موعد* — إلغاء حجز',
      '',
      '🔎 *أخرى*',
      '• *القائمة* — تصفح الأعمال المتاحة',
      '',
      'ستجد الرمز على ملصق QR الخاص بالمؤسسة.',
    ].join('\n'),
    en: [
      '👋 Welcome to *Qflo*!',
      '',
      '📋 *Available commands:*',
      '',
      '🎫 *Queue (today)*',
      '• *JOIN <code>* — join a queue (e.g. JOIN HADABI)',
      '• *STATUS* — check your position',
      '• *CANCEL* — leave the queue',
      '',
      '📅 *Bookings (future)*',
      '• *BOOK <code>* — book appointment (e.g. BOOK HADABI)',
      '• *MY BOOKINGS* — view your upcoming bookings',
      '• *CANCEL BOOKING* — cancel a booking',
      '',
      '🔎 *Other*',
      '• *LIST* — browse available businesses',
      '',
      'You\'ll find the code on the business\'s QR poster.',
    ].join('\n'),
  },
  not_in_queue: {
    fr: 'Vous n\'êtes dans aucune file.\n\nPour rejoindre, envoyez *REJOINDRE <code>* (ex: REJOINDRE HADABI).',
    ar: 'أنت لست في أي طابور.\n\nللانضمام، أرسل *انضم <الرمز>* (مثال: انضم HADABI).',
    en: 'You\'re not in any queue.\n\nTo join, send *JOIN <business code>* (e.g. JOIN HADABI).',
  },
  code_not_found: {
    fr: '❌ Code "*{code}*" introuvable.\n\nVérifiez le code et réessayez.',
    ar: 'الرمز "*{code}*" غير موجود ❌\n\nتحقق من الرمز وحاول مرة أخرى.',
    en: '❌ Business code "*{code}*" not found.\n\nPlease check the code and try again.',
  },
  already_in_queue: {
    fr: '✅ Vous êtes déjà dans la file chez *{name}*.\n\n🎟️ Ticket : *{ticket}*{service}\n🕐 Inscrit à : {joined}\n{position}\n\n📍 Suivre en direct : {url}\n\n🔔 Vous recevrez automatiquement une notification lorsque votre tour approchera.\n\nRépondez *STATUT* pour une mise à jour ou *ANNULER* pour quitter la file.',
    ar: '✅ أنت بالفعل في الطابور لدى *{name}*.\n\n🎟️ التذكرة: *{ticket}*{service}\n🕐 وقت التسجيل: {joined}\n{position}\n\n📍 تتبّع مباشر: {url}\n\n🔔 ستتلقى إشعارًا تلقائيًا عند اقتراب دورك.\n\nأرسل *حالة* للتحديث أو *إلغاء* للمغادرة.',
    en: '✅ You\'re already in the queue at *{name}*.\n\n🎟️ Ticket: *{ticket}*{service}\n🕐 Joined at: {joined}\n{position}\n\n📍 Track live: {url}\n\n🔔 You\'ll automatically receive a notification when your turn is approaching.\n\nReply *STATUS* for an update or *CANCEL* to leave the queue.',
  },
  queue_not_configured: {
    fr: 'Désolé, la file n\'est pas encore configurée pour *{name}*. Veuillez rejoindre via le QR code.',
    ar: 'عذرًا، الطابور غير مُهيّأ بعد لـ *{name}*. يرجى الانضمام عبر رمز QR.',
    en: 'Sorry, the queue is not fully configured for *{name}* yet. Please join via the QR code instead.',
  },
  queue_closed: {
    fr: 'Désolé, cette file est actuellement fermée. Réessayez plus tard.',
    ar: 'عذرًا، هذا الطابور مغلق حاليًا. حاول مرة أخرى لاحقًا.',
    en: 'Sorry, this queue is currently closed. Please try again later.',
  },
  business_closed_opens_at: {
    fr: '🕐 *{name}* n\'est pas encore ouvert.\n\nOuverture aujourd\'hui à *{time}*.\nRevenez à ce moment-là !',
    ar: '🕐 *{name}* لم يفتح بعد.\n\nيفتح اليوم الساعة *{time}*.\nعد في ذلك الوقت!',
    en: '🕐 *{name}* is not open yet.\n\nOpens today at *{time}*.\nCome back then!',
  },
  business_closed_for_day: {
    fr: '🚪 *{name}* est fermé pour aujourd\'hui.\n\nRéessayez demain !',
    ar: '🚪 *{name}* مغلق لبقية اليوم.\n\nحاول مجددًا غدًا!',
    en: '🚪 *{name}* is closed for today.\n\nTry again tomorrow!',
  },
  business_closed_today: {
    fr: '🚪 *{name}* est fermé aujourd\'hui.\n\nRéessayez un autre jour !',
    ar: '🚪 *{name}* مغلق اليوم.\n\nحاول في يوم آخر!',
    en: '🚪 *{name}* is closed today.\n\nTry again another day!',
  },
  queue_requires_service: {
    fr: 'Désolé, cette file nécessite de choisir un service. Rejoignez via le lien QR code.',
    ar: 'عذرًا، يتطلب هذا الطابور اختيار خدمة. انضم عبر رابط QR.',
    en: 'Sorry, this queue requires choosing a service. Please join via the QR code link instead.',
  },
  join_error: {
    fr: '⚠️ Impossible de rejoindre la file : {error}',
    ar: 'تعذر الانضمام إلى الطابور: {error} ⚠️',
    en: '⚠️ Could not join the queue: {error}',
  },
  join_failed: {
    fr: '⚠️ Une erreur est survenue. Veuillez réessayer.',
    ar: 'حدث خطأ. يرجى المحاولة مرة أخرى ⚠️',
    en: '⚠️ Something went wrong. Please try again.',
  },
  joined: {
    fr: '✅ *{ticket}* — {name}\n{position}{now_serving}📍 {url}',
    ar: '✅ *{ticket}* — {name}\n{position}{now_serving}📍 {url}',
    en: '✅ *{ticket}* — {name}\n{position}{now_serving}📍 {url}',
  },
  // Same as joined but without the leading "queue" indicator — used after
  // approval_approved_sameday. Matches the compact `joined` shape.
  joined_details: {
    fr: '🎫 *{ticket}*\n{position}{now_serving}📍 {url}',
    ar: '🎫 *{ticket}*\n{position}{now_serving}📍 {url}',
    en: '🎫 *{ticket}*\n{position}{now_serving}📍 {url}',
  },
  your_turn: {
    fr: '🔔 C\'est votre tour ! Veuillez vous diriger vers le point de service.',
    ar: 'حان دورك! يرجى التوجه إلى نقطة الخدمة 🔔',
    en: '🔔 It\'s your turn! Please proceed to your service point.',
  },
  ticket_inactive: {
    fr: 'Votre ticket n\'est plus actif. Envoyez *REJOINDRE <code>* pour rejoindre à nouveau.',
    ar: 'تذكرتك لم تعد نشطة. أرسل *انضم <الرمز>* للانضمام مجددًا.',
    en: 'Your ticket is no longer active. Send *JOIN <code>* to join again.',
  },
  ticket_ended: {
    fr: 'Ce ticket n\'est plus actif.',
    ar: 'هذه التذكرة لم تعد نشطة.',
    en: 'This ticket is no longer active.',
  },
  cannot_cancel_serving: {
    fr: 'Votre ticket est en cours de service et ne peut pas être annulé.',
    ar: 'تذكرتك قيد الخدمة حاليًا ولا يمكن إلغاؤها.',
    en: 'Your ticket is currently being served and cannot be cancelled.',
  },
  status: {
    fr: '📊 *État de la file — {name}*\n\n🎫 Ticket : *{ticket}*{service}\n📍 Votre position : *{position}*\n⏱ Attente estimée : *{wait} min*\n{now_serving}👥 En attente : *{total}*\n\n🔗 Suivre : {url}\n\nRépondez *ANNULER* pour quitter la file.',
    ar: '*حالة الطابور — {name}* 📊\n\nالتذكرة: *{ticket}*{service} 🎫\nموقعك: *{position}* 📍\nالانتظار المقدر: *{wait} دقيقة* ⏱\n{now_serving}في الانتظار: *{total}* 👥\n\nالمتابعة: {url} 🔗\n\nأرسل *إلغاء* للمغادرة.',
    en: '📊 *Queue Status — {name}*\n\n🎫 Ticket: *{ticket}*{service}\n📍 Your position: *{position}*\n⏱ Estimated wait: *{wait} min*\n{now_serving}👥 Total waiting: *{total}*\n\n🔗 Track: {url}\n\nReply *CANCEL* to leave the queue.',
  },
  cancelled: {
    fr: '🚫 Votre ticket *{ticket}* chez *{name}* a été annulé.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à tout moment.',
    ar: 'تم إلغاء تذكرتك *{ticket}* في *{name}* 🚫\n\nأرسل *انضم <الرمز>* للانضمام في أي وقت.',
    en: '🚫 Your ticket *{ticket}* at *{name}* has been cancelled.\n\nSend *JOIN <code>* to rejoin anytime.',
  },
  help_with_session: {
    fr: '📋 *{name}*\n\n🎫 *File d\'attente*\n• *STATUT* — votre position\n• *ANNULER* — quitter la file\n\n📅 *Réservations*\n• *RDV <code>* — réserver\n• *MES RDV* — vos réservations\n• *ANNULER RDV* — annuler un RDV\n\n🔎 *LISTE* — parcourir les entreprises',
    ar: '📋 *{name}*\n\n🎫 *طابور الانتظار*\n• *حالة* — موقعك\n• *الغاء* — مغادرة الطابور\n\n📅 *الحجوزات*\n• *موعد <الرمز>* — حجز\n• *مواعيدي* — حجوزاتك\n• *الغاء موعد* — إلغاء حجز\n\n🔎 *القائمة* — تصفح الأعمال',
    en: '📋 *{name}*\n\n🎫 *Queue*\n• *STATUS* — your position\n• *CANCEL* — leave the queue\n\n📅 *Bookings*\n• *BOOK <code>* — book\n• *MY BOOKINGS* — your bookings\n• *CANCEL BOOKING* — cancel a booking\n\n🔎 *LIST* — browse businesses',
  },
  not_in_queue_rejoin: {
    fr: 'Vous n\'êtes dans aucune file. Envoyez *REJOINDRE <code>* pour rejoindre.',
    ar: 'أنت لست في أي طابور. أرسل *انضم <الرمز>* للانضمام.',
    en: 'You\'re not in any queue. Send *JOIN <code>* to join.',
  },
  banned: {
    fr: '🚫 Vous avez été bloqué et ne pouvez pas rejoindre cette file.',
    ar: 'تم حظرك ولا يمكنك الانضمام إلى هذا الطابور 🚫',
    en: '🚫 You have been blocked and cannot join this queue.',
  },
  choose_department: {
    fr: '🏢 *{name}*\n\nChoisissez un département :\n{list}\nRépondez avec le *numéro*.\nEnvoyez *0* pour annuler.',
    ar: '*{name}* 🏢\n\nاختر قسمًا:\n{list}\nأرسل *الرقم*.\nأرسل *0* للإلغاء.',
    en: '🏢 *{name}*\n\nChoose a department:\n{list}\nReply with the *number*.\nSend *0* to cancel.',
  },
  choose_service: {
    fr: '📋 *{dept}*\n\nChoisissez un service :\n{list}\nRépondez avec le *numéro*.\nEnvoyez *0* pour revenir.',
    ar: '*{dept}* 📋\n\nاختر خدمة:\n{list}\nأرسل *الرقم*.\nأرسل *0* للعودة.',
    en: '📋 *{dept}*\n\nChoose a service:\n{list}\nReply with the *number*.\nSend *0* to go back.',
  },
  invalid_choice: {
    fr: '⚠️ Choix invalide. Répondez avec un *numéro* de la liste ci-dessus.',
    ar: 'اختيار غير صالح. أرسل *رقمًا* من القائمة أعلاه ⚠️',
    en: '⚠️ Invalid choice. Reply with a *number* from the list above.',
  },
  directory_header: {
    fr: '📋 *Catégories disponibles :*\n',
    ar: 'الفئات المتاحة 📋\n\n',
    en: '📋 *Available categories:*\n',
  },
  directory_footer: {
    fr: '\nRépondez avec le *numéro* pour voir les entreprises.\n💡 Raccourci : envoyez *1-2* pour rejoindre directement (catégorie 1, entreprise 2).',
    ar: '\nأرسل *الرقم* لعرض الأعمال.\nاختصار: أرسل *1-2* للانضمام مباشرة 💡',
    en: '\nReply with the *number* to see businesses.\n💡 Shortcut: send *1-2* to join directly (category 1, business 2).',
  },
  category_header: {
    fr: '{emoji} *{category}* :\n',
    ar: '{category} {emoji}\n\n',
    en: '{emoji} *{category}*:\n',
  },
  category_footer: {
    fr: '\nEnvoyez le *numéro* pour rejoindre (ex: *REJOINDRE {example}*).\nEnvoyez *LISTE* pour revenir aux catégories.',
    ar: '\nأرسل *الرقم* للانضمام (مثال: *انضم {example}*).\nأرسل *القائمة* للعودة إلى الفئات.',
    en: '\nSend the *number* to join (e.g. *JOIN {example}*).\nSend *LIST* to go back to categories.',
  },
  no_businesses: {
    fr: '📋 Aucune entreprise n\'est actuellement disponible dans le répertoire.\n\nSi vous connaissez le code, envoyez *REJOINDRE <code>*.',
    ar: 'لا توجد أعمال متاحة حاليًا في الدليل 📋\n\nإذا كنت تعرف الرمز، أرسل *انضم <الرمز>*.',
    en: '📋 No businesses are currently available in the directory.\n\nIf you know the code, send *JOIN <code>*.',
  },
  category_empty: {
    fr: '📋 Aucune entreprise dans cette catégorie.\n\nEnvoyez *LISTE* pour voir les catégories.',
    ar: 'لا توجد أعمال في هذه الفئة 📋\n\nأرسل *القائمة* لعرض الفئات.',
    en: '📋 No businesses in this category.\n\nSend *LIST* to see categories.',
  },
  multi_status_header: {
    fr: '📋 *Vos files actives :*\n',
    ar: 'طوابيرك النشطة 📋\n\n',
    en: '📋 *Your active queues:*\n',
  },
  multi_status_footer: {
    fr: '\nRépondez *ANNULER {n}* pour quitter une file spécifique\nou *ANNULER TOUT* pour tout annuler.',
    ar: '\nأرسل *إلغاء {n}* لمغادرة طابور محدد\nأو *إلغاء الكل* لإلغاء الجميع.',
    en: '\nReply *CANCEL {n}* to leave a specific queue\nor *CANCEL ALL* to cancel all.',
  },
  cancel_pick: {
    fr: '📋 *Vous avez {count} files actives :*\n{list}\nRépondez *ANNULER {n}* pour quitter une file\nou *ANNULER TOUT* pour tout annuler.',
    ar: 'لديك {count} طوابير نشطة 📋\n{list}\nأرسل *إلغاء {n}* لمغادرة طابور\nأو *إلغاء الكل* لإلغاء الجميع.',
    en: '📋 *You have {count} active queues:*\n{list}\nReply *CANCEL {n}* to leave a queue\nor *CANCEL ALL* to cancel all.',
  },
  cancelled_all: {
    fr: '🚫 Tous vos tickets ont été annulés :\n\n{list}',
    ar: 'تم إلغاء جميع تذاكرك 🚫\n\n{list}',
    en: '🚫 All your tickets have been cancelled:\n\n{list}',
  },
  confirm_join: {
    fr: '🏢 Vous êtes sur le point de rejoindre la file d\'attente chez *{name}*.\n\nVoulez-vous confirmer ?\n\n✅ Répondez *OUI* pour confirmer\n❌ Répondez *NON* pour annuler',
    ar: 'أنت على وشك الانضمام إلى طابور الانتظار في *{name}*.\n\nهل تريد التأكيد؟\n\nأرسل *نعم* للتأكيد ✅\nأرسل *لا* للإلغاء ❌',
    en: '🏢 You\'re about to join the queue at *{name}*.\n\nWould you like to confirm?\n\n✅ Reply *YES* to confirm\n❌ Reply *NO* to cancel',
  },
  confirm_join_cancelled: {
    fr: '❌ Annulé. Vous n\'avez pas rejoint la file.\n\nEnvoyez *REJOINDRE <code>* pour réessayer.',
    ar: 'تم الإلغاء. لم تنضم إلى الطابور ❌\n\nأرسل *انضم <الرمز>* للمحاولة مجددًا.',
    en: '❌ Cancelled. You did not join the queue.\n\nSend *JOIN <code>* to try again.',
  },
  // The {appt} / {service_emoji} / {arrival_line} / {cancel_cmd}
  // placeholders below are resolved per-org-category via getApptVocabVars()
  // (see appointment-vocabulary.ts). Restaurants get "réservation" + 🍽️
  // + table-ready copy; salons get "rendez-vous" + ✂️; clinics/gov/etc.
  // keep the original "rendez-vous" + 🎫 ticket copy.
  pending_approval: {
    fr: '⏳ Votre demande de {appt} à *{name}* a bien été reçue.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\nElle est en attente d\'approbation par le prestataire. Vous recevrez un message dès qu\'elle sera approuvée ou refusée.',
    ar: '⏳ تم استلام طلب {appt} في *{name}*.\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\nفي انتظار موافقة المزود. ستتلقى رسالة فور الموافقة أو الرفض.',
    en: '⏳ Your {appt} request at *{name}* has been received.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\nIt is pending provider approval. You will receive a message as soon as it is approved or declined.',
  },
  approval_approved: {
    fr: '✅ Votre {appt} à *{name}* a été *approuvé(e)*.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\n{arrival_line}',
    ar: '✅ تم *قبول* {appt} في *{name}*.\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\n{arrival_line}',
    en: '✅ Your {appt} at *{name}* has been *approved*.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\n{arrival_line}',
  },
  approval_approved_sameday: {
    fr: '✅ Votre {appt} a été *approuvé(e)* par *{name}*.\n\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\nVous êtes maintenant dans la file !',
    ar: '✅ تم *قبول* {appt} من *{name}*.\n\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\nأنت الآن في الطابور!',
    en: '✅ Your {appt} has been *approved* by *{name}*.\n\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\nYou are now in the queue!',
  },
  approval_declined: {
    fr: '❌ Votre {appt} à *{name}* a été *refusé(e)*.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\nMotif : {reason}',
    ar: '❌ تم *رفض* {appt} في *{name}*.\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\nالسبب: {reason}',
    en: '❌ Your {appt} at *{name}* has been *declined*.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\nReason: {reason}',
  },
  appointment_cancelled: {
    fr: '🚫 Votre {appt} à *{name}* a été *annulé(e)* par le prestataire.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*{reason}\n\nPour reprendre, contactez-nous ou réservez à nouveau.',
    ar: '🚫 تم *إلغاء* {appt} في *{name}* من قبل المزود.\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*{reason}\n\nلإعادة الحجز، تواصل معنا أو احجز من جديد.',
    en: '🚫 Your {appt} at *{name}* has been *cancelled* by the provider.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*{reason}\n\nTo reschedule, contact us or book again.',
  },
  appointment_rescheduled: {
    fr: '📅 Votre {appt} à *{name}* a été *reprogrammé(e)*.\n\n🕐 Nouveau créneau : *{new_date}* à *{new_time}*\n\nSi cela ne vous convient pas, contactez-nous pour modifier.',
    ar: '📅 تم *إعادة جدولة* {appt} في *{name}*.\n\n🕐 الموعد الجديد: *{new_date}* الساعة *{new_time}*\n\nإذا لم يناسبك، تواصل معنا للتعديل.',
    en: '📅 Your {appt} at *{name}* has been *rescheduled*.\n\n🕐 New time: *{new_date}* at *{new_time}*\n\nIf this doesn\'t work for you, contact us to change it.',
  },
  appointment_no_show: {
    fr: '⏰ Vous avez manqué votre {appt} à *{name}*.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\nLe créneau a été libéré. N\'hésitez pas à réserver à nouveau.',
    ar: '⏰ لقد فاتك {appt} في *{name}*.\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\nتم تحرير الوقت. يمكنك الحجز من جديد.',
    en: '⏰ You missed your {appt} at *{name}*.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\nThe slot has been released. Feel free to book again.',
  },
  appointment_status: {
    fr: '✅ Vous avez un(e) {appt} *confirmé(e)* chez *{name}*\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\n{arrival_line}\n\nEnvoyez *{cancel_cmd}* pour annuler.',
    ar: '✅ لديك {appt} *مؤكد* في *{name}*\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\n{arrival_line}\n\nأرسل *{cancel_cmd}* للإلغاء.',
    en: '✅ You have a *confirmed* {appt} at *{name}*\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\n{arrival_line}\n\nSend *{cancel_cmd}* to cancel.',
  },
  appointment_status_pending: {
    fr: '⏳ Vous avez un(e) {appt} *en attente de confirmation* chez *{name}*\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*\n{service_emoji} Service : *{service}*\n\nVous recevrez une notification dès qu\'il/elle sera confirmé(e).',
    ar: '⏳ لديك {appt} *بانتظار التأكيد* في *{name}*\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*\n{service_emoji} الخدمة: *{service}*\n\nستتلقى إشعارًا عند التأكيد.',
    en: '⏳ You have a *pending* {appt} at *{name}*\n\n📅 Date: *{date}*\n🕐 Time: *{time}*\n{service_emoji} Service: *{service}*\n\nYou\'ll be notified once it\'s confirmed.',
  },
  ask_wilaya: {
    fr: '📍 Quelle est votre *wilaya* ?\nPar exemple *Jijel* ou *18*.\n\nEnvoyez *0* pour annuler.',
    ar: '📍 ما هي *ولايتك*؟\nمثال: *جيجل* أو *18*.\n\nأرسل *0* للإلغاء.',
    en: '📍 What is your *wilaya*?\nFor example *Jijel* or *18*.\n\nSend *0* to cancel.',
  },
  ask_reason: {
    fr: '📝 Quel est le *motif* de votre visite ? (en quelques mots)\n\nEnvoyez *SKIP* pour passer ou *0* pour annuler.',
    ar: '📝 ما *سبب* زيارتك؟ (بإيجاز)\n\nأرسل *SKIP* للتخطي أو *0* للإلغاء.',
    en: '📝 What is the *reason* for your visit? (briefly)\n\nSend *SKIP* to skip or *0* to cancel.',
  },
  intake_invalid_wilaya: {
    fr: '❌ Wilaya introuvable. Essayez le nom (*Jijel*) ou le numéro (*18*).',
    ar: '❌ الولاية غير موجودة. جرّب الاسم (*جيجل*) أو الرقم (*18*).',
    en: '❌ Wilaya not found. Try the name (*Jijel*) or the number (*18*).',
  },
  intake_invalid_reason: {
    fr: '⚠️ Motif trop long. Veuillez le résumer en quelques mots (max 200 caractères).',
    ar: '⚠️ السبب طويل جدًا. يرجى تلخيصه في بضع كلمات (200 حرف كحد أقصى).',
    en: '⚠️ Reason too long. Please summarise it in a few words (max 200 characters).',
  },
  opt_in_confirmed: {
    fr: '✅ Parfait ! Vous recevrez les notifications en direct pour votre ticket *{ticket}*.',
    ar: 'ممتاز! ستتلقى إشعارات مباشرة لتذكرتك *{ticket}* ✅',
    en: '✅ Great! You\'ll receive live notifications for your ticket *{ticket}*.',
  },
  opt_out_confirmed: {
    fr: '🔕 Vous ne recevrez plus de notifications pour le ticket *{ticket}*.',
    ar: 'لن تتلقى المزيد من الإشعارات لتذكرة *{ticket}* 🔕',
    en: '🔕 You won\'t receive further notifications for ticket *{ticket}*.',
  },
  language_picker: {
    fr: 'مرحبا 👋\n\nChoisissez votre langue :\n1️⃣ العربية\n2️⃣ Français\n3️⃣ English',
    ar: 'مرحبا 👋\n\nChoisissez votre langue :\n1️⃣ العربية\n2️⃣ Français\n3️⃣ English',
    en: 'مرحبا 👋\n\nChoisissez votre langue :\n1️⃣ العربية\n2️⃣ Français\n3️⃣ English',
  },
  quick_menu: {
    fr: '\n\n📋 *Que souhaitez-vous faire ?*\n*1* — Vérifier votre position\n*2* — Annuler votre ticket',
    ar: '\n\n📋 *ماذا تريد أن تفعل؟*\n*1* — التحقق من موقعك\n*2* — إلغاء تذكرتك',
    en: '\n\n📋 *What would you like to do?*\n*1* — Check your position\n*2* — Cancel your ticket',
  },
  // ── Booking flow messages ──
  booking_disabled: {
    fr: '❌ Les réservations ne sont pas disponibles chez *{name}*.',
    ar: 'الحجز غير متاح في *{name}* ❌',
    en: '❌ Booking is not available at *{name}*.',
  },
  booking_choose_service: {
    fr: '📅 *Réservation — {name}*\n\nChoisissez un service :\n{list}\nRépondez avec le *numéro*.\nEnvoyez *0* pour annuler.',
    ar: '*حجز — {name}* 📅\n\nاختر خدمة:\n{list}\nأرسل *الرقم*.\nأرسل *0* للإلغاء.',
    en: '📅 *Booking — {name}*\n\nChoose a service:\n{list}\nReply with the *number*.\nSend *0* to cancel.',
  },
  booking_choose_date: {
    fr: '📅 *Choisissez une date :*\n\n{list}\n\n{pagination}Répondez avec le *numéro*.\nEnvoyez *0* pour revenir.',
    ar: '📅 *اختر تاريخًا:*\n\n{list}\n\n{pagination}أرسل *الرقم*.\nأرسل *0* للعودة.',
    en: '📅 *Choose a date:*\n\n{list}\n\n{pagination}Reply with the *number*.\nSend *0* to go back.',
  },
  booking_choose_time: {
    fr: '⏰ *Choisissez un créneau pour le {date} :*\n\n{list}\nRépondez avec le *numéro*.\nEnvoyez *0* pour revenir.',
    ar: '⏰ *اختر وقتًا ليوم {date}:*\n\n{list}\nأرسل *الرقم*.\nأرسل *0* للعودة.',
    en: '⏰ *Choose a time slot for {date}:*\n\n{list}\nReply with the *number*.\nSend *0* to go back.',
  },
  booking_enter_name: {
    fr: '📝 Veuillez entrer votre *nom complet* pour la réservation.\nEnvoyez *0* pour annuler.',
    ar: '📝 يرجى إدخال *اسمك الكامل* للحجز.\nأرسل *0* للإلغاء.',
    en: '📝 Please enter your *full name* for the booking.\nSend *0* to cancel.',
  },
  join_enter_name: {
    fr: '📝 Veuillez entrer votre *nom complet* pour rejoindre la file.\nEnvoyez *0* pour annuler.',
    ar: '📝 يرجى إدخال *اسمك الكامل* للانضمام إلى الطابور.\nأرسل *0* للإلغاء.',
    en: '📝 Please enter your *full name* to join the queue.\nSend *0* to cancel.',
  },
  custom_intake_prompt: {
    fr: '📝 Veuillez entrer votre *{field}* :\nEnvoyez *0* pour annuler.',
    ar: '📝 يرجى إدخال *{field}* الخاص بك:\nأرسل *0* للإلغاء.',
    en: '📝 Please enter your *{field}*:\nSend *0* to cancel.',
  },
  booking_enter_phone: {
    fr: '📱 Entrez votre *numéro de téléphone* (ou envoyez *SKIP* pour passer).\nEnvoyez *0* pour annuler.',
    ar: '📱 أدخل *رقم هاتفك* (أو أرسل *SKIP* للتخطي).\nأرسل *0* للإلغاء.',
    en: '📱 Enter your *phone number* (or send *SKIP* to skip).\nSend *0* to cancel.',
  },
  booking_enter_wilaya: {
    fr: '📍 Quelle est votre *wilaya* ?\nPar exemple *Jijel* ou *18*.\n\nEnvoyez *0* pour annuler.',
    ar: '📍 ما هي *ولايتك*؟\nمثال: *جيجل* أو *18*.\n\nأرسل *0* للإلغاء.',
    en: '📍 What is your *wilaya*?\nFor example *Jijel* or *18*.\n\nSend *0* to cancel.',
  },
  booking_enter_reason: {
    fr: '📝 Quel est le *motif* de votre rendez-vous ? (en quelques mots)\n\nEnvoyez *SKIP* pour passer ou *0* pour annuler.',
    ar: '📝 ما *سبب* موعدك؟ (بإيجاز)\n\nأرسل *SKIP* للتخطي أو *0* للإلغاء.',
    en: '📝 What is the *reason* for your appointment? (briefly)\n\nSend *SKIP* to skip or *0* to cancel.',
  },
  booking_confirm: {
    fr: '📋 *Résumé de votre réservation :*\n\n🏢 *{name}*\n📅 Date : *{date}*\n⏰ Heure : *{time}*{fields}\n\n✅ Répondez *OUI* pour confirmer\n❌ Répondez *NON* pour annuler',
    ar: '📋 *ملخص حجزك:*\n\n🏢 *{name}*\n📅 التاريخ: *{date}*\n⏰ الوقت: *{time}*{fields}\n\n✅ أرسل *نعم* للتأكيد\n❌ أرسل *لا* للإلغاء',
    en: '📋 *Your booking summary:*\n\n🏢 *{name}*\n📅 Date: *{date}*\n⏰ Time: *{time}*{fields}\n\n✅ Reply *YES* to confirm\n❌ Reply *NO* to cancel',
  },
  booking_confirmed: {
    fr: '✅ *Réservation confirmée !*\n\n🏢 *{name}*\n📅 *{date}* à *{time}*\n👤 *{customer}*\n\nVous recevrez un rappel 1h avant votre rendez-vous.\n\nPour annuler, envoyez *ANNULER RDV*.',
    ar: '✅ *تم تأكيد الحجز!*\n\n🏢 *{name}*\n📅 *{date}* الساعة *{time}*\n👤 *{customer}*\n\nستتلقى تذكيرًا قبل ساعة من موعدك.\n\nللإلغاء، أرسل *الغاء موعد*.',
    en: '✅ *Booking confirmed!*\n\n🏢 *{name}*\n📅 *{date}* at *{time}*\n👤 *{customer}*\n\nYou\'ll receive a reminder 1 hour before your appointment.\n\nTo cancel, send *CANCEL BOOKING*.',
  },
  booking_pending_approval: {
    fr: '⏳ *Demande de réservation reçue*\n\n🏢 *{name}*\n📅 *{date}* à *{time}*\n👤 *{customer}*\n\nVotre créneau est *réservé* en attente de la validation du prestataire. Vous recevrez un message dès qu\'elle sera approuvée ou refusée.\n\nPour annuler, envoyez *ANNULER RDV*.',
    ar: '⏳ *تم استلام طلب الحجز*\n\n🏢 *{name}*\n📅 *{date}* الساعة *{time}*\n👤 *{customer}*\n\nتم *حجز* موعدك في انتظار موافقة المزود. ستتلقى رسالة فور الموافقة أو الرفض.\n\nللإلغاء، أرسل *الغاء موعد*.',
    en: '⏳ *Booking request received*\n\n🏢 *{name}*\n📅 *{date}* at *{time}*\n👤 *{customer}*\n\nYour slot is *reserved* pending provider approval. You will receive a message as soon as it is approved or declined.\n\nTo cancel, send *CANCEL BOOKING*.',
  },
  booking_failed: {
    fr: '⚠️ Impossible de créer la réservation. Le créneau est peut-être déjà complet. Veuillez réessayer.',
    ar: 'تعذر إنشاء الحجز. قد يكون الوقت محجوزًا بالكامل. يرجى المحاولة مرة أخرى ⚠️',
    en: '⚠️ Could not create the booking. The slot may be full. Please try again.',
  },
  booking_slot_taken: {
    fr: '⚠️ Désolé, ce créneau vient d\'être réservé par quelqu\'un d\'autre. Voici les créneaux encore disponibles :',
    ar: '⚠️ عذرًا، تم حجز هذا الموعد للتو من قبل شخص آخر. إليك المواعيد المتاحة :',
    en: '⚠️ Sorry, that slot was just taken by someone else. Here are the slots still available:',
  },
  booking_cancelled: {
    fr: '❌ Réservation annulée.',
    ar: 'تم إلغاء الحجز ❌',
    en: '❌ Booking cancelled.',
  },
  booking_no_dates: {
    fr: '😔 Aucun créneau disponible dans les prochains jours. Veuillez réessayer plus tard.',
    ar: 'لا توجد مواعيد متاحة في الأيام القادمة. يرجى المحاولة لاحقًا 😔',
    en: '😔 No available dates in the coming days. Please try again later.',
  },
  booking_no_slots: {
    fr: '😔 Aucun créneau disponible pour cette date. Essayez une autre date.',
    ar: 'لا توجد مواعيد متاحة لهذا التاريخ. جرب تاريخًا آخر 😔',
    en: '😔 No available time slots for this date. Try another date.',
  },
  cancel_booking_none: {
    fr: 'Vous n\'avez aucune réservation à venir.',
    ar: 'ليس لديك أي حجز قادم.',
    en: 'You have no upcoming bookings.',
  },
  cancel_booking_done: {
    fr: '🚫 Votre réservation du *{date}* à *{time}* a été annulée.',
    ar: 'تم إلغاء حجزك ليوم *{date}* الساعة *{time}* 🚫',
    en: '🚫 Your booking for *{date}* at *{time}* has been cancelled.',
  },
  cancel_booking_pick: {
    fr: '📅 *Quelle réservation annuler ?*\n\n{list}\n\nRépondez avec *ANNULER RDV 1*, *ANNULER RDV 2*, etc.',
    ar: '📅 *أي حجز تريد إلغاءه؟*\n\n{list}\n\nأجب بـ *الغاء موعد 1* أو *الغاء موعد 2* وهكذا.',
    en: '📅 *Which booking to cancel?*\n\n{list}\n\nReply with *CANCEL BOOKING 1*, *CANCEL BOOKING 2*, etc.',
  },
  cancel_booking_bad_index: {
    fr: '❌ Numéro invalide. Envoyez *MES RDV* pour voir la liste.',
    ar: '❌ رقم غير صالح. أرسل *مواعيدي* لرؤية القائمة.',
    en: '❌ Invalid number. Send *MY BOOKINGS* to see the list.',
  },
  my_bookings_none: {
    fr: '📭 Vous n\'avez aucune réservation à venir.\n\nPour réserver : *RDV CODE* (ex: *RDV HADABI*)',
    ar: '📭 ليس لديك أي حجز قادم.\n\nللحجز: *موعد رمز* (مثال: *موعد HADABI*)',
    en: '📭 You have no upcoming bookings.\n\nTo book: *BOOK CODE* (e.g. *BOOK HADABI*)',
  },
  my_bookings_list: {
    fr: '📅 *Vos réservations à venir :*\n\n{list}\n\nPour annuler : *ANNULER RDV*',
    ar: '📅 *حجوزاتك القادمة:*\n\n{list}\n\nللإلغاء: *الغاء موعد*',
    en: '📅 *Your upcoming bookings:*\n\n{list}\n\nTo cancel: *CANCEL BOOKING*',
  },
  book_needs_org: {
    fr: '📅 Pour réserver, indiquez d\'abord le code de l\'entreprise.\n\nExemple : *RDV HADABI*\n\nOu envoyez *LISTE* pour parcourir les entreprises disponibles.',
    ar: '📅 للحجز، يرجى إرسال رمز المؤسسة أولاً.\n\nمثال: *موعد HADABI*\n\nأو أرسل *القائمة* لتصفح الأعمال المتاحة.',
    en: '📅 To book, please include the business code.\n\nExample: *BOOK HADABI*\n\nOr send *LIST* to browse available businesses.',
  },
  // Sent when a customer opens the chat via the business-specific deeplink QR
  // (e.g. "Hi HADABI") and has no upcoming bookings at that business.
  greeting_welcome: {
    fr: '👋 Bonjour et bienvenue chez *{name}* !\n\nVous n\'avez aucune réservation à venir.\n\n*Que souhaitez-vous faire ?*\n• *RDV {code}* — réserver un rendez-vous\n• *REJOINDRE {code}* — rejoindre la file\n• *LISTE* — voir d\'autres entreprises',
    ar: '👋 مرحبًا بك في *{name}*!\n\nليس لديك أي حجز قادم.\n\n*ماذا تريد أن تفعل؟*\n• *موعد {code}* — حجز موعد\n• *انضم {code}* — الانضمام إلى الطابور\n• *القائمة* — تصفح أعمال أخرى',
    en: '👋 Hello and welcome to *{name}*!\n\nYou have no upcoming bookings.\n\n*What would you like to do?*\n• *BOOK {code}* — book an appointment\n• *JOIN {code}* — join the queue\n• *LIST* — browse other businesses',
  },
  // Sent on a bare greeting ("Hi") with no business code attached.
  greeting_welcome_generic: {
    fr: '👋 Bonjour !\n\nVous n\'avez aucune réservation à venir.\n\n*Pour commencer :*\n• *RDV <code>* — réserver (ex: *RDV HADABI*)\n• *REJOINDRE <code>* — rejoindre une file\n• *LISTE* — parcourir les entreprises',
    ar: '👋 مرحبًا!\n\nليس لديك أي حجز قادم.\n\n*للبدء:*\n• *موعد <الرمز>* — حجز موعد (مثال: *موعد HADABI*)\n• *انضم <الرمز>* — الانضمام إلى طابور\n• *القائمة* — تصفح الأعمال',
    en: '👋 Hello!\n\nYou have no upcoming bookings.\n\n*To get started:*\n• *BOOK <code>* — book (e.g. *BOOK HADABI*)\n• *JOIN <code>* — join a queue\n• *LIST* — browse businesses',
  },
  // ── QR keyword handler ──
  // Sent when the customer sends "QR" but we have no ticket to resolve an org from.
  qr_no_active_ticket: {
    fr: '❌ Aucun ticket actif trouvé. Rejoignez d\'abord une file pour recevoir les QR codes de paiement.',
    ar: '❌ لم يُعثر على تذكرة نشطة. انضم أولاً إلى طابور لاستلام رموز QR للدفع.',
    en: '❌ No active ticket found. Please join a queue first to receive payment QR codes.',
  },
  // Sent when the org has no QR code payment methods configured.
  qr_no_methods: {
    fr: '❌ Aucun QR code de paiement disponible chez *{name}*.',
    ar: '❌ لا توجد رموز QR للدفع متاحة في *{name}*.',
    en: '❌ No payment QR codes available at *{name}*.',
  },
};

// ── Template lookup with locale fallback ────────────────────────────
/**
 * Get a message template, falling back to English if the requested locale
 * is not yet translated (e.g., ja/ko/vi MVP locales).
 * Safely handles missing template keys (should not occur in production,
 * but prevents silent failures).
 */
function tpl(locale: Locale, templates: Record<Locale, string>): string {
  return templates[locale] ?? templates.en ?? '(message not found)';
}

// ── Notification messages — imported from @qflo/shared (single source of truth) ──
import { notificationMessages, renderNotification, getEnabledIntakeFields, getFieldLabel as sharedGetFieldLabel, type IntakeField } from '@qflo/shared';
export { notificationMessages, renderNotification };

// Wrapper for getFieldLabel that handles ja/ko/vi fallback to English
function getFieldLabel(field: IntakeField, locale: Locale): string {
  const sharedLocale = (locale === 'ja' || locale === 'ko' || locale === 'vi') ? 'en' : locale;
  return sharedGetFieldLabel(field, sharedLocale);
}

// Re-export formatWilaya with Locale fallback support
export { resolveWilaya };
const originalFormatWilaya = formatWilaya;
export function formatWilayaLocale(w: any, locale: Locale): string {
  const wilayaLocale = (locale === 'ja' || locale === 'ko' || locale === 'vi') ? 'en' : locale;
  return originalFormatWilaya(w, wilayaLocale);
}

// ── Locale detection ─────────────────────────────────────────────────

function detectLocale(message: string): Locale {
  const trimmed = message.trim();
  if (/^(REJOINDRE|STATUT|ANNULER|LISTE|RDV|RESERVER)\b/i.test(trimmed)) return 'fr';
  if (/^(انضم|حالة|الغاء|إلغاء|قائمة|القائمة|دليل|الفهرس|موعد|حجز|احجز|مواعيدي|حجوزاتي)\b/.test(trimmed)) return 'ar';
  if (/^(JOIN|STATUS|CANCEL|LIST|DIRECTORY|BOOK)\b/i.test(trimmed)) return 'en';
  if (/[\u0600-\u06FF]/.test(trimmed)) return 'ar';
  return 'fr';
}

// ── Greeting detection ───────────────────────────────────────────────
// Matches conversational openers like "Hi", "Salut", "سلام" — including
// Darija / Algerian-French shorthand. Used so a customer who scans the
// in-house booking QR and just sends a greeting immediately gets a
// business-specific welcome (or their upcoming bookings list).
//
// The regex only fires on WHOLE-message matches after trimming and
// stripping trailing punctuation/emojis, to avoid false positives when
// the same token appears mid-sentence (e.g. "cc" in an email address).

const GREETING_PATTERNS: ReadonlyArray<{ locale: Locale; re: RegExp }> = [
  // English
  { locale: 'en', re: /^(?:hi|hello|hey|heya|hiya|yo|sup|wassup|what'?s\s*up|howdy|greetings|gm|ga|ge|morning|afternoon|evening|good\s*(?:morning|afternoon|evening|day)|hi\s*there|hello\s*there|hey\s*there)$/i },
  // French (incl. Algerian casual)
  { locale: 'fr', re: /^(?:salut|slt|coucou|cc|bonjour|bjr|bonsoir|bsr|bonne\s*(?:journee|journée|soiree|soirée)|allo|allô|re|rebonjour|salutations)$/i },
  // Arabic (script — includes MSA and darija)
  { locale: 'ar', re: /^(?:سلام|السلام|ال?سلام\s*عليكم|وعليكم\s*السلام|مرحبا|مرحبًا|مرحباً|اهلا|أهلا|أهلاً|اهلا\s*وسهلا|أهلا\s*وسهلا|صباح\s*الخير|مساء\s*الخير|تحياتي|السلام\s*عليكم\s*ورحمة\s*الله)$/ },
  // Arabic/Darija transliterated in Latin (very common on WhatsApp in Algeria)
  { locale: 'ar', re: /^(?:salem|salam|selam|slm|slam|salaam|assalam|as?salamou?\s*alaykum|salam\s*[a3]laykum|sba7\s*(?:lkhir|el\s*khir)|sbah\s*(?:lkhir|el\s*khir)|msa\s*(?:lkhir|el\s*khir|2?\s*lkhir)|ahla|ahlan|marhaba|marhba|labas|labess|la\s*bas|wach|wech|weche|ki\s*dayr|kidayr|ki\s*rak|kirak|kiraki|ki\s*rakom)$/i },
];

/**
 * If the cleaned inbound message looks like a greeting (optionally followed
 * by a business code, e.g. "Hi HADABI"), return the detected locale and the
 * code. Returns null otherwise. Keeps length bounded to avoid matching long
 * real messages.
 */
function detectGreeting(cleaned: string): { locale: Locale; code: string | null } | null {
  // Strip trailing punctuation/emojis, collapse spaces
  const trimmed = cleaned.trim().replace(/[!.\?؟…\u2026,،\s]+$/u, '').trim();
  if (trimmed.length === 0 || trimmed.length > 60) return null;

  const parts = trimmed.split(/\s+/);
  // Try progressively longer greeting prefixes (allows multi-word greetings
  // like "good morning HADABI" or "السلام عليكم HADABI").
  for (let splitAt = parts.length; splitAt >= 1; splitAt--) {
    const greetingPart = parts.slice(0, splitAt).join(' ');
    const codePart = parts.slice(splitAt).join(' ').trim();
    // Code (if present) must look like a business code
    if (codePart && !/^[A-Z0-9_-]{2,30}$/i.test(codePart)) continue;
    for (const { locale, re } of GREETING_PATTERNS) {
      if (re.test(greetingPart)) {
        return { locale, code: codePart ? codePart.toUpperCase() : null };
      }
    }
  }
  return null;
}

/** Force RTL rendering for Arabic text on WhatsApp.
 *  Uses Right-to-Left Embedding (U+202B) + Pop Directional Formatting (U+202C)
 *  wrapping each line. Messenger ignores these markers (platform limitation). */
function ensureRTL(text: string): string {
  return text.split('\n').map(line => line.length > 0 ? `\u202B${line}\u202C` : line).join('\n');
}

/** For Arabic we render list indices with Arabic-Indic digits so they're
 *  strong-RTL characters — keeps bidi stable and the number lands at the
 *  visual end of the RTL line instead of getting reordered by the weak
 *  Latin digit + em-dash combo. */
function toLocaleDigits(n: number, locale: Locale): string {
  if (locale !== 'ar') return String(n);
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(n).split('').map(c => {
    const d = Number(c);
    return Number.isFinite(d) ? map[d] : c;
  }).join('');
}

/**
 * Translate known error strings returned by createPublicTicket().
 * These errors are embedded in the {error} variable of the `join_error` template.
 * Without this, Arabic/French users see English error text inside a translated wrapper.
 */
const errorTranslations: Record<string, Partial<Record<Locale, string>> & Record<'en' | 'fr' | 'ar', string>> = {
  'Closed for the day': {
    fr: 'Fermé pour la journée',
    ar: 'مغلق لباقي اليوم',
    en: 'Closed for the day',
  },
  'Closed today': {
    fr: 'Fermé aujourd\'hui',
    ar: 'مغلق اليوم',
    en: 'Closed today',
  },
  'This business is not taking visits right now.': {
    fr: 'Cette entreprise n\'accepte pas de visites pour le moment.',
    ar: 'هذا المكان لا يستقبل زيارات حاليًا.',
    en: 'This business is not taking visits right now.',
  },
  'You are not allowed to join this queue.': {
    fr: 'Vous n\'êtes pas autorisé à rejoindre cette file.',
    ar: 'غير مسموح لك بالانضمام إلى هذا الطابور.',
    en: 'You are not allowed to join this queue.',
  },
  'Email verification is required before joining this queue.': {
    fr: 'La vérification de l\'email est requise avant de rejoindre cette file.',
    ar: 'يجب التحقق من البريد الإلكتروني قبل الانضمام إلى هذا الطابور.',
    en: 'Email verification is required before joining this queue.',
  },
  'Please verify your email before joining the queue.': {
    fr: 'Veuillez vérifier votre email avant de rejoindre la file.',
    ar: 'يرجى التحقق من بريدك الإلكتروني قبل الانضمام إلى الطابور.',
    en: 'Please verify your email before joining the queue.',
  },
  'Office not found': {
    fr: 'Bureau introuvable',
    ar: 'المكتب غير موجود',
    en: 'Office not found',
  },
  'Failed to generate ticket number': {
    fr: 'Erreur lors de la génération du numéro de ticket',
    ar: 'فشل في إنشاء رقم التذكرة',
    en: 'Failed to generate ticket number',
  },
};

/** Translate a known error string, or return it as-is if not recognized */
export function translateError(error: string, locale: Locale): string {
  // Exact match first
  if (errorTranslations[error]) {
    return errorTranslations[error][locale] ?? error;
  }
  // Check "Opens at HH:MM" pattern
  const opensMatch = error.match(/^Opens at (.+)$/);
  if (opensMatch) {
    const time = opensMatch[1];
    const opensAt: Partial<Record<Locale, string>> & Record<'en' | 'fr' | 'ar', string> = {
      fr: `Ouvre à ${time}`,
      ar: `يفتح على الساعة ${time}`,
      en: `Opens at ${time}`,
    };
    return opensAt[locale] ?? error;
  }
  return error;
}

export function t(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  // Fallback chain: requested locale → English (for ja/ko/vi MVP) → key as literal
  let msg = messages[key]?.[locale] ?? messages[key]?.['en'] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? '?'));
    }
  }
  return locale === 'ar' ? ensureRTL(msg) : msg;
}

export function tNotification(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  // Fall back to English for ja/ko/vi since @qflo/shared only has en/fr/ar
  const sharedLocale = (locale === 'ja' || locale === 'ko' || locale === 'vi') ? 'en' : locale;
  const msg = renderNotification(key, sharedLocale, vars);
  return locale === 'ar' ? ensureRTL(msg) : msg;
}

// ── Shared-number routing ────────────────────────────────────────────

function parseBusinessCode(message: string): { code: string; locale: Locale } | null {
  const trimmed = message.trim();
  const frMatch = trimmed.match(/^REJOINDRE[\s\-_]+(.+)$/i);
  if (frMatch) return { code: frMatch[1].trim().toUpperCase(), locale: 'fr' };
  const arMatch = trimmed.match(/^انضم[\s\-_]+(.+)$/);
  if (arMatch) {
    // Arabic code: keep original text (don't uppercase Arabic characters)
    // but uppercase if it's a Latin code (e.g. "انضم HADABI")
    const raw = arMatch[1].trim();
    const hasArabic = /[\u0600-\u06FF]/.test(raw);
    return { code: hasArabic ? raw : raw.toUpperCase(), locale: 'ar' };
  }
  const enMatch = trimmed.match(/^JOIN[\s\-_]+(.+)$/i);
  if (enMatch) return { code: enMatch[1].trim().toUpperCase(), locale: 'en' };
  return null;
}

function parseBookingCode(message: string): { code: string; locale: Locale } | null {
  const trimmed = message.trim();
  const frMatch = trimmed.match(/^(RDV|RESERVER|RESERVATION)[\s\-_]+(.+)$/i);
  if (frMatch) return { code: frMatch[2].trim().toUpperCase(), locale: 'fr' };
  const arMatch = trimmed.match(/^(موعد|حجز|احجز)[\s\-_]+(.+)$/);
  if (arMatch) {
    const raw = arMatch[2].trim();
    // Reject if the "code" is itself a booking keyword (e.g. "حجز موعد" = not a code)
    if (/^(موعد|حجز|احجز)$/i.test(raw)) return null;
    const hasArabic = /[\u0600-\u06FF]/.test(raw);
    return { code: hasArabic ? raw : raw.toUpperCase(), locale: 'ar' };
  }
  const enMatch = trimmed.match(/^(BOOK|BOOKING|RESERVE)[\s\-_]+(.+)$/i);
  if (enMatch) return { code: enMatch[2].trim().toUpperCase(), locale: 'en' };
  return null;
}

/**
 * Find an organization by its business code.
 * Checks both whatsapp_enabled and messenger_enabled based on channel.
 */
async function findOrgByCode(code: string, channel: Channel): Promise<OrgContext | null> {
  const supabase = createAdminClient();
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, settings');

  const enabledKey = channel === 'messenger' ? 'messenger_enabled' : 'whatsapp_enabled';
  const codeKey = channel === 'messenger' ? 'messenger_code' : 'whatsapp_code';

  const org = (orgs ?? []).find((o: any) => {
    const settings = (o.settings ?? {}) as Record<string, any>;
    // Check the channel-specific enabled flag; fall back to whatsapp_enabled for messenger
    // if messenger_enabled isn't explicitly set (shared config)
    if (!settings[enabledKey] && !settings.whatsapp_enabled) return false;
    // Check channel-specific code first, then fall back to whatsapp_code (shared codes)
    const orgCode = (settings[codeKey] ?? settings.whatsapp_code ?? '').toString().toUpperCase().trim();
    if (orgCode === code) return true;
    // Also match Arabic alternative code (stored as-is, compared case-insensitively)
    const arCode = (settings.arabic_code ?? '').toString().trim();
    if (arCode && arCode === code) return true;
    return false;
  });

  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    settings: (org.settings ?? {}) as Record<string, any>,
  };
}

/**
 * Find an active session for a given identifier (phone for WhatsApp, PSID for Messenger).
 * For WhatsApp, also checks whatsapp_bsuid if the primary phone lookup fails
 * (handles username adopters whose phone may not be available).
 */
async function findOrgByActiveSession(
  identifier: string,
  channel: Channel,
  bsuid?: string,
): Promise<{ org: OrgContext; session: any } | null> {
  const supabase = createAdminClient() as any;

  const identifierColumn = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id, organization_id, locale, channel')
    .eq(identifierColumn, identifier)
    .eq('state', 'active')
    .eq('channel', channel)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // If no session found by phone but we have a BSUID, try BSUID lookup
  if (!session && channel === 'whatsapp' && bsuid) {
    const { data: bsuidSession } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id, organization_id, locale, channel')
      .eq('whatsapp_bsuid', bsuid)
      .eq('state', 'active')
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bsuidSession) {
      // Backfill phone if now available (user may have been resolved)
      if (identifier && identifier !== bsuid) {
        await supabase
          .from('whatsapp_sessions')
          .update({ whatsapp_phone: identifier })
          .eq('id', bsuidSession.id);
      }

      const adminClient = createAdminClient();
      const { data: orgRow } = await adminClient
        .from('organizations')
        .select('id, name, settings')
        .eq('id', bsuidSession.organization_id)
        .single();

      if (!orgRow) return null;
      return {
        org: { id: orgRow.id, name: orgRow.name, settings: (orgRow.settings ?? {}) as Record<string, any> },
        session: bsuidSession,
      };
    }
  }

  if (!session) return null;

  const adminClient = createAdminClient();
  const { data: orgRow } = await adminClient
    .from('organizations')
    .select('id, name, settings')
    .eq('id', session.organization_id)
    .single();

  if (!orgRow) return null;

  return {
    org: {
      id: orgRow.id,
      name: orgRow.name,
      settings: (orgRow.settings ?? {}) as Record<string, any>,
    },
    session,
  };
}

/**
 * Find ALL active sessions for a given user identifier.
 * Returns array sorted by created_at descending (newest first).
 */
async function findAllActiveSessionsByUser(
  identifier: string,
  channel: Channel,
  bsuid?: string,
  fallbackLocale: Locale = 'fr',
): Promise<Array<{ session: any; org: OrgContext }>> {
  const supabase = createAdminClient() as any;
  const idCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Build candidate identifier list (handles legacy data stored under
  // different formats: with/without country code, with/without leading +)
  const lookupValues = channel === 'whatsapp'
    ? phoneLookupCandidates(identifier)
    : [identifier];

  const { data: sessions } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id, organization_id, locale, channel, whatsapp_phone')
    .in(idCol, lookupValues)
    .eq('state', 'active')
    .eq('channel', channel)
    .order('created_at', { ascending: false });

  // Also check BSUID for WhatsApp
  let bsuidSessions: any[] = [];
  if (channel === 'whatsapp' && bsuid) {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id, organization_id, locale, channel, whatsapp_phone')
      .eq('whatsapp_bsuid', bsuid)
      .eq('state', 'active')
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false });
    bsuidSessions = data ?? [];
  }

  // Merge and deduplicate by session id
  const allSessions = [...(sessions ?? [])];
  const existingIds = new Set(allSessions.map((s: any) => s.id));
  for (const s of bsuidSessions) {
    if (!existingIds.has(s.id)) allSessions.push(s);
  }

  // Filter out sessions whose ticket is no longer in an active status (cloud
  // is the source of truth — Station/web cancels close them via DB trigger,
  // but be defensive in case the trigger ever lags or is disabled).
  if (allSessions.length > 0) {
    const ticketIds = allSessions.map((s: any) => s.ticket_id).filter(Boolean);
    if (ticketIds.length > 0) {
      const { data: ticketRows } = await supabase
        .from('tickets')
        .select('id, status')
        .in('id', ticketIds);
      const activeTicketIds = new Set(
        (ticketRows ?? [])
          .filter((t: any) => ['waiting', 'called', 'serving', 'pending_approval'].includes(t.status))
          .map((t: any) => t.id)
      );
      const closedSessionIds: string[] = [];
      for (let i = allSessions.length - 1; i >= 0; i--) {
        const s = allSessions[i];
        if (s.ticket_id && !activeTicketIds.has(s.ticket_id)) {
          closedSessionIds.push(s.id);
          allSessions.splice(i, 1);
        }
      }
      // Best-effort: mark them completed so we don't rescan them next time
      if (closedSessionIds.length > 0) {
        await supabase.from('whatsapp_sessions')
          .update({ state: 'completed' })
          .in('id', closedSessionIds);
      }
    }
  }

  // ── Also find unlinked tickets by phone number (kiosk / in-house) ──
  // Match against customer_data->>'phone' but ONLY with strict last-9-digit
  // matching. Numbers shorter than 9 digits are rejected — they would create
  // cross-customer collisions (e.g. two unrelated 7-digit numbers matching).
  if (channel === 'whatsapp' && identifier) {
    const normIdentifier = normalizePhone(identifier);
    if (normIdentifier.length >= 9) {
      const last9 = normIdentifier.slice(-9);
      const linkedTicketIds = new Set(allSessions.map((s: any) => s.ticket_id).filter(Boolean));

      const { data: phoneTickets } = await supabase
        .from('tickets')
        .select('id, office_id, customer_data, created_at')
        .in('status', ['waiting', 'called', 'serving'])
        .filter('customer_data->>phone', 'ilike', `%${last9}%`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (phoneTickets && phoneTickets.length > 0) {
        const officeIds = [...new Set(phoneTickets.map((t: any) => t.office_id))];
        const { data: offices } = await supabase
          .from('offices')
          .select('id, organization_id')
          .in('id', officeIds);
        const officeOrgMap = new Map<string, string>((offices ?? []).map((o: any) => [o.id, o.organization_id]));

        for (const ticket of phoneTickets) {
          if (linkedTicketIds.has(ticket.id)) continue; // already linked

          // Strict check: BOTH sides must have ≥9 digits and the last 9 must
          // match exactly. Refuses to auto-link short / ambiguous numbers.
          const rawPhone = ticket.customer_data?.phone;
          if (!rawPhone) continue;
          const ticketNorm = normalizePhone(String(rawPhone));
          if (ticketNorm.length < 9) continue;
          if (ticketNorm.slice(-9) !== last9) continue;

          const orgId = officeOrgMap.get(ticket.office_id);
          if (!orgId) continue;

          // Look up any existing session for this ticket, regardless of phone
          // format, so we don't create a duplicate active session.
          const { data: existingForTicket } = await supabase
            .from('whatsapp_sessions')
            .select('id, ticket_id, organization_id, locale, channel, whatsapp_phone')
            .eq('ticket_id', ticket.id)
            .eq('state', 'active')
            .eq('channel', 'whatsapp')
            .maybeSingle();

          if (existingForTicket) {
            // Already have a session — keep its locale, just update phone/bsuid
            // to the canonical form so future lookups hit immediately.
            await supabase.from('whatsapp_sessions')
              .update({ whatsapp_phone: normIdentifier, whatsapp_bsuid: bsuid || null })
              .eq('id', existingForTicket.id);
            allSessions.push({ ...existingForTicket, whatsapp_phone: normIdentifier });
            linkedTicketIds.add(ticket.id);
            continue;
          }

          // No existing session — create one. Locale: use customer's
          // ticket-time language hint if any, else fallback. Race-safe via
          // the unique partial index on (ticket_id) where state='active'.
          const { data: newSession, error: insertErr } = await supabase
            .from('whatsapp_sessions')
            .insert({
              organization_id: orgId,
              ticket_id: ticket.id,
              channel: 'whatsapp',
              whatsapp_phone: normIdentifier,
              whatsapp_bsuid: bsuid || null,
              state: 'active',
              locale: fallbackLocale,
            })
            .select('id, ticket_id, organization_id, locale, channel, whatsapp_phone')
            .single();

          if (insertErr) {
            // Race lost to another insert — fetch the winner instead
            const { data: winner } = await supabase
              .from('whatsapp_sessions')
              .select('id, ticket_id, organization_id, locale, channel, whatsapp_phone')
              .eq('ticket_id', ticket.id)
              .eq('state', 'active')
              .maybeSingle();
            if (winner) {
              allSessions.push(winner);
              linkedTicketIds.add(ticket.id);
            }
            continue;
          }

          if (newSession) {
            allSessions.push(newSession);
            linkedTicketIds.add(ticket.id);
          }
        }
      }
    }
  }

  if (allSessions.length === 0) return [];

  // Fetch all org names in one query
  const orgIds = [...new Set(allSessions.map((s: any) => s.organization_id))];
  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, settings')
    .in('id', orgIds);

  const orgMap = new Map<string, any>((orgs ?? []).map((o: any) => [o.id, o]));

  return allSessions
    .filter((s: any) => orgMap.has(s.organization_id))
    .map((s: any) => {
      const o = orgMap.get(s.organization_id)!;
      return {
        session: s,
        org: { id: o.id, name: o.name, settings: (o.settings ?? {}) as Record<string, any> },
      };
    });
}

export const positionLabel: Record<Locale, string> = {
  fr: 'Position',
  ar: 'الترتيب',
  en: 'Position',
  ja: 'Position',
  ko: 'Position',
  vi: 'Position',
};
export const nowServingLabel: Record<Locale, string> = {
  fr: 'En service',
  ar: 'يُخدم الآن',
  en: 'Now serving',
  ja: 'Now serving',
  ko: 'Now serving',
  vi: 'Now serving',
};
export const minLabel: Record<Locale, string> = {
  fr: 'min',
  ar: 'دقيقة',
  en: 'min',
  ja: 'min',
  ko: 'min',
  vi: 'min',
};

/** Fetch ticket number, service name, join time, and tracking URL for the already_in_queue message. */
async function fetchTicketContext(ticketId: string, locale: Locale): Promise<{ ticket: string; service: string; joined: string; url: string }> {
  const supabase = createAdminClient() as any;
  const { data: t } = await supabase
    .from('tickets')
    .select('ticket_number, created_at, qr_token, services(name), offices(organization:organizations(timezone))')
    .eq('id', ticketId)
    .maybeSingle();
  const ticketNum = t?.ticket_number ? String(t.ticket_number) : '—';
  const serviceName: string = t?.services?.name || '';
  // Use org-level timezone as single source of truth
  const tz: string = (t?.offices as any)?.organization?.timezone || 'Africa/Algiers';
  let joined = '';
  if (t?.created_at) {
    try {
      const d = new Date(t.created_at);
      const localeTag = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-GB';
      joined = new Intl.DateTimeFormat(localeTag, {
        timeZone: tz, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit',
      }).format(d);
    } catch { joined = new Date(t.created_at).toLocaleString(); }
  }
  const serviceLine = serviceName
    ? (locale === 'fr' ? `\n👨‍⚕️ Service : *${serviceName}*`
      : locale === 'ar' ? `\n👨‍⚕️ الخدمة: *${serviceName}*`
      : `\n👨‍⚕️ Service: *${serviceName}*`)
    : '';
  const baseUrl = APP_BASE_URL;
  const url = t?.qr_token ? `${baseUrl}/q/${t.qr_token}` : '';
  return { ticket: ticketNum, service: serviceLine, joined, url };
}

export function formatPosition(pos: any, locale: Locale): string {
  if (pos.position == null) return '';
  if (locale === 'ar') {
    return `${positionLabel[locale]}: *${pos.position}* | ~*${pos.estimated_wait_minutes ?? '?'} ${minLabel[locale]}* ⏱ 📍`;
  }
  return `📍 ${positionLabel[locale]}: *${pos.position}* | ⏱ ~*${pos.estimated_wait_minutes ?? '?'} ${minLabel[locale]}*`;
}

export function formatNowServing(pos: any, locale: Locale): string {
  if (!pos.now_serving) return '';
  if (locale === 'ar') {
    return `${nowServingLabel[locale]}: *${pos.now_serving}* 📢\n`;
  }
  return `📢 ${nowServingLabel[locale]}: *${pos.now_serving}*\n`;
}

/** Look up the user's most recent session locale (active or completed) */
async function getLastSessionLocale(
  identifier: string, channel: Channel, bsuid?: string,
): Promise<Locale | null> {
  const supabase = createAdminClient() as any;
  const idCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
  const { data } = await supabase
    .from('whatsapp_sessions')
    .select('locale')
    .eq(idCol, identifier)
    .eq('channel', channel)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.locale) return data.locale as Locale;

  // Try BSUID fallback for WhatsApp
  if (!data && channel === 'whatsapp' && bsuid) {
    const { data: bsuidData } = await supabase
      .from('whatsapp_sessions')
      .select('locale')
      .eq('whatsapp_bsuid', bsuid)
      .eq('channel', 'whatsapp')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (bsuidData?.locale) return bsuidData.locale as Locale;
  }

  return null;
}

// ── Main entry point (channel-agnostic) ──────────────────────────────

export async function handleInboundMessage(
  channel: Channel,
  identifier: string,
  messageBody: string,
  sendMessage: SendFn,
  profileName?: string,
  bsuid?: string,
  /** Optional WhatsApp location-share payload — forwarded to the in-WA
   *  ordering flow so customers can drop a pin instead of typing the
   *  street at the address step. */
  locationData?: { latitude: number; longitude: number; name?: string; address?: string },
): Promise<void> {
  // Strip invisible Unicode characters (ZWJ, ZWNJ, LTR/RTL marks, BOM, Arabic marks, diacritics, etc.)
  // Then normalize Arabic Alef variants (أ إ آ ٱ → ا) and Taa Marbuta/Haa (ه ← ة kept distinct)
  const cleaned = messageBody.trim()
    .replace(/[\u00AD\u061C\u064B-\u0652\u0670\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .trim();
  const command = cleaned.toUpperCase();
  const detectedLocale = detectLocale(cleaned);

  // ── Pending language selection (1=ar, 2=fr, 3=en) ──
  {
    const supabaseLang = createAdminClient() as any;
    const identColLang = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: langSession } = await supabaseLang
      .from('whatsapp_sessions')
      .select('id, locale')
      .eq(identColLang, identifier)
      .eq('state', 'pending_language')
      .eq('channel', channel)
      .gte('created_at', new Date(Date.now() - PENDING_JOIN_TTL_MINUTES * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (langSession) {
      let chosenLocale: Locale | null = null;
      if (cleaned === '1') chosenLocale = 'ar';
      else if (cleaned === '2') chosenLocale = 'fr';
      else if (cleaned === '3') chosenLocale = 'en';

      if (chosenLocale) {
        // Save preference and delete the pending session
        await supabaseLang.from('whatsapp_sessions').delete().eq('id', langSession.id);
        // Update any existing sessions for this user with the chosen locale
        await supabaseLang.from('whatsapp_sessions')
          .update({ locale: chosenLocale })
          .eq(identColLang, identifier)
          .eq('channel', channel);
        // Cache the locale
        setDirectoryLocale(identifier, chosenLocale);
        // Send welcome in the chosen language
        await sendMessage({ to: identifier, body: t('welcome', chosenLocale) });
        return;
      }
      // Not 1/2/3 — delete pending session and fall through to normal processing
      await supabaseLang.from('whatsapp_sessions').delete().eq('id', langSession.id);
    }
  }

  // ── Rider commands (in-house delivery roster) ───────────────────
  // Runs BEFORE the customer order flow so a rider's "ACCEPT 1" /
  // "DONE" / "CHECK Fix" command takes priority over any customer
  // session that might exist on the same phone (rare in practice but
  // possible for a rider who also orders takeout from the bot).
  // No-op if the inbound phone doesn't match an active rider row.
  if (channel === 'whatsapp') {
    const { tryHandleRiderInbound } = await import('@/lib/whatsapp-rider-commands');
    const riderResult = await tryHandleRiderInbound({
      fromPhone: identifier,
      body: messageBody,
      sendMessage: async ({ to, body }) => sendMessage({ to, body }),
    });
    if (riderResult.handled) return;
  }

  // ── Active in-WhatsApp ordering session ─────────────────────────
  // Runs BEFORE the JOIN/booking handlers so cart codes ("1 3 5x2") and
  // confirm replies ("YES") don't accidentally collide with quick-action
  // commands or queue intake. tryHandleWhatsappOrderState looks up an
  // active pending_order_* session for this identifier and dispatches
  // to the appropriate state handler. Returns true when handled.
  if (channel === 'whatsapp') {
    const handledByOrder = await tryHandleWhatsappOrderState(
      identifier, channel, messageBody, sendMessage, locationData,
    );
    if (handledByOrder) return;
  }

  // ── Pending join confirmation (YES/OUI/نعم or NO/NON/لا) ──
  // Check DB for a pending_confirmation session for this user
  {
    const supabaseCheck = createAdminClient() as any;
    const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: pendingSession } = await supabaseCheck
      .from('whatsapp_sessions')
      .select('id, organization_id, locale, channel, office_id, department_id, service_id, virtual_queue_code_id, whatsapp_phone, whatsapp_bsuid, messenger_psid, booking_customer_name, custom_intake_data, created_at')
      .eq(identCol, identifier)
      .eq('state', 'pending_confirmation')
      .eq('channel', channel)
      .gte('created_at', new Date(Date.now() - PENDING_JOIN_TTL_MINUTES * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingSession) {
      const isYes = /^(OUI|YES|نعم|Y|O|1|OK|CONFIRM|CONFIRMER|تاكيد|تأكيد)$/i.test(cleaned);
      const isNo = /^(NON|NO|لا|N|0|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);
      // If user replies in Arabic script, override locale to 'ar' (auto-switch language)
      const hasArabicReply = /[\u0600-\u06FF]/.test(cleaned);
      const pendingLocale: Locale = hasArabicReply ? 'ar' : ((pendingSession.locale as Locale) || 'fr');
      if (hasArabicReply && pendingSession.locale !== 'ar') {
        await supabaseCheck.from('whatsapp_sessions').update({ locale: 'ar' }).eq('id', pendingSession.id);
      }

      if (isYes) {
        const { data: orgRow } = await supabaseCheck
          .from('organizations').select('id, name, settings').eq('id', pendingSession.organization_id).single();
        if (orgRow) {
          const preResolved = pendingSession.office_id && pendingSession.department_id && pendingSession.service_id
            ? { officeId: pendingSession.office_id, departmentId: pendingSession.department_id, serviceId: pendingSession.service_id }
            : undefined;
          // Unified intake answers — profileName is passed as fallback (handleJoin uses it if name not in answers)
          const customData = (pendingSession.custom_intake_data as any)?.answers ?? {};
          // Legacy compat: if name was stored in booking_customer_name but not in answers, add it
          if (pendingSession.booking_customer_name && !customData.name) {
            customData.name = pendingSession.booking_customer_name;
          }
          await handleJoin(identifier, orgRow as OrgContext, pendingLocale, channel, sendMessage, profileName, bsuid, preResolved, undefined, customData);
          await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
        } else {
          await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
          await sendMessage({ to: identifier, body: t('join_failed', pendingLocale) });
        }
        return;
      }
      if (isNo) {
        await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', pendingLocale) });
        return;
      }
      // Something else — check if it's an explicit command that should exit the flow
      const isExplicitCommand = /^(JOIN|REJOINDRE|انضم|BOOK|RESERVER|احجز|CANCEL|ANNULER|الغاء|STATUS|STATUT|حالة|HELP|AIDE|مساعدة|LIST|LISTE|قائمة)\b/i.test(command);
      if (isExplicitCommand) {
        // Delete session and fall through to handle the command
        await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
      } else {
        // Not a command — re-prompt (protects against Meta duplicate webhooks)
        const { data: orgForReprompt } = await supabaseCheck
          .from('organizations').select('name').eq('id', pendingSession.organization_id).single();
        await sendMessage({ to: identifier, body: t('confirm_join', pendingLocale, { name: orgForReprompt?.name ?? '?' }) });
        return;
      }
    }
  }

  // ── Awaiting name input for join flow ──
  {
    const supabaseName = createAdminClient() as any;
    const identColN = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: nameSession } = await supabaseName
      .from('whatsapp_sessions')
      .select('id, organization_id, locale, channel, office_id, department_id, service_id, virtual_queue_code_id, whatsapp_phone, whatsapp_bsuid, messenger_psid')
      .eq(identColN, identifier)
      .eq('state', 'pending_join_name')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (nameSession) {
      const nameLocale: Locale = (nameSession.locale as Locale) || 'fr';

      // Cancel on 0
      if (cleaned === '0') {
        await supabaseName.from('whatsapp_sessions').delete().eq('id', nameSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', nameLocale) });
        return;
      }

      // Guard: reject YES/NO confirmation keywords — this is a Meta duplicate
      // webhook replaying the same "YES" that triggered the state transition.
      // Re-prompt for the actual name instead of using "YES" as the customer name.
      const isConfirmKeyword = /^(OUI|YES|نعم|Y|O|1|OK|CONFIRM|CONFIRMER|تاكيد|تأكيد|NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);
      if (isConfirmKeyword) {
        await sendMessage({ to: identifier, body: t('join_enter_name', nameLocale) });
        return;
      }

      // Validate name (2-100 chars)
      if (cleaned.length < 2 || cleaned.length > 100) {
        await sendMessage({ to: identifier, body: t('join_enter_name', nameLocale) });
        return;
      }

      // Name is valid — store it and move to confirmation step
      const { data: orgRow } = await supabaseName
        .from('organizations').select('id, name, settings').eq('id', nameSession.organization_id).single();
      if (orgRow) {
        const customFields: any[] = (orgRow.settings as any)?.custom_intake_fields ?? [];
        if (customFields.length > 0) {
          // Chain to custom intake fields
          await supabaseName.from('whatsapp_sessions').update({
            state: 'pending_custom_intake',
            booking_customer_name: cleaned,
            custom_intake_data: { index: 0, answers: {} },
          }).eq('id', nameSession.id);
          const firstField = customFields[0];
          const fieldLabel = nameLocale === 'ar' ? (firstField.label_ar || firstField.label) : nameLocale === 'fr' ? (firstField.label_fr || firstField.label) : firstField.label;
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', nameLocale, { field: fieldLabel }) });
        } else {
          await supabaseName.from('whatsapp_sessions').update({
            state: 'pending_confirmation',
            booking_customer_name: cleaned,
          }).eq('id', nameSession.id);
          await sendMessage({ to: identifier, body: t('confirm_join', nameLocale, { name: orgRow.name }) });
        }
      } else {
        await supabaseName.from('whatsapp_sessions').delete().eq('id', nameSession.id);
        await sendMessage({ to: identifier, body: t('join_failed', nameLocale) });
      }
      return;
    }
  }

  // ── Awaiting custom intake field input ──
  {
    const supabaseCustom = createAdminClient() as any;
    const identColC = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: customSession } = await supabaseCustom
      .from('whatsapp_sessions')
      .select('id, organization_id, locale, channel, office_id, department_id, service_id, custom_intake_data, booking_customer_name, booking_date, booking_time, booking_customer_wilaya, intake_reason')
      .eq(identColC, identifier)
      .eq('state', 'pending_custom_intake')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (customSession) {
      const customLocale: Locale = (customSession.locale as Locale) || 'fr';

      // Cancel on 0
      if (cleaned === '0') {
        await supabaseCustom.from('whatsapp_sessions').delete().eq('id', customSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', customLocale) });
        return;
      }

      // Load org settings for fields (unified intake_fields system)
      const { data: orgRow } = await supabaseCustom.from('organizations').select('id, name, settings').eq('id', customSession.organization_id).single();
      if (!orgRow) {
        await supabaseCustom.from('whatsapp_sessions').delete().eq('id', customSession.id);
        await sendMessage({ to: identifier, body: t('join_failed', customLocale) });
        return;
      }

      // Determine context from session: booking has booking_date, otherwise same-day join
      const intakeContext = customSession.booking_date ? 'booking' as const : 'sameday' as const;
      // Phone auto-collected on WhatsApp only, not Messenger
      const intakePhoneExclude = channel === 'whatsapp' ? ['phone'] : [];
      const enabledFields = getEnabledIntakeFields((orgRow.settings ?? {}) as Record<string, any>, intakePhoneExclude, intakeContext);
      const cData = (customSession.custom_intake_data as any) ?? { index: 0, answers: {} };
      const currentIndex = cData.index ?? 0;
      const answers = cData.answers ?? {};
      const currentField: IntakeField | undefined = enabledFields[currentIndex];

      if (!currentField) {
        // No field at this index — skip to next state
        await supabaseCustom.from('whatsapp_sessions').delete().eq('id', customSession.id);
        await sendMessage({ to: identifier, body: t('join_failed', customLocale) });
        return;
      }

      // Guard: reject YES/NO confirmation keywords (Meta duplicate webhook)
      const isConfirmKeyword = /^(OUI|YES|نعم|Y|O|1|OK|CONFIRM|CONFIRMER|تاكيد|تأكيد|NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);
      if (isConfirmKeyword) {
        const fieldLabel = getFieldLabel(currentField, customLocale);
        await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
        return;
      }

      // Per-field validation based on key
      const fieldKey = currentField.key;
      if (fieldKey === 'name') {
        // Name: 2-100 chars
        if (cleaned.length < 2 || cleaned.length > 100) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = cleaned;
      } else if (fieldKey === 'phone') {
        // Phone: basic format validation
        const phoneDigits = cleaned.replace(/[^0-9+]/g, '');
        if (phoneDigits.length < 6 || phoneDigits.length > 20) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = cleaned;
      } else if (fieldKey === 'age') {
        // Age: numeric, 1-150
        const ageNum = parseInt(cleaned, 10);
        if (isNaN(ageNum) || ageNum < 1 || ageNum > 150) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = String(ageNum);
      } else if (fieldKey === 'party_size') {
        // Party size: numeric, 1-50. Restaurants need this; other verticals
        // (clinics for family, banks for group appointments) can opt in too.
        const size = parseInt(cleaned, 10);
        if (isNaN(size) || size < 1 || size > 50) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = String(size);
      } else if (fieldKey === 'email') {
        // Email: RFC-5322-ish regex + length guard. Keep permissive — the
        // real validation happens server-side when email OTP is used; here
        // we just catch obvious typos so the bot doesn't silently store
        // garbage like "yes" or "idk".
        const trimmed = cleaned.trim().toLowerCase();
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 254;
        if (!emailOk) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = trimmed;
      } else if (fieldKey === 'wilaya') {
        // Wilaya: use resolveWilaya + formatWilaya
        const resolved = resolveWilaya(messageBody);
        if (!resolved) {
          await sendMessage({ to: identifier, body: t('intake_invalid_wilaya', customLocale) });
          return;
        }
        answers[fieldKey] = formatWilayaLocale(resolved, customLocale);
      } else if (fieldKey === 'reason') {
        // Reason: 1-200 chars, allow SKIP/PASSER/تخطي
        const isSkip = /^(SKIP|PASSER|تخطي)$/i.test(cleaned);
        if (isSkip) {
          answers[fieldKey] = '';
        } else if (cleaned.length < 1 || cleaned.length > 200) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        } else {
          answers[fieldKey] = cleaned;
        }
      } else {
        // Custom fields: 1-200 chars
        if (cleaned.length < 1 || cleaned.length > 200) {
          const fieldLabel = getFieldLabel(currentField, customLocale);
          await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: fieldLabel }) });
          return;
        }
        answers[fieldKey] = cleaned;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex < enabledFields.length) {
        // More fields to collect
        await supabaseCustom.from('whatsapp_sessions').update({
          custom_intake_data: { index: nextIndex, answers },
        }).eq('id', customSession.id);
        const nextField = enabledFields[nextIndex];
        const nextLabel = getFieldLabel(nextField, customLocale);
        await sendMessage({ to: identifier, body: t('custom_intake_prompt', customLocale, { field: nextLabel }) });
      } else {
        // All fields collected
        if (customSession.booking_date) {
          // BOOK flow → go to booking_confirm
          await supabaseCustom.from('whatsapp_sessions').update({
            state: 'booking_confirm',
            custom_intake_data: { index: nextIndex, answers },
          }).eq('id', customSession.id);
          const orgName = orgRow.name;
          const dateFormatted = formatDateForLocale(customSession.booking_date, customLocale);
          const mergedAnswers = { ...answers, name: answers.name || customSession.booking_customer_name, wilaya: answers.wilaya || customSession.booking_customer_wilaya, reason: answers.reason || customSession.intake_reason };
          await sendMessage({
            to: identifier,
            body: t('booking_confirm', customLocale, {
              name: orgName,
              date: dateFormatted,
              time: customSession.booking_time,
              fields: buildBookingFieldsSummary(mergedAnswers, (orgRow.settings ?? {}) as Record<string, any>, customLocale, channel),
            }),
          });
        } else {
          // JOIN flow → go to pending_confirmation
          await supabaseCustom.from('whatsapp_sessions').update({
            state: 'pending_confirmation',
            custom_intake_data: { index: nextIndex, answers },
          }).eq('id', customSession.id);
          await sendMessage({ to: identifier, body: t('confirm_join', customLocale, { name: orgRow.name }) });
        }
      }
      return;
    }
  }

  // ── Awaiting intake (wilaya / reason of visit) ──
  {
    const supabaseIntake = createAdminClient() as any;
    const identColIntake = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: intakeSession } = await supabaseIntake
      .from('whatsapp_sessions')
      .select('id, organization_id, office_id, department_id, service_id, virtual_queue_code_id, state, locale, channel, intake_wilaya, intake_reason')
      .eq(identColIntake, identifier)
      .in('state', ['awaiting_intake_wilaya', 'awaiting_intake_reason'])
      .eq('channel', channel)
      .gte('created_at', new Date(Date.now() - PENDING_JOIN_TTL_MINUTES * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (intakeSession) {
      const intakeLocale = (intakeSession.locale as Locale) || detectedLocale;
      const isCancel = /^(0|NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);
      if (isCancel) {
        await supabaseIntake.from('whatsapp_sessions').delete().eq('id', intakeSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', intakeLocale) });
        return;
      }

      if (intakeSession.state === 'awaiting_intake_wilaya') {
        const resolved = resolveWilaya(messageBody);
        if (!resolved) {
          await sendMessage({ to: identifier, body: t('intake_invalid_wilaya', intakeLocale) });
          return;
        }
        const canonical = formatWilayaLocale(resolved, intakeLocale);
        await supabaseIntake
          .from('whatsapp_sessions')
          .update({ intake_wilaya: canonical, state: 'awaiting_intake_reason' })
          .eq('id', intakeSession.id);
        await sendMessage({ to: identifier, body: t('ask_reason', intakeLocale) });
        return;
      }

      if (intakeSession.state === 'awaiting_intake_reason') {
        const raw = messageBody.trim();
        const isSkip = /^SKIP$/i.test(raw);
        const reason = isSkip ? '' : raw;
        if (reason.length > 200) {
          await sendMessage({ to: identifier, body: t('intake_invalid_reason', intakeLocale) });
          return;
        }
        // Persist the reason on the session, then look up org and join
        await supabaseIntake
          .from('whatsapp_sessions')
          .update({ intake_reason: reason || null })
          .eq('id', intakeSession.id);

        const { data: orgRow } = await supabaseIntake
          .from('organizations').select('id, name, settings').eq('id', intakeSession.organization_id).single();
        if (!orgRow) {
          await supabaseIntake.from('whatsapp_sessions').delete().eq('id', intakeSession.id);
          await sendMessage({ to: identifier, body: t('join_failed', intakeLocale) });
          return;
        }

        const preResolved = intakeSession.office_id && intakeSession.department_id && intakeSession.service_id
          ? { officeId: intakeSession.office_id, departmentId: intakeSession.department_id, serviceId: intakeSession.service_id }
          : undefined;

        await handleJoin(
          identifier,
          orgRow as OrgContext,
          intakeLocale,
          channel,
          sendMessage,
          profileName,
          bsuid,
          preResolved,
          { wilaya: intakeSession.intake_wilaya || undefined, reason: reason || undefined },
        );
        // handleJoin creates the active session; remove the intake placeholder
        await supabaseIntake.from('whatsapp_sessions').delete().eq('id', intakeSession.id);
        return;
      }
    }
  }

  // ── Pending department / service selection ──
  {
    const supabaseSel = createAdminClient() as any;
    const identColSel = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: selSession } = await supabaseSel
      .from('whatsapp_sessions')
      .select('id, organization_id, office_id, department_id, state, locale, channel')
      .eq(identColSel, identifier)
      .in('state', ['pending_department', 'pending_service'])
      .eq('channel', channel)
      .gte('created_at', new Date(Date.now() - PENDING_JOIN_TTL_MINUTES * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selSession) {
      const selLocale = (selSession.locale as Locale) || detectedLocale;
      const numMatch = cleaned.match(/^(\d{1,2})$/);
      const isCancel = /^(NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);

      if (isCancel) {
        await supabaseSel.from('whatsapp_sessions').delete().eq('id', selSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', selLocale) });
        return;
      }

      if (numMatch) {
        const idx = parseInt(numMatch[1], 10);

        if (idx === 0) {
          if (selSession.state === 'pending_service') {
            // Go back to department list
            await handleBackToDepartments(selSession, identifier, selLocale, channel, sendMessage);
            return;
          }
          // In pending_department, 0 = cancel
          await supabaseSel.from('whatsapp_sessions').delete().eq('id', selSession.id);
          await sendMessage({ to: identifier, body: t('confirm_join_cancelled', selLocale) });
          return;
        }

        try {
          if (selSession.state === 'pending_department') {
            await handleDepartmentChoice(selSession, idx, identifier, selLocale, channel, sendMessage, profileName, bsuid);
            return;
          }
          if (selSession.state === 'pending_service') {
            await handleServiceChoice(selSession, idx, identifier, selLocale, channel, sendMessage, profileName, bsuid);
            return;
          }
        } catch (err: any) {
          // If the choice handler fails, always claim the message so we
          // don't fall through to the directory / category matcher — the
          // user's "1" meant "service #1", not "category #1".
          console.error('[messaging] pending selection handler error', {
            state: selSession.state, err: err?.message,
          });
          await sendMessage({ to: identifier, body: t('invalid_choice', selLocale) });
          return;
        }
      }

      // Invalid input — keep session, ask again
      await sendMessage({ to: identifier, body: t('invalid_choice', selLocale) });
      return;
    }
  }

  // ── Pending booking states ──
  {
    const supabaseBook = createAdminClient() as any;
    const identColBook = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: bookSession } = await supabaseBook
      .from('whatsapp_sessions')
      .select('id, organization_id, office_id, department_id, service_id, state, locale, channel, booking_date, booking_time, booking_customer_name, booking_customer_wilaya, intake_reason')
      .eq(identColBook, identifier)
      .in('state', ['booking_select_service', 'booking_select_date', 'booking_select_time', 'booking_enter_name', 'booking_enter_phone', 'booking_enter_wilaya', 'booking_enter_reason', 'booking_confirm', 'pending_custom_intake'])
      .eq('channel', channel)
      .gte('last_message_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()) // 15 min TTL since last interaction
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bookSession) {
      const bookLocale = (bookSession.locale as Locale) || detectedLocale;

      // Free-text input states (name/wilaya/reason/phone/confirm): route to handler
      // UNLESS the message is a clear explicit command that should exit the booking flow
      const isFreeTextState = ['booking_enter_name', 'booking_enter_wilaya', 'booking_enter_reason', 'booking_enter_phone', 'booking_confirm', 'pending_custom_intake'].includes(bookSession.state);

      // Explicit commands that should always break out of any booking flow.
      // JOIN/STATUS/CANCEL/HELP/LIST are always commands (nobody types "join" as a reason).
      // BOOK/RDV/موعد only breaks out if alone or followed by a Latin code (not Arabic free text).
      const alwaysCmd = /^(JOIN|REJOINDRE|انضم)\s/i.test(command) ||
        /^(STATUS|STATUT|حالة|HELP|AIDE|مساعدة|LIST|LISTE|القائمة|CANCEL|ANNULER|الغاء|إلغاء|MY BOOKINGS|MES RDV|مواعيدي|حجوزاتي)$/i.test(command) ||
        /^(CANCEL\s+BOOKING|ANNULER\s+RDV)/i.test(command);
      const bookCmdParsed = parseBookingCode(cleaned);
      const bookCmdValid = bookCmdParsed && !bookCmdParsed.code.includes(' ');
      const bookAlone = /^(BOOK|BOOKING|RESERVE|RDV|RESERVER|RESERVATION|موعد|حجز|احجز)$/i.test(cleaned);

      // In free-text states, if the code is Arabic text, verify it's a real org
      // before breaking out — "حجز موعد" is a reason, not a command
      let isExplicitCmd = alwaysCmd || bookAlone;
      if (!isExplicitCmd && bookCmdValid) {
        const hasArabicCode = /[\u0600-\u06FF]/.test(bookCmdParsed!.code);
        if (hasArabicCode && isFreeTextState) {
          // Only treat as command if it matches a real org
          const matchedOrg = await findOrgByCode(bookCmdParsed!.code, channel);
          isExplicitCmd = !!matchedOrg;
        } else {
          isExplicitCmd = true;
        }
      }

      // In free-text states, only exit if it's an explicit command
      if (isFreeTextState && isExplicitCmd) {
        // Delete booking session and let the command be processed normally below
        await supabaseBook.from('whatsapp_sessions').delete().eq('id', bookSession.id);
      } else if (isFreeTextState) {
        // Not a command — treat as free-text input
        const handled = await handleBookingState(bookSession, cleaned, identifier, bookLocale, channel, sendMessage);
        if (handled) return;
      } else {
        // Selection states (service/date/time)
        const isNewBookCmd = !!parseBookingCode(cleaned) ||
          /^(BOOK|BOOKING|RESERVE|RDV|RESERVER|RESERVATION|موعد|حجز|احجز)$/i.test(cleaned);

        if (!isNewBookCmd) {
          const isCancel = /^(0|NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);

          if (isCancel && bookSession.state !== 'booking_confirm') {
            await supabaseBook.from('whatsapp_sessions').delete().eq('id', bookSession.id);
            await sendMessage({ to: identifier, body: t('booking_cancelled', bookLocale) });
            return;
          }

          const handled = await handleBookingState(bookSession, cleaned, identifier, bookLocale, channel, sendMessage);
          if (handled) return;
        }
      }
    }
  }

  // ── YES/NO opt-in for in-house tickets (active sessions) ──
  // When an in-house ticket is created, the customer gets a "joined" message
  // with "Reply YES for live alerts". Their reply opens the 24h conversation
  // window (making subsequent notifications free). NO opts them out.
  {
    // Note: "1" and "0" are excluded — they collide with the quick-action menu (1=STATUS, 2=CANCEL).
    const isYes = /^(OUI|YES|نعم|Y|OK|CONFIRM|CONFIRMER|تاكيد|تأكيد)$/i.test(cleaned);
    const isNo = /^(NON|NO|لا|N)$/i.test(cleaned);

    if (isYes || isNo) {
      const supabaseOptIn = createAdminClient() as any;
      const identColOpt = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
      const { data: activeSession } = await supabaseOptIn
        .from('whatsapp_sessions')
        .select('id, ticket_id, locale, channel')
        .eq(identColOpt, identifier)
        .eq('state', 'active')
        .eq('channel', channel)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSession && activeSession.ticket_id) {
        const activeLocale = (activeSession.locale as Locale) || 'fr';
        // Look up ticket number for the message
        const { data: ticketRow } = await supabaseOptIn
          .from('tickets').select('ticket_number').eq('id', activeSession.ticket_id).single();
        const ticketNum = ticketRow?.ticket_number ?? '';

        if (isYes) {
          await sendMessage({ to: identifier, body: t('opt_in_confirmed', activeLocale, { ticket: ticketNum }) });
          return;
        }
        if (isNo) {
          // Opt out: mark session completed so no more notifications are sent
          await supabaseOptIn.from('whatsapp_sessions')
            .update({ state: 'completed' })
            .eq('id', activeSession.id);
          await sendMessage({ to: identifier, body: t('opt_out_confirmed', activeLocale, { ticket: ticketNum }) });
          return;
        }
      }
    }
  }

  // ── TRACK <token> (link WhatsApp/Messenger to existing ticket) ──
  // Accepts: TRACK qflo_TOKEN or TRACK TOKEN (from m.me deep link)
  if (command.startsWith('TRACK ')) {
    let qrToken = messageBody.trim().substring('TRACK '.length).trim();
    // Strip qflo_ prefix if present
    if (qrToken.toLowerCase().startsWith('qflo_')) {
      qrToken = qrToken.substring('qflo_'.length);
    }
    if (qrToken) {
      await handleTrackLink(identifier, qrToken, detectedLocale, channel, sendMessage, profileName, bsuid);
      return;
    }
  }

  // ── LIST / LISTE / قائمة / DIRECTORY / دليل ──
  const isListCommand = command === 'LIST' || command === 'LISTE' || command === 'DIRECTORY'
    || /^(قائمة|القائمة|دليل|الفهرس)$/.test(cleaned);
  if (isListCommand) {
    // Remember this user's locale so follow-up bare number replies use it
    setDirectoryLocale(identifier, detectedLocale);
    await handleDirectory(identifier, detectedLocale, channel, sendMessage);
    return;
  }

  // ── Quick-action numbers: "1" = STATUS, "2" = CANCEL (only if user has active session) ──
  if (command === '1' || command === '2') {
    const quickSessions = await findAllActiveSessionsByUser(identifier, channel, bsuid, detectedLocale);
    if (quickSessions.length > 0) {
      if (command === '1') {
        // Route to STATUS
        if (quickSessions.length === 1) {
          const { session, org } = quickSessions[0];
          const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((session.locale as Locale) || detectedLocale);
          await handleStatus(identifier, org, sessionLocale, channel, sendMessage, session);
        } else {
          await handleMultiStatus(identifier, quickSessions, detectedLocale, channel, sendMessage);
        }
        return;
      }
      if (command === '2') {
        // Route to CANCEL
        if (quickSessions.length === 1) {
          const { session, org } = quickSessions[0];
          const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((session.locale as Locale) || detectedLocale);
          await handleCancel(identifier, org, sessionLocale, channel, sendMessage, session);
        } else {
          await handleCancelPick(identifier, quickSessions, detectedLocale, channel, sendMessage);
        }
        return;
      }
    }
  }

  // ── Category selection (e.g. "3") or direct join (e.g. "3-2") ──
  const catJoinMatch = command.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);
  if (catJoinMatch) {
    const catNum = parseInt(catJoinMatch[1], 10);
    const bizNum = catJoinMatch[2] ? parseInt(catJoinMatch[2], 10) : null;
    // Only handle if the number could be a category index (1-based)
    if (catNum >= 1 && catNum <= BUSINESS_CATEGORIES.length) {
      // Bare numbers have no language signal — check directory locale cache first,
      // then fall back to last session locale
      let numLocale = detectedLocale;
      if (numLocale === 'fr') {
        const dirLocale = getDirectoryLocale(identifier);
        if (dirLocale) {
          numLocale = dirLocale;
        } else {
          const lastLocale = await getLastSessionLocale(identifier, channel, bsuid);
          if (lastLocale) numLocale = lastLocale;
        }
      }
      const handled = await handleCategoryOrJoin(identifier, numLocale, channel, sendMessage, catNum, bizNum, profileName, bsuid);
      if (handled) return;
    }
  }

  // ── STATUS / STATUT / حالة ──
  if (command === 'STATUS' || command === 'STATUT' || /^حالة$/.test(cleaned)) {
    const allSessions = await findAllActiveSessionsByUser(identifier, channel, bsuid, detectedLocale);
    if (allSessions.length === 0) {
      // No active ticket session — check for upcoming confirmed/pending appointments
      // across all orgs the customer may have booked with.
      const supabaseAdmin = createAdminClient() as any;
      const apptFound = await findAndReplyAppointmentStatus(identifier, detectedLocale, channel, sendMessage, supabaseAdmin);
      if (!apptFound) {
        await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
      }
    } else if (allSessions.length === 1) {
      const { session, org } = allSessions[0];
      const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((session.locale as Locale) || detectedLocale);
      await handleStatus(identifier, org, sessionLocale, channel, sendMessage, session);
    } else {
      await handleMultiStatus(identifier, allSessions, detectedLocale, channel, sendMessage);
    }
    return;
  }

  // ── CANCEL / ANNULER / إلغاء (with optional number or ALL) ──
  const cancelMatch = command.match(/^(CANCEL|ANNULER)\s*(ALL|TOUT)?(?:\s+(\d+))?$/);
  const cancelAr = cleaned.match(/^الغاء\s*(الكل)?(?:\s*(\d+))?$/);
  if (cancelMatch || cancelAr) {
    const isAll = cancelMatch ? !!cancelMatch[2] : (cancelAr ? !!cancelAr[1] : false);
    const cancelIdx = cancelMatch?.[3] ? parseInt(cancelMatch[3], 10) : (cancelAr?.[2] ? parseInt(cancelAr[2], 10) : null);

    const allSessions = await findAllActiveSessionsByUser(identifier, channel, bsuid, detectedLocale);
    if (allSessions.length === 0) {
      // No active session — try to find and cancel a pending_approval ticket directly
      const supabaseAdmin = createAdminClient() as any;
      const cancelled = await cancelPendingTicketByPhone(identifier, detectedLocale, channel, sendMessage, supabaseAdmin);
      if (!cancelled) {
        await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
      }
    } else if (isAll) {
      // Cancel all active sessions
      await handleCancelAll(identifier, allSessions, detectedLocale, channel, sendMessage);
    } else if (cancelIdx !== null) {
      // Cancel specific session by index
      if (cancelIdx >= 1 && cancelIdx <= allSessions.length) {
        const { session, org } = allSessions[cancelIdx - 1];
        const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((session.locale as Locale) || detectedLocale);
        await handleCancel(identifier, org, sessionLocale, channel, sendMessage, session);
      } else {
        await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
      }
    } else if (allSessions.length === 1) {
      const { session, org } = allSessions[0];
      const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((session.locale as Locale) || detectedLocale);
      await handleCancel(identifier, org, sessionLocale, channel, sendMessage, session);
    } else {
      // Multiple sessions — ask which one to cancel
      await handleCancelPick(identifier, allSessions, detectedLocale, channel, sendMessage);
    }
    return;
  }

  // ── Greeting ("Hi", "Salut", "سلام", optionally + business code) ──
  // Fires when a customer scans the in-house booking deeplink QR and just
  // sends a greeting. Rule: if they have any upcoming bookings → show the
  // list (via handleMyBookings) in the detected locale; else reply with a
  // welcome message, business-scoped when a code accompanied the greeting.
  {
    const greet = detectGreeting(cleaned);
    if (greet) {
      // Locale priority: the detected greeting locale is the customer's
      // explicit signal — the language they chose to type right now. Respect
      // it unconditionally, including English ("Hi", "Hello"). Otherwise
      // users who once had a French session get locked into French even
      // after they switch to typing English. Saved session locale is only
      // consulted downstream (e.g. during MY BOOKINGS) where no fresh signal
      // exists.
      const greetLocale: Locale = greet.locale;

      // If a business code was attached, resolve it so we can show the
      // business name on the empty-state welcome.
      const greetOrg: OrgContext | null = greet.code
        ? await findOrgByCode(greet.code, channel)
        : null;

      // Fetch upcoming bookings for this phone. Reuse the same query shape
      // as handleMyBookings (last-9-digits match tolerates any phone format
      // stored on the row).
      const supabaseGreet = createAdminClient() as any;
      const digits = identifier.replace(/\D/g, '');
      const last9 = digits.slice(-9);
      const nowIso = new Date().toISOString();
      const in60dIso = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: greetAppts } = await supabaseGreet
        .from('appointments')
        .select('id, customer_phone')
        .in('status', ['pending', 'confirmed', 'checked_in'])
        .gte('scheduled_at', nowIso)
        .lte('scheduled_at', in60dIso)
        .not('customer_phone', 'is', null)
        .limit(100);
      const hasBooking = (greetAppts ?? []).some((a: any) => {
        const d = String(a.customer_phone ?? '').replace(/\D/g, '');
        return d.length >= 9 && d.slice(-9) === last9;
      });

      if (hasBooking) {
        await handleMyBookings(identifier, greetLocale, sendMessage);
        return;
      }

      // No bookings — business-scoped welcome if we resolved an org,
      // otherwise the generic welcome.
      if (greetOrg) {
        await sendMessage({
          to: identifier,
          body: t('greeting_welcome', greetLocale, {
            name: greetOrg.name,
            code: greet.code ?? '',
          }),
        });
        // Pure-WhatsApp ordering: customers reach the order flow by
        // sending JOIN <code> and then picking Takeout / Delivery from
        // the service list. No menu link is sent — the in-chat numbered
        // menu opens directly from there.
      } else {
        await sendMessage({
          to: identifier,
          body: t('greeting_welcome_generic', greetLocale),
        });
      }
      return;
    }
  }

  // ── MY BOOKINGS / MES RDV / مواعيدي ──
  if (
    command === 'MY BOOKINGS' || command === 'MY BOOKING' ||
    command === 'MES RDV' || command === 'MES RESERVATIONS' || command === 'MES RÉSERVATIONS' ||
    /^(مواعيدي|حجوزاتي)$/.test(cleaned)
  ) {
    let myLocale: Locale = detectedLocale;
    if (/^(مواعيدي|حجوزاتي)$/.test(cleaned)) myLocale = 'ar';
    else if (command.startsWith('MES')) myLocale = 'fr';
    else if (command.startsWith('MY')) myLocale = 'en';
    await handleMyBookings(identifier, myLocale, sendMessage);
    return;
  }

  // ── CANCEL BOOKING [N] / ANNULER RDV [N] / الغاء موعد [N] ──
  const cancelBookMatch = command.match(/^(CANCEL\s+BOOKING|ANNULER\s+RDV)(?:\s+(\d+))?$/);
  const cancelBookAr = cleaned.match(/^(?:الغاء|إلغاء)\s*موعد(?:\s*(\d+))?$/);
  if (cancelBookMatch || cancelBookAr) {
    const idx = cancelBookMatch?.[2]
      ? parseInt(cancelBookMatch[2], 10)
      : (cancelBookAr?.[1] ? parseInt(cancelBookAr[1], 10) : null);
    await handleCancelBooking(identifier, detectedLocale, channel, sendMessage, idx);
    return;
  }

  // ── BOOK / RDV / موعد with code ──
  const bookParsed = parseBookingCode(cleaned);
  // Only treat as a code if it looks like one: single word (no spaces)
  // The DB lookup (findOrgByCode) determines if it's a valid business code
  if (bookParsed && !bookParsed.code.includes(' ')) {
    const org = await findOrgByCode(bookParsed.code, channel);
    if (org) {
      await startBookingFlow(identifier, org, bookParsed.locale, channel, sendMessage, profileName);
    } else {
      await sendMessage({ to: identifier, body: t('code_not_found', bookParsed.locale, { code: bookParsed.code }) });
    }
    return;
  }

  // ── Plain BOOK / RDV / موعد without code ──
  if (
    command === 'BOOK' ||
    command === 'BOOKING' ||
    command === 'RESERVE' ||
    command === 'RDV' ||
    command === 'RESERVER' ||
    command === 'RESERVATION' ||
    /^(موعد|حجز|احجز)$/.test(cleaned)
  ) {
    // Infer locale: explicit word → known locale, else saved session locale, else detected
    let bookLocale: Locale = detectedLocale;
    if (/^(موعد|حجز|احجز)$/.test(cleaned)) bookLocale = 'ar';
    else if (command === 'RDV' || command === 'RESERVER' || command === 'RESERVATION') bookLocale = 'fr';
    else if (command === 'BOOK' || command === 'BOOKING' || command === 'RESERVE') bookLocale = 'en';
    const savedLocale = await getLastSessionLocale(identifier, channel, bsuid);
    if (savedLocale) bookLocale = savedLocale;

    // Find the user's most recent session (any state, last 30 days) to infer org
    const supabaseBook = createAdminClient() as any;
    const idColBook = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let recentRow: any = null;
    {
      const { data } = await supabaseBook
        .from('whatsapp_sessions')
        .select('organization_id, locale')
        .eq(idColBook, identifier)
        .eq('channel', channel)
        .not('organization_id', 'is', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      recentRow = data;
    }
    if (!recentRow && channel === 'whatsapp' && bsuid) {
      const { data } = await supabaseBook
        .from('whatsapp_sessions')
        .select('organization_id, locale')
        .eq('whatsapp_bsuid', bsuid)
        .eq('channel', 'whatsapp')
        .not('organization_id', 'is', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      recentRow = data;
    }

    if (recentRow?.organization_id) {
      const { data: orgRow } = await supabaseBook
        .from('organizations')
        .select('id, name, settings')
        .eq('id', recentRow.organization_id)
        .single();
      if (orgRow) {
        const orgCtx: OrgContext = {
          id: orgRow.id,
          name: orgRow.name,
          settings: (orgRow.settings ?? {}) as Record<string, any>,
        };
        if (recentRow.locale) bookLocale = recentRow.locale as Locale;
        await startBookingFlow(identifier, orgCtx, bookLocale, channel, sendMessage, profileName);
        return;
      }
    }

    // No previous org — ask the user to include the business code
    await sendMessage({ to: identifier, body: t('book_needs_org', bookLocale) });
    return;
  }

  // ── JOIN with code ──
  const parsed = parseBusinessCode(cleaned);
  if (parsed) {
    // Check if the code is a category-business number (e.g. "5-1", "3-2")
    const dirMatch = parsed.code.match(/^(\d{1,2})-(\d{1,2})$/);
    if (dirMatch) {
      const catN = parseInt(dirMatch[1], 10);
      const bizN = parseInt(dirMatch[2], 10);
      if (catN >= 1 && catN <= BUSINESS_CATEGORIES.length) {
        const handled = await handleCategoryOrJoin(identifier, parsed.locale, channel, sendMessage, catN, bizN, profileName, bsuid);
        if (handled) return;
      }
    }

    // Check if the code is just a category number (e.g. "JOIN 5")
    const catOnlyMatch = parsed.code.match(/^(\d{1,2})$/);
    if (catOnlyMatch) {
      const catN = parseInt(catOnlyMatch[1], 10);
      if (catN >= 1 && catN <= BUSINESS_CATEGORIES.length) {
        const handled = await handleCategoryOrJoin(identifier, parsed.locale, channel, sendMessage, catN, null, profileName, bsuid);
        if (handled) return;
      }
    }

    // Check if the code is a kiosk qr_token (link to existing ticket)
    const linked = await tryLinkKioskTicket(parsed.code, identifier, channel, sendMessage, parsed.locale, bsuid);
    if (linked) return;

    const org = await findOrgByCode(parsed.code, channel);
    if (org) {
      await askJoinConfirmation(identifier, org, parsed.locale, channel, sendMessage, profileName, bsuid);
    } else {
      await sendMessage({ to: identifier, body: t('code_not_found', parsed.locale, { code: parsed.code }) });
    }
    return;
  }

  // ── HELP / INFO / MENU — always reply with usage guide in detected locale ──
  if (
    command === 'HELP' || command === 'INFO' || command === 'MENU' ||
    command === 'AIDE' || command === 'AYUDA' || command === 'START' ||
    /^(مساعدة|معلومات|قائمة|بدء|ابدا|ابدأ)$/.test(cleaned) ||
    cleaned === '?' || cleaned === '؟'
  ) {
    await sendMessage({ to: identifier, body: t('welcome', detectedLocale) });
    return;
  }

  // ── Plain "JOIN" / "REJOINDRE" / "انضم" without code ──
  if (command === 'JOIN' || command === 'REJOINDRE' || /^انضم$/.test(cleaned)) {
    const found = await findOrgByActiveSession(identifier, channel, bsuid);
    if (found) {
      const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((found.session.locale as Locale) || detectedLocale);
      const pos = await getQueuePosition(found.session.ticket_id);
      const ctx = await fetchTicketContext(found.session.ticket_id, sessionLocale);
      await sendMessage({
        to: identifier,
        body: t('already_in_queue', sessionLocale, {
          name: found.org.name,
          position: formatPosition(pos, sessionLocale),
          ticket: ctx.ticket,
          service: ctx.service,
          joined: ctx.joined,
          url: ctx.url,
        }),
      });
    } else {
      await sendMessage({ to: identifier, body: t('welcome', detectedLocale) });
    }
    return;
  }

  // ── Maybe the message IS the code ──
  const maybeCode = cleaned.toUpperCase();
  if (maybeCode.length >= 2 && maybeCode.length <= 30 && /^[A-Z0-9_-]+$/.test(maybeCode)) {
    const org = await findOrgByCode(maybeCode, channel);
    if (org) {
      await askJoinConfirmation(identifier, org, detectedLocale, channel, sendMessage, profileName, bsuid);
      return;
    }
  }

  // ── Unknown message — always reply with descriptive usage guide in user's language ──
  const found = await findOrgByActiveSession(identifier, channel, bsuid);
  if (found) {
    const sessionLocale = detectedLocale === 'ar' ? 'ar' : ((found.session.locale as Locale) || detectedLocale);
    await sendMessage({
      to: identifier,
      body: t('help_with_session', sessionLocale, { name: found.org.name }) + '\n\n' + t('welcome', sessionLocale),
    });
    return;
  }

  // No active session — pick best locale and send welcome guide
  const prevLocale = await getLastSessionLocale(identifier, channel, bsuid);
  const isAlgerian = identifier.startsWith('213');
  const replyLocale: Locale =
    detectedLocale === 'ar' ? 'ar'
    : prevLocale ? prevLocale
    : isAlgerian ? 'ar'
    : detectedLocale;
  await sendMessage({ to: identifier, body: t('welcome', replyLocale) });
}

// ── DIRECTORY ────────────────────────────────────────────────────────

/** Fetch all listed businesses grouped by category. Returns category index → businesses. */
async function getDirectoryData(channel: Channel) {
  const supabase = createAdminClient();
  const enabledKey = channel === 'messenger' ? 'messenger_enabled' : 'whatsapp_enabled';
  const codeKey = channel === 'messenger' ? 'messenger_code' : 'whatsapp_code';

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, name, settings');

  const listed = (orgs ?? [])
    .filter((o: any) => {
      const s = (o.settings ?? {}) as Record<string, any>;
      // Default: listed unless admin explicitly opted out
      if (s.listed_in_directory === false) return false;
      if (!s[enabledKey] && !s.whatsapp_enabled) return false;
      const code = (s[codeKey] ?? s.whatsapp_code ?? '').toString().trim();
      return code.length >= 2;
    })
    .map((o: any) => {
      const s = (o.settings ?? {}) as Record<string, any>;
      const code = (s[codeKey] ?? s.whatsapp_code ?? '').toString().toUpperCase().trim();
      const category = (s.business_category ?? 'other') as string;
      return { name: o.name, code, category };
    });

  // Group by category
  const grouped = new Map<string, typeof listed>();
  for (const biz of listed) {
    const arr = grouped.get(biz.category) || [];
    arr.push(biz);
    grouped.set(biz.category, arr);
  }

  // Sort categories by BUSINESS_CATEGORIES order, only include populated ones
  const catOrder = BUSINESS_CATEGORIES.map((c) => c.value as string);
  const sortedCatKeys = [...grouped.keys()].sort(
    (a, b) => catOrder.indexOf(a) - catOrder.indexOf(b)
  );

  return { listed, grouped, sortedCatKeys };
}

/** Step 1: LIST → show numbered categories */
async function handleDirectory(
  identifier: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
): Promise<void> {
  const { listed, grouped, sortedCatKeys } = await getDirectoryData(channel);

  if (listed.length === 0) {
    await sendMessage({ to: identifier, body: t('no_businesses', locale) });
    return;
  }

  const localeKey = locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en';

  let body = t('directory_header', locale);

  for (let i = 0; i < sortedCatKeys.length; i++) {
    const catKey = sortedCatKeys[i];
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === catKey);
    const emoji = catDef?.emoji ?? '📌';
    const catLabel = catDef?.label[localeKey] ?? catDef?.label.en ?? catKey;
    const count = grouped.get(catKey)!.length;

    if (locale === 'ar') {
      body += channel === 'messenger'
        ? `${catLabel} ${emoji} — *${i + 1}*\n`
        : `*${i + 1}* — ${emoji} ${catLabel}\n`;
    } else {
      body += `*${i + 1}.* ${emoji} ${catLabel} (${count})\n`;
    }
  }

  body += t('directory_footer', locale);

  await sendMessage({ to: identifier, body: locale === 'ar' && channel === 'whatsapp' ? ensureRTL(body) : body });
}

/**
 * Step 2 & 3: Handle category number or category-business number (e.g. "3" or "3-2").
 * Returns true if handled, false if the number didn't match a valid directory action.
 */
async function handleCategoryOrJoin(
  identifier: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  catNum: number,
  bizNum: number | null,
  profileName?: string,
  bsuid?: string,
): Promise<boolean> {
  const { listed, grouped, sortedCatKeys } = await getDirectoryData(channel);

  if (listed.length === 0) return false;

  // catNum is 1-based index into sortedCatKeys
  if (catNum < 1 || catNum > sortedCatKeys.length) return false;

  const catKey = sortedCatKeys[catNum - 1];
  const businesses = grouped.get(catKey) ?? [];

  if (businesses.length === 0) {
    await sendMessage({ to: identifier, body: t('category_empty', locale) });
    return true;
  }

  // If no business number → show businesses in category
  if (bizNum === null) {
    const localeKey = locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en';
    const catDef = BUSINESS_CATEGORIES.find((c) => c.value === catKey);
    const emoji = catDef?.emoji ?? '📌';
    const catLabel = catDef?.label[localeKey] ?? catDef?.label.en ?? catKey;

    let body = t('category_header', locale, { emoji, category: catLabel });

    for (let i = 0; i < businesses.length; i++) {
      const biz = businesses[i];
      if (locale === 'ar') {
        body += channel === 'messenger'
          ? `${biz.name} — *${catNum}-${i + 1}*\n`
          : `*${catNum}-${i + 1}* — ${biz.name}\n`;
      } else {
        body += `*${catNum}-${i + 1}.* ${biz.name}\n`;
      }
    }

    body += t('category_footer', locale, { example: `${catNum}-1` });

    await sendMessage({ to: identifier, body: locale === 'ar' && channel === 'whatsapp' ? ensureRTL(body) : body });
    return true;
  }

  // bizNum provided → join that business
  if (bizNum < 1 || bizNum > businesses.length) {
    await sendMessage({ to: identifier, body: t('category_empty', locale) });
    return true;
  }

  const selectedBiz = businesses[bizNum - 1];
  const org = await findOrgByCode(selectedBiz.code, channel);
  if (org) {
    await askJoinConfirmation(identifier, org, locale, channel, sendMessage, profileName, bsuid);
  } else {
    await sendMessage({ to: identifier, body: t('code_not_found', locale, { code: selectedBiz.code }) });
  }
  return true;
}

// ── JOIN ──────────────────────────────────────────────────────────────

// ── TRACK LINK (link WhatsApp/Messenger to existing ticket via qr_token) ──

async function handleTrackLink(
  identifier: string,
  qrToken: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  profileName?: string,
  bsuid?: string,
): Promise<void> {
  const supabase = createAdminClient() as any;

  // Look up ticket by qr_token
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, qr_token, status, office_id, department_id, service_id')
    .eq('qr_token', qrToken)
    .single();

  if (!ticket) {
    await sendMessage({ to: identifier, body: t('not_in_queue', locale) });
    return;
  }

  if (['served', 'no_show', 'cancelled'].includes(ticket.status)) {
    await sendMessage({ to: identifier, body: t('not_in_queue', locale) });
    return;
  }

  // Get org info
  const { data: office } = await supabase
    .from('offices')
    .select('organization_id')
    .eq('id', ticket.office_id)
    .single();
  if (!office) return;

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', office.organization_id)
    .single();

  const identifierColumn = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Check if there's already an active session for this ticket
  const { data: existingSession } = await supabase
    .from('whatsapp_sessions')
    .select('id, channel')
    .eq('ticket_id', ticket.id)
    .eq('state', 'active')
    .limit(1);

  if (existingSession && existingSession.length > 0) {
    // Update existing session to this channel
    await supabase
      .from('whatsapp_sessions')
      .update({
        channel,
        [identifierColumn]: identifier,
        ...(channel === 'messenger' ? { whatsapp_phone: null } : { messenger_psid: null }),
        ...(channel === 'whatsapp' && bsuid ? { whatsapp_bsuid: bsuid } : {}),
      })
      .eq('id', existingSession[0].id);
  } else {
    // Create new session
    await supabase.from('whatsapp_sessions').insert({
      organization_id: office.organization_id,
      ticket_id: ticket.id,
      office_id: ticket.office_id,
      department_id: ticket.department_id,
      service_id: ticket.service_id,
      [identifierColumn]: identifier,
      ...(channel === 'whatsapp' && bsuid ? { whatsapp_bsuid: bsuid } : {}),
      channel,
      state: 'active',
      locale,
    });
  }

  // Build and send rich "joined" message
  const baseUrl = APP_BASE_URL;
  const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;
  const pos = await getQueuePosition(ticket.id);
  const positionText = formatPosition(pos, locale);

  const message = tNotification('joined', locale, {
    name: org?.name ?? '',
    ticket: ticket.ticket_number,
    position: positionText,
    url: trackUrl,
  });

  await sendMessage({ to: identifier, body: message });
}

/**
 * Try to link a messaging session to an existing kiosk ticket by qr_token.
 * Returns true if the code matched a ticket and the session was created/linked.
 */
async function tryLinkKioskTicket(
  code: string,
  identifier: string,
  channel: Channel,
  sendMessage: SendFn,
  locale: Locale,
  bsuid?: string,
): Promise<boolean> {
  const supabase = createAdminClient();

  // qr_tokens can be 12-char hex (older) or 16-char nanoid (mixed case/digits)
  // Skip if too short or too long to be a token
  const cleanCode = code.replace(/^_/, ''); // handle JOIN_token format
  if (cleanCode.length < 8 || cleanCode.length > 24 || /\s/.test(cleanCode)) return false;

  // Case-insensitive match — parseBusinessCode uppercases the code,
  // but qr_tokens may be mixed-case nanoid (e.g. ffIWgDFsBdW6LZ97)
  let { data: ticket } = await (supabase as any)
    .from('tickets')
    .select('id, ticket_number, qr_token, status, office_id, department_id, created_at')
    .ilike('qr_token', cleanCode)
    .maybeSingle();

  if (!ticket) return false;

  // Ticket found by qr_token — this is a kiosk opt-in
  if (['served', 'no_show', 'cancelled'].includes(ticket.status)) {
    await sendMessage({ to: identifier, body: t('ticket_ended', locale) });
    return true;
  }

  // Get org info
  const { data: office } = await (supabase as any)
    .from('offices')
    .select('organization_id, name')
    .eq('id', ticket.office_id)
    .single();
  if (!office) return false;

  const { data: org } = await (supabase as any)
    .from('organizations')
    .select('name')
    .eq('id', office.organization_id)
    .single();

  // Check for existing session on this ticket
  const { data: existingSession } = await (supabase as any)
    .from('whatsapp_sessions')
    .select('id')
    .eq('ticket_id', ticket.id)
    .eq('state', 'active')
    .maybeSingle();

  const normPhone = channel === 'whatsapp' ? normalizePhone(identifier) : null;

  if (existingSession) {
    // Update existing session with the new channel/identifier.
    // IMPORTANT: do NOT overwrite locale here — that destroys the customer's
    // language preference if it was set earlier. Locale only changes via the
    // explicit language picker (1/2/3) or when first creating a session.
    const update: Record<string, any> = { channel };
    if (channel === 'whatsapp') {
      update.whatsapp_phone = normPhone || identifier;
      update.whatsapp_bsuid = bsuid || null;
      update.messenger_psid = null;
    } else {
      update.messenger_psid = identifier;
      update.whatsapp_phone = null;
    }
    await (supabase as any).from('whatsapp_sessions').update(update).eq('id', existingSession.id);
  } else {
    // Create new session linked to the kiosk ticket. Race-safe via the
    // unique partial index on (ticket_id) where state='active'.
    const { error: insErr } = await (supabase as any).from('whatsapp_sessions').insert({
      organization_id: office.organization_id,
      ticket_id: ticket.id,
      channel,
      whatsapp_phone: channel === 'whatsapp' ? (normPhone || identifier) : null,
      whatsapp_bsuid: channel === 'whatsapp' ? (bsuid || null) : null,
      messenger_psid: channel === 'messenger' ? identifier : null,
      state: 'active',
      locale,
    });
    if (insErr) {
      // Race lost — another session for this ticket was just created. Update
      // it with the new identifier instead of failing.
      const { data: winner } = await (supabase as any)
        .from('whatsapp_sessions')
        .select('id')
        .eq('ticket_id', ticket.id)
        .eq('state', 'active')
        .maybeSingle();
      if (winner) {
        const update: Record<string, any> = { channel };
        if (channel === 'whatsapp') {
          update.whatsapp_phone = normPhone || identifier;
          update.whatsapp_bsuid = bsuid || null;
          update.messenger_psid = null;
        } else {
          update.messenger_psid = identifier;
          update.whatsapp_phone = null;
        }
        await (supabase as any).from('whatsapp_sessions').update(update).eq('id', winner.id);
      }
    }
  }

  // Get position using canonical calculation
  const pos = await getQueuePosition(ticket.id);
  const orgName = org?.name || office.name || '';

  // Send confirmation
  const baseUrl = APP_BASE_URL;
  const confirmMsg = t('joined', locale, {
    name: orgName,
    ticket: ticket.ticket_number,
    position: formatPosition(pos, locale),
    now_serving: formatNowServing(pos, locale),
    url: `${baseUrl}/q/${ticket.qr_token}`,
  });
  await sendMessage({ to: identifier, body: confirmMsg });

  console.log(`[messaging] Kiosk ticket ${ticket.ticket_number} linked to ${channel} ${identifier.slice(-4)}`);
  return true;
}

// ── Numbered list formatter ──────────────────────────────────────────
function formatNumberedList(items: Array<{ name: string }>, locale: Locale): string {
  return items.map((item, i) => {
    if (locale === 'ar') return `*${i + 1}* — ${item.name}`;
    return `*${i + 1}.* ${item.name}`;
  }).join('\n');
}

// ── Fetch departments and services for an org/office ─────────────────
async function fetchOrgDeptServices(orgId: string, officeIdFilter?: string | null) {
  const supabase = createAdminClient() as any;
  let officeQuery = supabase.from('offices').select('id, name').eq('organization_id', orgId).eq('is_active', true);
  if (officeIdFilter) officeQuery = officeQuery.eq('id', officeIdFilter);
  const { data: offices } = await officeQuery.order('name');

  if (!offices?.length) return { offices: [], departments: [], services: [] };

  const { data: departments } = await supabase
    .from('departments').select('id, name, office_id')
    .in('office_id', offices.map((o: any) => o.id))
    .eq('is_active', true).order('sort_order');

  if (!departments?.length) return { offices, departments: [], services: [] };

  const { data: services } = await supabase
    .from('services').select('id, name, department_id, estimated_service_time')
    .in('department_id', departments.map((d: any) => d.id))
    .eq('is_active', true).order('sort_order');

  return { offices: offices ?? [], departments: departments ?? [], services: services ?? [] };
}

// ── Build session data helper ────────────────────────────────────────
function buildSessionIdentifiers(identifier: string, channel: Channel, bsuid?: string): Record<string, any> {
  const data: Record<string, any> = {};
  if (channel === 'messenger') {
    data.messenger_psid = identifier;
  } else {
    data.whatsapp_phone = identifier;
    if (bsuid) data.whatsapp_bsuid = bsuid;
  }
  return data;
}

// ── Department choice handler ────────────────────────────────────────
async function handleDepartmentChoice(
  session: any, idx: number, identifier: string, locale: Locale,
  channel: Channel, sendMessage: SendFn, profileName?: string, bsuid?: string,
): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: departments } = await supabase
    .from('departments').select('id, name, office_id')
    .eq('office_id', session.office_id).eq('is_active', true).order('sort_order');

  if (!departments?.length || idx < 1 || idx > departments.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return;
  }

  const dept = departments[idx - 1];

  // Get services for this department
  const { data: services } = await supabase
    .from('services').select('id, name')
    .eq('department_id', dept.id).eq('is_active', true).order('sort_order');

  if (!services?.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return;
  }

  if (services.length === 1) {
    // Auto-select single service → either short-circuit to ordering page
    // (takeout/delivery) or go to standard JOIN confirmation (everything
    // else, including dine-in which still uses the queue intake).
    const onlyService = services[0];
    if (await routeRestaurantServiceToOrdering(
      onlyService.name,
      session.organization_id,
      session.office_id,
      onlyService.id,
      dept.id,
      identifier, channel, locale, sendMessage,
    )) {
      // Selection-stage session is no longer needed; the order flow
      // owns its own pending_order_browse session from now on.
      await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
      return;
    }
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);

    const { data: orgRow } = await supabase
      .from('organizations').select('id, name, settings').eq('id', session.organization_id).single();
    if (!orgRow) return;

    await askJoinConfirmationDirect(identifier, orgRow, locale, channel, sendMessage, bsuid, {
      officeId: session.office_id, departmentId: dept.id, serviceId: onlyService.id,
    });
    return;
  }

  // Multiple services → show service list
  const list = formatNumberedList(services, locale);
  await supabase.from('whatsapp_sessions')
    .update({ state: 'pending_service', department_id: dept.id })
    .eq('id', session.id);

  await sendMessage({
    to: identifier,
    body: t('choose_service', locale, { dept: dept.name, list }),
  });
}

// ── Service choice handler ───────────────────────────────────────────
async function handleServiceChoice(
  session: any, idx: number, identifier: string, locale: Locale,
  channel: Channel, sendMessage: SendFn, profileName?: string, bsuid?: string,
): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: services } = await supabase
    .from('services').select('id, name')
    .eq('department_id', session.department_id).eq('is_active', true).order('sort_order');

  if (!services?.length || idx < 1 || idx > services.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return;
  }

  const service = services[idx - 1];

  // Restaurant short-circuit: takeout/delivery skip the queue-intake
  // entirely (no name, no party_size). Pure-WhatsApp ordering: the
  // customer browses a numbered menu in chat, builds a cart by message,
  // confirms by reply. Dine-in keeps the existing intake (party size
  // and name make sense for table seating).
  if (await routeRestaurantServiceToOrdering(
    service.name,
    session.organization_id,
    session.office_id,
    service.id,
    session.department_id,
    identifier, channel, locale, sendMessage,
  )) {
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    return;
  }

  // Clean up selection session, proceed to confirmation
  await supabase.from('whatsapp_sessions').delete().eq('id', session.id);

  const { data: orgRow } = await supabase
    .from('organizations').select('id, name, settings').eq('id', session.organization_id).single();
  if (!orgRow) return;

  await askJoinConfirmationDirect(identifier, orgRow, locale, channel, sendMessage, bsuid, {
    officeId: session.office_id, departmentId: session.department_id, serviceId: service.id,
  });
}

// ── Back to department list ──────────────────────────────────────────
async function handleBackToDepartments(
  session: any, identifier: string, locale: Locale,
  channel: Channel, sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: departments } = await supabase
    .from('departments').select('id, name')
    .eq('office_id', session.office_id).eq('is_active', true).order('sort_order');

  if (!departments?.length) return;

  await supabase.from('whatsapp_sessions')
    .update({ state: 'pending_department', department_id: null })
    .eq('id', session.id);

  const { data: orgRow } = await supabase
    .from('organizations').select('name').eq('id', session.organization_id).single();
  const orgName = orgRow?.name || '';

  const list = formatNumberedList(departments, locale);
  await sendMessage({
    to: identifier,
    body: t('choose_department', locale, { name: orgName, list }),
  });
}

// ── Business hours check (inlined to avoid server-action export) ─────
const DAYS_OF_WEEK_MSG = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const;

function checkBusinessHours(
  operatingHours: Record<string, { open: string; close: string }> | null,
  timezone: string | null | undefined,
) {
  const tz = ((timezone ?? '').trim() || 'Africa/Algiers').replace('Europe/Algiers', 'Africa/Algiers');
  const now = new Date();
  // Day resolution: dateKey → day name (timezone-safe, no Date.getDay())
  let day: string, time: string;
  try {
    // Get YYYY-MM-DD in office timezone, then derive day name deterministically
    const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
    const d = new Date(dateKey + 'T12:00:00Z');
    day = DAYS_OF_WEEK_MSG[d.getUTCDay()];
    const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(now);
    const h = parts.find(p => p.type === 'hour')?.value ?? '00';
    const m = parts.find(p => p.type === 'minute')?.value ?? '00';
    time = `${h.padStart(2,'0')}:${m.padStart(2,'0')}`;
  } catch {
    day = DAYS_OF_WEEK_MSG[now.getUTCDay()];
    time = `${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}`;
  }
  if (!operatingHours || Object.keys(operatingHours).length === 0) return { isOpen: true, reason: 'no_hours', todayHours: null as { open: string; close: string } | null };
  const todayHours = operatingHours[day];
  if (!todayHours || (todayHours.open === '00:00' && todayHours.close === '00:00')) return { isOpen: false, reason: 'closed_today', todayHours: null as { open: string; close: string } | null };
  const toMin = (v: string) => { const [hh, mm] = v.split(':').map(Number); return hh * 60 + mm; };
  const cur = toMin(time), open = toMin(todayHours.open), close = toMin(todayHours.close);
  if (cur < open) return { isOpen: false, reason: 'before_hours', todayHours };
  if (cur >= close) return { isOpen: false, reason: 'after_hours', todayHours };
  return { isOpen: true, reason: 'within_hours', todayHours };
}

// ── Early closed check — avoids asking YES/NO when business is closed ──
async function checkBusinessClosedEarly(
  officeId: string,
  org: { id: string; name: string; settings?: Record<string, any> },
  locale: Locale,
  identifier: string,
  sendMessage: SendFn,
): Promise<boolean> {
  const supabase = createAdminClient() as any;
  const { data: office } = await supabase
    .from('offices')
    .select('operating_hours, timezone, settings, organization:organizations(settings, timezone)')
    .eq('id', officeId)
    .single();

  if (!office) return false;

  const orgTz = (office.organization as any)?.timezone || office.timezone || 'Africa/Algiers';
  const orgSettings = ((office.organization as any)?.settings ?? {}) as Record<string, unknown>;
  const officeSettings = (office.settings as Record<string, unknown> | null) ?? {};
  const overrideMode = (
    typeof orgSettings.visit_intake_override_mode === 'string'
      ? orgSettings.visit_intake_override_mode
      : typeof officeSettings.visit_intake_override_mode === 'string'
        ? officeSettings.visit_intake_override_mode
        : 'business_hours'
  ) as string;

  if (overrideMode === 'always_open') return false;
  if (overrideMode === 'always_closed') {
    await sendMessage({ to: identifier, body: t('business_closed_today', locale, { name: org.name }) });
    return true;
  }

  const operatingHours = (office.operating_hours as Record<string, { open: string; close: string }> | null) ?? null;
  const status = checkBusinessHours(operatingHours, orgTz);

  if (status.isOpen) return false;

  if (status.reason === 'before_hours' && status.todayHours?.open) {
    await sendMessage({ to: identifier, body: t('business_closed_opens_at', locale, { name: org.name, time: status.todayHours.open }) });
  } else if (status.reason === 'after_hours') {
    await sendMessage({ to: identifier, body: t('business_closed_for_day', locale, { name: org.name }) });
  } else {
    await sendMessage({ to: identifier, body: t('business_closed_today', locale, { name: org.name }) });
  }
  return true;
}

// ── Direct confirmation with pre-resolved IDs ───────────────────────
async function askJoinConfirmationDirect(
  identifier: string, org: any, locale: Locale, channel: Channel,
  sendMessage: SendFn, bsuid?: string,
  resolved?: { officeId: string; departmentId: string; serviceId: string },
): Promise<void> {
  const supabase = createAdminClient() as any;
  const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Clean up any stale pending sessions for this user
  await supabase.from('whatsapp_sessions').delete()
    .eq(identCol, identifier).in('state', ['pending_confirmation', 'pending_join_name', 'pending_department', 'pending_service', 'pending_custom_intake']).eq('channel', channel);

  // Early closed check — tell the customer immediately instead of asking YES/NO first
  if (resolved?.officeId) {
    const closed = await checkBusinessClosedEarly(resolved.officeId, org, locale, identifier, sendMessage);
    if (closed) return;
  }

  // Determine intake fields to collect (phone auto-collected on WhatsApp only, not Messenger)
  // Same-day join → context 'sameday'
  // Restaurant carve-out: party_size is meaningless for takeout / delivery
  // — there's no table to seat. Drop it from the intake list when the
  // resolved service is one of those types so the customer isn't asked
  // a question that doesn't apply (and that the operator doesn't need).
  const fieldExclude: string[] = channel === 'whatsapp' ? ['phone'] : [];
  if (resolved?.serviceId) {
    try {
      const { data: svcRow } = await supabase
        .from('services').select('name').eq('id', resolved.serviceId).single();
      const svcType = resolveRestaurantServiceType(svcRow?.name ?? '');
      if (svcType === 'takeout' || svcType === 'delivery') {
        fieldExclude.push('party_size');
      }
    } catch { /* best-effort — fall through to default fields */ }
  }
  const enabledFields = getEnabledIntakeFields((org.settings ?? {}) as Record<string, any>, fieldExclude, 'sameday');

  let initialState: string;
  if (enabledFields.length > 0) {
    initialState = 'pending_custom_intake';
  } else {
    initialState = 'pending_confirmation';
  }

  const sessionData: Record<string, any> = {
    organization_id: org.id,
    state: initialState,
    locale,
    channel,
    ...buildSessionIdentifiers(identifier, channel, bsuid),
  };
  if (resolved) {
    sessionData.office_id = resolved.officeId;
    sessionData.department_id = resolved.departmentId;
    sessionData.service_id = resolved.serviceId;
  }
  if (initialState === 'pending_custom_intake') {
    sessionData.custom_intake_data = { index: 0, answers: {} };
  }

  const { error: insertErr } = await supabase.from('whatsapp_sessions').insert(sessionData);
  if (insertErr) {
    console.error('[askJoinConfirmationDirect] Insert failed:', insertErr.message);
  }

  if (enabledFields.length > 0) {
    const firstField = enabledFields[0];
    const fieldLabel = getFieldLabel(firstField, locale);
    await sendMessage({ to: identifier, body: t('custom_intake_prompt', locale, { field: fieldLabel }) });
  } else {
    await sendMessage({ to: identifier, body: t('confirm_join', locale, { name: org.name }) });
  }
}

// ── Join confirmation (detects multi-dept/service) ───────────────────
async function askJoinConfirmation(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  profileName?: string,
  bsuid?: string,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Clean up any stale pending sessions for this user
  await supabase.from('whatsapp_sessions').delete()
    .eq(identCol, identifier).in('state', ['pending_confirmation', 'pending_join_name', 'pending_department', 'pending_service', 'pending_custom_intake']).eq('channel', channel);

  // Look up virtual queue code to see if dept/service are pre-set
  const virtualCodeKey = channel === 'messenger'
    ? 'messenger_default_virtual_code_id'
    : 'whatsapp_default_virtual_code_id';
  const virtualCodeId = org.settings?.[virtualCodeKey] ?? org.settings?.whatsapp_default_virtual_code_id;

  let resolvedOfficeId: string | null = null;
  let resolvedDeptId: string | null = null;
  let resolvedServiceId: string | null = null;

  if (virtualCodeId) {
    const { data: vCode } = await supabase
      .from('virtual_queue_codes').select('*').eq('id', virtualCodeId).single();
    if (vCode) {
      resolvedOfficeId = vCode.office_id;
      resolvedDeptId = vCode.department_id;
      resolvedServiceId = vCode.service_id;
    }
  }

  // If all three are set → go straight to confirmation (existing behavior)
  if (resolvedOfficeId && resolvedDeptId && resolvedServiceId) {
    await askJoinConfirmationDirect(identifier, org, locale, channel, sendMessage, bsuid, {
      officeId: resolvedOfficeId, departmentId: resolvedDeptId, serviceId: resolvedServiceId,
    });
    return;
  }

  // Need to resolve dept/service — fetch what's available
  const { departments, services } = await fetchOrgDeptServices(org.id, resolvedOfficeId);

  if (departments.length === 0) {
    await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
    return;
  }

  // Resolve office (use vCode office or first available)
  const officeId = resolvedOfficeId || departments[0].office_id;

  // Early closed check — tell the customer immediately
  const closed = await checkBusinessClosedEarly(officeId, org, locale, identifier, sendMessage);
  if (closed) return;

  // Filter departments for this office
  const officeDepts = departments.filter((d: any) => d.office_id === officeId);

  if (officeDepts.length === 0) {
    await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
    return;
  }

  if (officeDepts.length === 1) {
    const dept = officeDepts[0];
    const deptServices = services.filter((s: any) => s.department_id === dept.id);

    if (deptServices.length === 0) {
      await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
      return;
    }

    if (deptServices.length === 1) {
      // 1 dept, 1 service → straight to confirmation
      await askJoinConfirmationDirect(identifier, org, locale, channel, sendMessage, bsuid, {
        officeId, departmentId: dept.id, serviceId: deptServices[0].id,
      });
      return;
    }

    // 1 dept, multiple services → show service picker
    const sessionData: Record<string, any> = {
      organization_id: org.id,
      state: 'pending_service',
      office_id: officeId,
      department_id: dept.id,
      locale, channel,
      ...buildSessionIdentifiers(identifier, channel, bsuid),
    };
    const { error: insErr } = await supabase.from('whatsapp_sessions').insert(sessionData);
    if (insErr) {
      // Without a pending_service row, the user's reply ("1", "2", …)
      // would cascade to the directory category handler and pick a
      // random business. Surface the failure so the customer can
      // retry rather than silently routing to the wrong flow.
      console.error('[askJoinConfirmation] pending_service insert failed', {
        orgId: org.id, err: insErr.message,
      });
      await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
      return;
    }

    const list = formatNumberedList(deptServices, locale);
    await sendMessage({
      to: identifier,
      body: t('choose_service', locale, { dept: dept.name, list }),
    });
    return;
  }

  // Multiple departments → show department picker
  const sessionData: Record<string, any> = {
    organization_id: org.id,
    state: 'pending_department',
    office_id: officeId,
    locale, channel,
    ...buildSessionIdentifiers(identifier, channel, bsuid),
  };
  const { error: deptInsErr } = await supabase.from('whatsapp_sessions').insert(sessionData);
  if (deptInsErr) {
    console.error('[askJoinConfirmation] pending_department insert failed', {
      orgId: org.id, err: deptInsErr.message,
    });
    await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
    return;
  }

  const list = formatNumberedList(officeDepts, locale);
  await sendMessage({
    to: identifier,
    body: t('choose_department', locale, { name: org.name, list }),
  });
}

async function handleJoin(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  profileName?: string,
  bsuid?: string,
  preResolved?: { officeId: string; departmentId: string; serviceId: string },
  intake?: { wilaya?: string; reason?: string },
  customIntakeData?: Record<string, string>,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const identifierColumn = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Check for existing active session (by phone/PSID, then by BSUID)
  let existing: { id: string; ticket_id: string } | null = null;
  {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id')
      .eq(identifierColumn, identifier)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .eq('channel', channel)
      .maybeSingle();
    existing = data;
  }
  if (!existing && channel === 'whatsapp' && bsuid) {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id')
      .eq('whatsapp_bsuid', bsuid)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .eq('channel', 'whatsapp')
      .maybeSingle();
    existing = data;
  }

  if (existing?.ticket_id) {
    const pos = await getQueuePosition(existing.ticket_id);
    const ctx = await fetchTicketContext(existing.ticket_id, locale);
    await sendMessage({
      to: identifier,
      body: t('already_in_queue', locale, {
        name: org.name,
        position: formatPosition(pos, locale),
        ticket: ctx.ticket,
        service: ctx.service,
        joined: ctx.joined,
        url: ctx.url,
      }),
    });
    return;
  }

  let officeId: string | null = null;
  let departmentId: string | null = null;
  let serviceId: string | null = null;
  let virtualCodeId: string | null = null;

  if (preResolved) {
    // IDs already resolved by dept/service selection flow
    officeId = preResolved.officeId;
    departmentId = preResolved.departmentId;
    serviceId = preResolved.serviceId;
  } else {
    // Use channel-specific or shared virtual code
    const virtualCodeKey = channel === 'messenger'
      ? 'messenger_default_virtual_code_id'
      : 'whatsapp_default_virtual_code_id';
    virtualCodeId = org.settings?.[virtualCodeKey] ?? org.settings?.whatsapp_default_virtual_code_id;

    if (!virtualCodeId) {
      await sendMessage({ to: identifier, body: t('queue_not_configured', locale, { name: org.name }) });
      return;
    }

    const { data: vCode } = await supabase
      .from('virtual_queue_codes')
      .select('*')
      .eq('id', virtualCodeId)
      .single();

    if (!vCode || !vCode.is_active) {
      await sendMessage({ to: identifier, body: t('queue_closed', locale) });
      return;
    }

    officeId = vCode.office_id;
    departmentId = vCode.department_id;
    serviceId = vCode.service_id;
  }

  if (!officeId || !departmentId || !serviceId) {
    await sendMessage({ to: identifier, body: t('queue_requires_service', locale) });
    return;
  }

  // ── Ban check ──
  const { data: banned } = await (supabase as any).rpc('is_customer_banned', {
    p_org_id: org.id,
    p_phone: channel === 'whatsapp' ? identifier : null,
    p_email: null,
    p_psid: channel === 'messenger' ? identifier : null,
  });
  if (banned) {
    await sendMessage({ to: identifier, body: t('banned', locale) });
    return;
  }

  // Build customer data from unified intake answers
  const customerData: Record<string, any> = { source: channel };
  if (channel === 'whatsapp') {
    customerData.phone = identifier;
  } else {
    customerData.messenger_psid = identifier;
  }
  // Map known intake keys to customer data fields
  if (customIntakeData) {
    if (customIntakeData.name) {
      customerData.name = customIntakeData.name;
    }
    if (customIntakeData.wilaya) {
      customerData.wilaya = customIntakeData.wilaya;
    }
    if (customIntakeData.reason) {
      customerData.reason_of_visit = customIntakeData.reason;
    }
    if (customIntakeData.age) {
      customerData.age = customIntakeData.age;
    }
    // Merge remaining custom fields as-is
    for (const [key, val] of Object.entries(customIntakeData)) {
      if (!['name', 'wilaya', 'reason', 'age', 'phone'].includes(key)) {
        customerData[key] = val;
      }
    }
  }
  // Fallback: use profileName if name wasn't collected via intake
  if (!customerData.name && profileName) {
    customerData.name = profileName;
  }
  // Legacy intake params (backward compat for existing sessions)
  if (intake?.wilaya && !customerData.wilaya) {
    customerData.wilaya = intake.wilaya;
  }
  if (intake?.reason && !customerData.reason_of_visit) {
    customerData.reason_of_visit = intake.reason;
  }

  const result = await createPublicTicket({
    officeId,
    departmentId,
    serviceId,
    customerData,
    isRemote: true,
    source: channel,
    locale,
  });

  if ('error' in result && result.error) {
    await sendMessage({ to: identifier, body: t('join_error', locale, { error: translateError(result.error, locale) }) });
    return;
  }

  const ticket = result.data;
  if (!ticket) {
    await sendMessage({ to: identifier, body: t('join_failed', locale) });
    return;
  }

  // Auto-upsert customer profile from queue join (non-fatal)
  try {
    await upsertCustomerFromBooking(supabase, {
      organizationId: org.id,
      name: customerData.name || undefined,
      phone: identifier, // WhatsApp/Messenger identifiers are already E.164 — no timezone needed
      wilayaCode: customerData.wilaya || intake?.wilaya || undefined,
      source: channel === 'messenger' ? 'messenger' : channel,
    });
  } catch (e) { console.warn('[join] customer upsert failed:', (e as any)?.message ?? e); }

  // Create session
  const sessionData: Record<string, any> = {
    organization_id: org.id,
    ticket_id: ticket.id,
    virtual_queue_code_id: virtualCodeId,
    office_id: officeId,
    department_id: departmentId,
    service_id: serviceId,
    state: 'active',
    locale,
    channel,
  };

  if (channel === 'messenger') {
    sessionData.messenger_psid = identifier;
  } else {
    sessionData.whatsapp_phone = identifier;
    if (bsuid) sessionData.whatsapp_bsuid = bsuid;
  }

  const { error: sessionError } = await supabase.from('whatsapp_sessions').insert(sessionData);
  if (sessionError) {
    console.error(`[${channel}:join] Session insert error:`, JSON.stringify(sessionError));
  }

  const baseUrl = APP_BASE_URL;
  const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

  // If the office requires provider approval, the ticket is in `pending_approval`.
  // Send a "waiting for approval" message; the full joined message is sent later
  // by /api/moderate-ticket when the provider approves.
  if ((ticket as any).status === 'pending_approval') {
    // Resolve service name for the pending_approval template
    let pendingServiceName = '—';
    if (serviceId) {
      try {
        const { data: svc } = await supabase.from('services').select('name').eq('id', serviceId).maybeSingle();
        if (svc?.name) pendingServiceName = svc.name;
      } catch { /* ignore */ }
    }
    const locTag = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR';
    const nowDt = new Date();
    const pendingDate = nowDt.toLocaleDateString(locTag, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const pendingTime = nowDt.toLocaleTimeString(locTag, { hour: '2-digit', minute: '2-digit', hour12: false });
    const apptVars = getApptVocabVars(org.settings?.business_category ?? null, locale);
    await sendMessage({
      to: identifier,
      body: t('pending_approval', locale, {
        name: org.name, date: pendingDate, time: pendingTime, service: pendingServiceName,
        ...apptVars,
      }),
    });
    return;
  }

  const pos = await getQueuePosition(ticket.id);

  // Compact join-success message — drops the "What would you like to do?
  // 1 — Check your position / 2 — Cancel" boilerplate that previously got
  // appended to every confirmation. Customers who actually want to act on
  // those commands type STATUS / CANCEL freely; the menu was clutter.
  await sendMessage({
    to: identifier,
    body: t('joined', locale, {
      name: org.name,
      ticket: ticket.ticket_number,
      position: formatPosition(pos, locale),
      now_serving: formatNowServing(pos, locale),
      url: trackUrl,
    }),
  });
}

// ── STATUS ────────────────────────────────────────────────────────────

async function handleStatus(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  activeSession?: { id: string; ticket_id: string },
): Promise<void> {
  const supabase = createAdminClient() as any;

  // Use the session already found by findOrgByActiveSession to avoid
  // maybeSingle() failing when multiple active sessions exist
  let session: { ticket_id: string } | null = activeSession ?? null;
  if (!session) {
    const identifierColumn = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: sessions } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id')
      .eq(identifierColumn, identifier)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .eq('channel', channel)
      .order('created_at', { ascending: false })
      .limit(1);
    session = sessions?.[0] ?? null;
  }

  if (!session?.ticket_id) {
    // No active ticket — check for upcoming confirmed/pending appointments.
    const apptReply = await handleAppointmentStatus(identifier, org, locale, channel, sendMessage, supabase);
    if (apptReply) return; // appointment found and replied
    await sendMessage({ to: identifier, body: t('not_in_queue_rejoin', locale) });
    return;
  }

  // Defensive: verify the ticket is still active in the cloud before replying.
  // The DB trigger should have closed the session already, but we double-check
  // to avoid showing cancelled/served tickets in STATUS replies.
  const { data: tRow } = await supabase
    .from('tickets')
    .select('status')
    .eq('id', session.ticket_id)
    .maybeSingle();
  const activeStatuses = ['waiting', 'issued', 'called', 'serving', 'pending_approval'];
  if (!tRow || !activeStatuses.includes(tRow.status)) {
    const idCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq('id', (session as any).id ?? '')
      .eq('organization_id', org.id);
    // Also close any other active sessions for this identifier+ticket
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq(idCol, identifier)
      .eq('organization_id', org.id)
      .eq('ticket_id', session.ticket_id)
      .eq('state', 'active');
    // Before saying "ticket inactive", check for upcoming appointments.
    const apptReply = await handleAppointmentStatus(identifier, org, locale, channel, sendMessage, supabase);
    if (!apptReply) {
      await sendMessage({ to: identifier, body: t('ticket_inactive', locale) });
    }
    return;
  }

  // If ticket is pending provider approval, tell the customer it's awaiting approval.
  if (tRow.status === 'pending_approval') {
    const ctx = await fetchTicketContext(session.ticket_id, locale);
    const locTag = locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR';
    const nowDt = new Date();
    const pendingDate = nowDt.toLocaleDateString(locTag, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const pendingTime = nowDt.toLocaleTimeString(locTag, { hour: '2-digit', minute: '2-digit', hour12: false });
    // ctx.service is a formatted line; extract the raw name between asterisks
    const svcMatch = ctx.service.match(/\*(.+?)\*/);
    const svcName = svcMatch ? svcMatch[1] : '—';
    const apptVars = getApptVocabVars(org.settings?.business_category ?? null, locale);
    await sendMessage({ to: identifier, body: t('pending_approval', locale, {
      name: org.name, date: pendingDate, time: pendingTime, service: svcName,
      ...apptVars,
    }) });
    return;
  }

  // Fetch ticket context (number, service, tracking URL)
  const ctx = await fetchTicketContext(session.ticket_id, locale);
  const ticketNum = ctx.ticket;

  const pos = await getQueuePosition(session.ticket_id);

  if (pos.position === 0) {
    await sendMessage({ to: identifier, body: t('your_turn', locale) });
    return;
  }

  if (pos.position === null) {
    const idCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq(idCol, identifier)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .eq('channel', channel);

    const apptReply3 = await handleAppointmentStatus(identifier, org, locale, channel, sendMessage, supabase);
    if (!apptReply3) {
      await sendMessage({ to: identifier, body: t('ticket_inactive', locale) });
    }
    return;
  }

  await sendMessage({
    to: identifier,
    body: t('status', locale, {
      name: org.name,
      ticket: ticketNum,
      service: ctx.service,
      position: pos.position,
      wait: pos.estimated_wait_minutes ?? '?',
      now_serving: formatNowServing(pos, locale),
      total: pos.total_waiting,
      url: ctx.url,
    }),
  });
}

// ── APPOINTMENT STATUS (fallback when no active ticket) ──────────────

async function handleAppointmentStatus(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  supabase: any,
): Promise<boolean> {
  // Find upcoming confirmed or pending appointments for this phone in this org.
  // Phone may be stored in various formats — use phoneLookupCandidates for robust matching.
  const variants = phoneLookupCandidates(identifier);

  // Get office IDs for this org
  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', org.id);
  if (!offices?.length) return false;
  const officeIds = offices.map((o: any) => o.id);

  const phoneFilter = variants.map((v) => `customer_phone.eq.${v}`).join(',');
  // Use start-of-day so same-day appointments whose scheduled_at is earlier
  // than the current time are still returned (they remain valid all day).
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, status, scheduled_at, service_id, customer_name, locale')
    .in('office_id', officeIds)
    .in('status', ['confirmed', 'pending'])
    .gte('scheduled_at', todayStart.toISOString())
    .or(phoneFilter)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  if (!appts?.length) return false;

  const appt = appts[0];
  // Use the appointment's locale if set, otherwise the session/command locale.
  const apptLocale: Locale = (appt.locale === 'ar' || appt.locale === 'en' || appt.locale === 'fr')
    ? appt.locale : locale;

  // Resolve service name
  let serviceName = '';
  if (appt.service_id) {
    const { data: svc } = await supabase
      .from('services')
      .select('name')
      .eq('id', appt.service_id)
      .maybeSingle();
    serviceName = svc?.name ?? '';
  }

  // Resolve org timezone for correct time display
  let orgTz = 'Africa/Algiers';
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', org.id)
    .maybeSingle();
  if (orgRow?.timezone) orgTz = orgRow.timezone;

  const dt = new Date(appt.scheduled_at);
  const intlLocale = apptLocale === 'ar' ? 'ar-DZ' : apptLocale === 'en' ? 'en-US' : 'fr-FR';
  const dateStr = dt.toLocaleDateString(intlLocale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: orgTz,
  });
  const timeParts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: orgTz }).formatToParts(dt);
  const timeStr = `${timeParts.find(p => p.type === 'hour')?.value ?? '00'}:${timeParts.find(p => p.type === 'minute')?.value ?? '00'}`;

  const templateKey = appt.status === 'confirmed' ? 'appointment_status' : 'appointment_status_pending';
  const apptVars = getApptVocabVars(org.settings?.business_category ?? null, apptLocale);
  await sendMessage({
    to: identifier,
    body: t(templateKey, apptLocale, {
      name: org.name,
      date: dateStr,
      time: timeStr,
      service: serviceName || (apptLocale === 'ar' ? 'عام' : apptLocale === 'en' ? 'General' : 'Général'),
      ...apptVars,
    }),
  });
  return true;
}

/**
 * Org-agnostic appointment status lookup — used when there are no active
 * sessions at all, so we don't have an org context yet. Searches across
 * all orgs for upcoming confirmed/pending appointments for this phone.
 */
async function findAndReplyAppointmentStatus(
  identifier: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  supabase: any,
): Promise<boolean> {
  const variants = phoneLookupCandidates(identifier);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const phoneFilter = variants.map((v) => `customer_phone.eq.${v}`).join(',');
  const { data: appts } = await supabase
    .from('appointments')
    .select('id, status, scheduled_at, service_id, customer_name, locale, office_id')
    .in('status', ['confirmed', 'pending'])
    .gte('scheduled_at', todayStart.toISOString())
    .or(phoneFilter)
    .order('scheduled_at', { ascending: true })
    .limit(1);

  // Also check for pending_approval tickets by phone (JOIN flow creates tickets,
  // not appointments). The old STATUS call may have closed the session, so we
  // need to find the ticket directly.
  const last9 = identifier.replace(/\D/g, '').slice(-9);
  let pendingTicket: any = null;
  if (last9.length >= 9) {
    const { data: tickets } = await supabase
      .from('tickets')
      .select('id, office_id, locale, ticket_number, status')
      .eq('status', 'pending_approval')
      .filter('customer_data->>phone', 'ilike', `%${last9}%`)
      .order('created_at', { ascending: false })
      .limit(1);
    pendingTicket = tickets?.[0] ?? null;
  }

  // If we found a pending_approval ticket, reply with pending message
  if (pendingTicket && !appts?.length) {
    const ticketLocale: Locale = (pendingTicket.locale === 'ar' || pendingTicket.locale === 'en' || pendingTicket.locale === 'fr')
      ? pendingTicket.locale : locale;
    let orgName = '';
    let orgCategory: string | null = null;
    if (pendingTicket.office_id) {
      const { data: office } = await supabase
        .from('offices').select('organization_id').eq('id', pendingTicket.office_id).maybeSingle();
      if (office?.organization_id) {
        const { data: org } = await supabase
          .from('organizations').select('name, settings').eq('id', office.organization_id).maybeSingle();
        orgName = org?.name ?? '';
        orgCategory = (org?.settings as any)?.business_category ?? null;
      }
    }
    // Resolve service name and date/time for the pending_approval template
    const ctx = await fetchTicketContext(pendingTicket.id, ticketLocale);
    const svcMatch = ctx.service.match(/\*(.+?)\*/);
    const svcName = svcMatch ? svcMatch[1] : '—';
    const locTag = ticketLocale === 'ar' ? 'ar-DZ' : ticketLocale === 'en' ? 'en-GB' : 'fr-FR';
    const nowDt = new Date();
    const pendingDate = nowDt.toLocaleDateString(locTag, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const pendingTime = nowDt.toLocaleTimeString(locTag, { hour: '2-digit', minute: '2-digit', hour12: false });
    const apptVars = getApptVocabVars(orgCategory, ticketLocale);
    await sendMessage({
      to: identifier,
      body: t('pending_approval', ticketLocale, {
        name: orgName || (ticketLocale === 'ar' ? 'المزود' : ticketLocale === 'en' ? 'Provider' : 'Prestataire'),
        date: pendingDate, time: pendingTime, service: svcName,
        ...apptVars,
      }),
    });
    return true;
  }

  if (!appts?.length) return false;

  const appt = appts[0];
  const apptLocale: Locale = (appt.locale === 'ar' || appt.locale === 'en' || appt.locale === 'fr')
    ? appt.locale : locale;

  // Resolve org name + timezone from office
  let orgName = '';
  let orgTz = 'Africa/Algiers';
  let orgCategory: string | null = null;
  if (appt.office_id) {
    const { data: office } = await supabase
      .from('offices')
      .select('organization_id')
      .eq('id', appt.office_id)
      .maybeSingle();
    if (office?.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('name, timezone, settings')
        .eq('id', office.organization_id)
        .maybeSingle();
      orgName = org?.name ?? '';
      if (org?.timezone) orgTz = org.timezone;
      orgCategory = (org?.settings as any)?.business_category ?? null;
    }
  }

  // Resolve service name
  let serviceName = '';
  if (appt.service_id) {
    const { data: svc } = await supabase
      .from('services')
      .select('name')
      .eq('id', appt.service_id)
      .maybeSingle();
    serviceName = svc?.name ?? '';
  }

  const dt = new Date(appt.scheduled_at);
  const intlLocale = apptLocale === 'ar' ? 'ar-DZ' : apptLocale === 'en' ? 'en-US' : 'fr-FR';
  const dateStr = dt.toLocaleDateString(intlLocale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: orgTz,
  });
  const timeParts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: orgTz }).formatToParts(dt);
  const timeStr = `${timeParts.find(p => p.type === 'hour')?.value ?? '00'}:${timeParts.find(p => p.type === 'minute')?.value ?? '00'}`;

  const templateKey = appt.status === 'confirmed' ? 'appointment_status' : 'appointment_status_pending';
  const apptVars2 = getApptVocabVars(orgCategory, apptLocale);
  await sendMessage({
    to: identifier,
    body: t(templateKey, apptLocale, {
      ...apptVars2,
      name: orgName || (apptLocale === 'ar' ? 'المزود' : apptLocale === 'en' ? 'Provider' : 'Prestataire'),
      date: dateStr,
      time: timeStr,
      service: serviceName || (apptLocale === 'ar' ? 'عام' : apptLocale === 'en' ? 'General' : 'Général'),
    }),
  });
  return true;
}

/**
 * Cancel a pending_approval ticket by phone when no active session exists
 * (session may have been prematurely closed by old code).
 */
async function cancelPendingTicketByPhone(
  identifier: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  supabase: any,
): Promise<boolean> {
  const digits = identifier.replace(/\D/g, '');
  const last9 = digits.slice(-9);
  if (last9.length < 9) return false;

  const { data: tickets } = await supabase
    .from('tickets')
    .select('id, office_id, ticket_number, status, locale')
    .in('status', ['waiting', 'issued', 'called', 'pending_approval'])
    .filter('customer_data->>phone', 'ilike', `%${last9}%`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (!tickets?.length) return false;

  const ticket = tickets[0];
  const ticketLocale: Locale = (ticket.locale === 'ar' || ticket.locale === 'en' || ticket.locale === 'fr')
    ? ticket.locale : locale;

  // Cancel the ticket
  const { error, count } = await supabase
    .from('tickets')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', ticket.id)
    .in('status', ['waiting', 'issued', 'called', 'pending_approval'])
    .select('id', { count: 'exact', head: true });

  if (error || (count ?? 0) === 0) return false;

  // Close any related sessions
  await supabase
    .from('whatsapp_sessions')
    .update({ state: 'completed' })
    .eq('ticket_id', ticket.id)
    .eq('state', 'active');

  // Fetch org name for the cancellation message
  let orgName = '';
  try {
    const { data: officeRow } = await supabase
      .from('offices')
      .select('organization:organizations(name)')
      .eq('id', ticket.office_id)
      .single();
    orgName = (officeRow as any)?.organization?.name ?? '';
  } catch { /* ignore */ }

  await sendMessage({
    to: identifier,
    body: t('cancelled', ticketLocale, { ticket: ticket.ticket_number, name: orgName }),
  });
  return true;
}

// ── CANCEL ────────────────────────────────────────────────────────────

async function handleCancel(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  activeSession?: { id: string; ticket_id: string },
): Promise<void> {
  const supabase = createAdminClient() as any;

  // Look up ALL active sessions for this user/org and pick the one whose
  // ticket is actually cancellable (waiting/issued/called). This avoids the
  // bug where a stale session pointing to a serving/served ticket gets
  // chosen, blocking cancellation of a fresh waiting ticket.
  const identifierColumn = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
  let session: { id: string; ticket_id: string } | null = null;
  {
    const { data: sessions } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id, created_at')
      .eq(identifierColumn, identifier)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .eq('channel', channel)
      .order('created_at', { ascending: false });

    const candidates = (sessions ?? []).filter((s: any) => s.ticket_id);
    if (candidates.length > 0) {
      const ids = candidates.map((s: any) => s.ticket_id);
      const { data: tRows } = await supabase
        .from('tickets')
        .select('id, status')
        .in('id', ids);
      const cancellable = new Set(
        (tRows ?? [])
          .filter((t: any) => ['waiting', 'issued', 'called', 'pending_approval'].includes(t.status))
          .map((t: any) => t.id),
      );
      // Prefer most recent cancellable session; fall back to most recent
      session =
        candidates.find((s: any) => cancellable.has(s.ticket_id)) ??
        candidates[0];

      // Auto-close any orphan active sessions whose ticket is already terminal
      const terminal = (tRows ?? [])
        .filter((t: any) => !['waiting', 'issued', 'called', 'serving', 'pending_approval'].includes(t.status))
        .map((t: any) => t.id);
      if (terminal.length > 0) {
        await supabase
          .from('whatsapp_sessions')
          .update({ state: 'completed' })
          .in('ticket_id', terminal)
          .eq('state', 'active');
      }
    }
  }

  // Honour an explicit activeSession hint only if no better cancellable one was found
  if (activeSession && (!session || session.id === activeSession.id)) {
    session = session ?? activeSession;
  }

  if (!session?.ticket_id) {
    await sendMessage({ to: identifier, body: t('not_in_queue_rejoin', locale) });
    return;
  }

  // Fetch ticket info including status
  const { data: ticketRow } = await supabase
    .from('tickets')
    .select('ticket_number, status')
    .eq('id', session.ticket_id)
    .single();

  // If the ticket is being served (or already completed), try to find another
  // cancellable ticket for this phone before giving up.
  if (ticketRow && !['waiting', 'issued', 'called', 'pending_approval'].includes(ticketRow.status)) {
    // Fallback: check if there's a different cancellable ticket by phone
    const fallbackCancelled = await cancelPendingTicketByPhone(identifier, locale, channel, sendMessage, supabase);
    if (fallbackCancelled) return;
    if (ticketRow.status === 'serving') {
      await sendMessage({ to: identifier, body: t('cannot_cancel_serving', locale) });
    } else {
      await sendMessage({ to: identifier, body: t('ticket_inactive', locale) });
    }
    return;
  }

  // Mark session completed BEFORE cancelling the ticket so the DB trigger
  // sees has_session = false and doesn't send a duplicate notification.
  // We do this optimistically but will check the cancel result.
  await supabase
    .from('whatsapp_sessions')
    .update({ state: 'completed' })
    .eq('id', session.id);

  const { error: cancelError, count: cancelledCount } = await supabase
    .from('tickets')
    .update({ status: 'cancelled' })
    .eq('id', session.ticket_id)
    .in('status', ['waiting', 'issued', 'called', 'pending_approval'])
    .select('id', { count: 'exact', head: true });

  if (cancelError) {
    console.error(`[${channel}:cancel] Failed to cancel ticket:`, cancelError);
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'active' })
      .eq('id', session.id);
    // Fallback: try cancelling a different ticket by phone
    const fb1 = await cancelPendingTicketByPhone(identifier, locale, channel, sendMessage, supabase);
    if (!fb1) await sendMessage({ to: identifier, body: t('cannot_cancel_serving', locale) });
    return;
  }

  if ((cancelledCount ?? 0) === 0) {
    // Re-check ticket status: if it's already cancelled (e.g. concurrent
    // webhook delivery), silently succeed instead of showing an error.
    const { data: recheck } = await supabase
      .from('tickets')
      .select('status')
      .eq('id', session.ticket_id)
      .maybeSingle();
    if (recheck?.status === 'cancelled') {
      await supabase.from('whatsapp_sessions')
        .update({ state: 'completed' }).eq('id', session.id);
      await sendMessage({ to: identifier, body: t('cancelled', locale, { ticket: ticketRow?.ticket_number ?? '?', name: org.name }) });
      return;
    }
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'active' })
      .eq('id', session.id);
    // Fallback: try cancelling a different ticket by phone
    const fb2 = await cancelPendingTicketByPhone(identifier, locale, channel, sendMessage, supabase);
    if (!fb2) await sendMessage({ to: identifier, body: t('cannot_cancel_serving', locale) });
    return;
  }

  await supabase.from('ticket_events').insert({
    ticket_id: session.ticket_id,
    event_type: 'cancelled',
    to_status: 'cancelled',
    metadata: { source: `${channel}_cancel` },
  });

  await sendMessage({ to: identifier, body: t('cancelled', locale, { ticket: ticketRow?.ticket_number ?? '?', name: org.name }) });
}

/**
 * Show status for multiple active sessions at once.
 */
async function handleMultiStatus(
  identifier: string,
  allSessions: Array<{ session: any; org: OrgContext }>,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;

  // Pre-fetch ticket rows so we can filter cancelled/served tickets out
  // of the reply (defensive — the DB trigger should already have closed
  // the corresponding sessions, but be robust to lag).
  const ticketIds = allSessions.map((s) => s.session.ticket_id).filter(Boolean);
  let ticketMap = new Map<string, any>();
  if (ticketIds.length > 0) {
    const { data: rows } = await supabase
      .from('tickets')
      .select('id, ticket_number, status')
      .in('id', ticketIds);
    ticketMap = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));
  }

  // Filter to only active tickets and close any orphan sessions inline
  const activeEntries: Array<{ session: any; org: OrgContext; ticket: any }> = [];
  const orphanSessionIds: string[] = [];
  for (const entry of allSessions) {
    const trow = ticketMap.get(entry.session.ticket_id);
    if (trow && ['waiting', 'called', 'serving'].includes(trow.status)) {
      activeEntries.push({ ...entry, ticket: trow });
    } else if (entry.session?.id) {
      orphanSessionIds.push(entry.session.id);
    }
  }
  if (orphanSessionIds.length > 0) {
    await supabase.from('whatsapp_sessions')
      .update({ state: 'completed' })
      .in('id', orphanSessionIds);
  }

  // If after filtering nothing remains, fall through to "no active queues"
  if (activeEntries.length === 0) {
    await sendMessage({ to: identifier, body: t('not_in_queue', locale) });
    return;
  }
  // If only one ticket remains, render the rich single-ticket status
  if (activeEntries.length === 1) {
    const { session, org } = activeEntries[0];
    const sessionLocale = (session.locale as Locale) || locale;
    await handleStatus(identifier, org, sessionLocale, channel, sendMessage, session);
    return;
  }

  let body = t('multi_status_header', locale);
  for (let i = 0; i < activeEntries.length; i++) {
    const { session, org, ticket } = activeEntries[i];
    const ticketNum = ticket?.ticket_number ?? '?';
    const pos = await getQueuePosition(session.ticket_id);
    const posText = pos.position != null
      ? `#${pos.position} (~${pos.estimated_wait_minutes ?? '?'} min)`
      : '—';

    if (locale === 'ar') {
      body += channel === 'messenger'
        ? `*${org.name}* — 🎫 *${ticketNum}* — ${posText} — *${i + 1}*\n`
        : `*${i + 1}* — *${org.name}* — 🎫 *${ticketNum}* — ${posText}\n`;
    } else {
      body += `*${i + 1}.* ${org.name} — 🎫 *${ticketNum}* — ${posText}\n`;
    }
  }

  body += t('multi_status_footer', locale, { n: String(activeEntries.length) });
  await sendMessage({ to: identifier, body: locale === 'ar' && channel === 'whatsapp' ? ensureRTL(body) : body });
}

/**
 * Show a numbered list for CANCEL when there are multiple sessions.
 */
async function handleCancelPick(
  identifier: string,
  allSessions: Array<{ session: any; org: OrgContext }>,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
): Promise<void> {
  let list = '';
  for (let i = 0; i < allSessions.length; i++) {
    const { org } = allSessions[i];
    if (locale === 'ar') {
      list += channel === 'messenger'
        ? `*${org.name}* — *${i + 1}*\n`
        : `*${i + 1}* — *${org.name}*\n`;
    } else {
      list += `*${i + 1}.* ${org.name}\n`;
    }
  }

  const msg = t('cancel_pick', locale, {
    count: String(allSessions.length),
    list,
    n: '1',
  });
  await sendMessage({ to: identifier, body: locale === 'ar' && channel === 'whatsapp' ? ensureRTL(msg) : msg });
}

/**
 * Cancel ALL active sessions for a user.
 */
async function handleCancelAll(
  identifier: string,
  allSessions: Array<{ session: any; org: OrgContext }>,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const cancelledItems: string[] = [];

  for (const { session, org } of allSessions) {
    // Fetch ticket number
    const { data: ticketRow } = await supabase
      .from('tickets')
      .select('ticket_number')
      .eq('id', session.ticket_id)
      .single();

    const ticketNum = ticketRow?.ticket_number ?? '?';

    // Mark session completed first to prevent duplicate DB trigger notifications
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq('id', session.id);

    await supabase
      .from('tickets')
      .update({ status: 'cancelled' })
      .eq('id', session.ticket_id)
      .in('status', ['waiting', 'issued', 'called', 'pending_approval']);

    await supabase.from('ticket_events').insert({
      ticket_id: session.ticket_id,
      event_type: 'cancelled',
      to_status: 'cancelled',
      metadata: { source: `${channel}_cancel_all` },
    });

    if (locale === 'ar') {
      cancelledItems.push(`*${ticketNum}* — *${org.name}* 🚫`);
    } else {
      cancelledItems.push(`🚫 *${ticketNum}* — *${org.name}*`);
    }
  }

  const msg = t('cancelled_all', locale, { list: cancelledItems.join('\n') });
  await sendMessage({ to: identifier, body: locale === 'ar' && channel === 'whatsapp' ? ensureRTL(msg) : msg });
}

// ══════════════════════════════════════════════════════════════════════
// BOOKING FLOW — Conversational appointment booking via WhatsApp/Messenger
// ══════════════════════════════════════════════════════════════════════

/**
 * Start the booking flow for an org. Creates a booking session and
 * shows service selection (or date selection if only 1 service).
 */
async function startBookingFlow(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  profileName?: string,
) {
  // Check if booking is enabled
  if (org.settings.booking_mode === 'disabled' || !org.settings.booking_mode || org.settings.booking_mode === '') {
    await sendMessage({ to: identifier, body: t('booking_disabled', locale, { name: org.name }) });
    return;
  }

  const supabase = createAdminClient() as any;
  const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  // Get offices and services for this org
  const { data: offices } = await supabase
    .from('offices')
    .select('id')
    .eq('organization_id', org.id)
    .eq('is_active', true)
    .limit(1);

  if (!offices || offices.length === 0) {
    await sendMessage({ to: identifier, body: t('booking_disabled', locale, { name: org.name }) });
    return;
  }

  const officeId = offices[0].id;

  // Get departments + services
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, code')
    .eq('office_id', officeId);

  const deptIds = (departments ?? []).map((d: any) => d.id);

  const { data: services } = await supabase
    .from('services')
    .select('id, name, department_id')
    .in('department_id', deptIds.length > 0 ? deptIds : ['none']);

  // Clean up existing booking sessions
  await supabase.from('whatsapp_sessions').delete()
    .eq(identCol, identifier)
    .in('state', ['booking_select_service', 'booking_select_date', 'booking_select_time', 'booking_enter_name', 'booking_enter_phone', 'booking_enter_wilaya', 'booking_enter_reason', 'booking_confirm', 'pending_custom_intake'])
    .eq('channel', channel);

  if (!services || services.length === 0) {
    // No services configured — create session with just office and first department
    const deptId = departments?.[0]?.id;
    if (!deptId) {
      await sendMessage({ to: identifier, body: t('booking_disabled', locale, { name: org.name }) });
      return;
    }

    await supabase.from('whatsapp_sessions').insert({
      organization_id: org.id,
      [identCol]: identifier,
      channel,
      state: 'booking_select_date',
      locale,
      office_id: officeId,
      department_id: deptId,
      service_id: null,
      booking_customer_name: profileName || null,
    });

    // Show dates directly
    await showAvailableDates(identifier, org.name, officeId, deptId, locale, channel, sendMessage);
    return;
  }

  if (services.length === 1) {
    // Only 1 service — skip to date selection
    const svc = services[0];
    await supabase.from('whatsapp_sessions').insert({
      organization_id: org.id,
      [identCol]: identifier,
      channel,
      state: 'booking_select_date',
      locale,
      office_id: officeId,
      department_id: svc.department_id,
      service_id: svc.id,
      booking_customer_name: profileName || null,
    });

    await showAvailableDates(identifier, org.name, officeId, svc.id, locale, channel, sendMessage);
    return;
  }

  // Multiple services — show selection
  const list = services.map((s: any, i: number) => `*${i + 1}* — ${s.name}`).join('\n');
  await supabase.from('whatsapp_sessions').insert({
    organization_id: org.id,
    [identCol]: identifier,
    channel,
    state: 'booking_select_service',
    locale,
    office_id: officeId,
    booking_customer_name: profileName || null,
  });

  await sendMessage({ to: identifier, body: t('booking_choose_service', locale, { name: org.name, list }) });
}

/**
 * Handle a message when the user is in a booking flow state.
 */
async function handleBookingState(
  session: any,
  cleaned: string,
  identifier: string,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
): Promise<boolean> {
  const supabase = createAdminClient() as any;

  // Refresh TTL on every interaction so multi-step flows don't expire
  await supabase.from('whatsapp_sessions').update({ last_message_at: new Date().toISOString() }).eq('id', session.id);

  switch (session.state) {
    case 'booking_select_service':
      return await handleBookingServiceChoice(session, cleaned, identifier, locale, channel, sendMessage);

    case 'booking_select_date':
      return await handleBookingDateChoice(session, cleaned, identifier, locale, channel, sendMessage);

    case 'booking_select_time':
      return await handleBookingTimeChoice(session, cleaned, identifier, locale, channel, sendMessage);

    case 'booking_enter_name':
      // Cancel booking if user sends 0
      if (cleaned === '0') {
        await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
        await sendMessage({ to: identifier, body: t('booking_cancelled', locale) });
        return true;
      }
      return await handleBookingNameInput(session, cleaned, identifier, locale, channel, sendMessage);

    case 'booking_enter_wilaya': {
      // Cancel booking if user sends 0
      if (cleaned === '0') {
        await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
        await sendMessage({ to: identifier, body: t('booking_cancelled', locale) });
        return true;
      }
      const resolved = resolveWilaya(cleaned);
      if (!resolved) {
        await sendMessage({ to: identifier, body: t('intake_invalid_wilaya', locale) });
        return true;
      }
      const canonical = formatWilayaLocale(resolved, locale);
      await supabase.from('whatsapp_sessions').update({
        booking_customer_wilaya: canonical,
        state: 'booking_enter_reason',
      }).eq('id', session.id);
      await sendMessage({ to: identifier, body: t('booking_enter_reason', locale) });
      return true;
    }

    case 'booking_enter_reason': {
      // Cancel booking if user sends 0
      if (cleaned === '0') {
        await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
        await sendMessage({ to: identifier, body: t('booking_cancelled', locale) });
        return true;
      }
      const isSkip = /^(SKIP|PASSER|تخطي)$/i.test(cleaned);
      const reason = isSkip ? '' : cleaned.trim();
      if (reason.length > 200) {
        await sendMessage({ to: identifier, body: t('intake_invalid_reason', locale) });
        return true;
      }
      // Check for custom intake fields
      const { data: orgCustom } = await supabase.from('organizations').select('settings').eq('id', session.organization_id).single();
      const bookingCustomFields: any[] = (orgCustom?.settings as any)?.custom_intake_fields ?? [];
      if (bookingCustomFields.length > 0) {
        await supabase.from('whatsapp_sessions').update({
          intake_reason: reason || null,
          state: 'pending_custom_intake',
          custom_intake_data: { index: 0, answers: {} },
        }).eq('id', session.id);
        const firstField = bookingCustomFields[0];
        const fieldLabel = locale === 'ar' ? (firstField.label_ar || firstField.label) : locale === 'fr' ? (firstField.label_fr || firstField.label) : firstField.label;
        await sendMessage({ to: identifier, body: t('custom_intake_prompt', locale, { field: fieldLabel }) });
      } else {
        await supabase.from('whatsapp_sessions').update({
          intake_reason: reason || null,
          state: 'booking_confirm',
        }).eq('id', session.id);
        const orgName = await getOrgName(session.organization_id);
        const dateFormatted = formatDateForLocale(session.booking_date, locale);
        const orgSettings = (orgCustom?.settings ?? {}) as Record<string, any>;
        await sendMessage({
          to: identifier,
          body: t('booking_confirm', locale, {
            name: orgName,
            date: dateFormatted,
            time: session.booking_time,
            fields: buildBookingFieldsSummary(
              { name: session.booking_customer_name, wilaya: session.booking_customer_wilaya, reason: reason },
              orgSettings, locale, channel,
            ),
          }),
        });
      }
      return true;
    }

    case 'booking_enter_phone': {
      // Cancel booking if user sends 0
      if (cleaned === '0') {
        await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
        await sendMessage({ to: identifier, body: t('booking_cancelled', locale) });
        return true;
      }
      const isSkip = /^(SKIP|PASSER|تخطي)$/i.test(cleaned);
      const phone = isSkip ? identifier : cleaned.trim();
      // Save phone and go to confirm
      await supabase.from('whatsapp_sessions').update({
        state: 'booking_confirm',
      }).eq('id', session.id);

      // Store phone temporarily (we'll use identifier as phone if skipped)
      const phoneAnswers = (session.custom_intake_data as any)?.answers ?? {};
      const orgName = await getOrgName(session.organization_id);
      const dateFormatted = formatDateForLocale(session.booking_date, locale);
      const { data: orgPhone } = await supabase.from('organizations').select('settings').eq('id', session.organization_id).single();
      const mergedPhone = { ...phoneAnswers, name: phoneAnswers.name || session.booking_customer_name, wilaya: phoneAnswers.wilaya || session.booking_customer_wilaya, reason: phoneAnswers.reason || session.intake_reason, phone };
      await sendMessage({
        to: identifier,
        body: t('booking_confirm', locale, {
          name: orgName,
          date: dateFormatted,
          time: session.booking_time,
          fields: buildBookingFieldsSummary(mergedPhone, ((orgPhone?.settings ?? {}) as Record<string, any>), locale, channel),
        }),
      });
      return true;
    }

    case 'booking_confirm': {
      const isYes = /^(OUI|YES|نعم|Y|O|1|OK|CONFIRM|CONFIRMER|تاكيد|تأكيد)$/i.test(cleaned);
      const isNo = /^(NON|NO|لا|N|ANNULER|CANCEL|الغاء|إلغاء)$/i.test(cleaned);

      if (isYes) {
        await confirmBooking(session, identifier, locale, channel, sendMessage);
        return true;
      }
      if (isNo) {
        await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
        await sendMessage({ to: identifier, body: t('booking_cancelled', locale) });
        return true;
      }
      // Re-show confirmation (read from unified answers + legacy columns)
      const confirmAnswers = (session.custom_intake_data as any)?.answers ?? {};
      const orgName = await getOrgName(session.organization_id);
      const dateFormatted = formatDateForLocale(session.booking_date, locale);
      const { data: orgConfirm } = await supabase.from('organizations').select('settings').eq('id', session.organization_id).single();
      const mergedConfirm = { ...confirmAnswers, name: confirmAnswers.name || session.booking_customer_name, wilaya: confirmAnswers.wilaya || session.booking_customer_wilaya, reason: confirmAnswers.reason || session.intake_reason };
      await sendMessage({
        to: identifier,
        body: t('booking_confirm', locale, {
          name: orgName,
          date: dateFormatted,
          time: session.booking_time,
          fields: buildBookingFieldsSummary(mergedConfirm, ((orgConfirm?.settings ?? {}) as Record<string, any>), locale, channel),
        }),
      });
      return true;
    }

    default:
      return false;
  }
}

async function handleBookingServiceChoice(
  session: any, cleaned: string, identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
): Promise<boolean> {
  const numMatch = cleaned.match(/^(\d{1,2})$/);
  if (!numMatch) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const idx = parseInt(numMatch[1], 10);
  const supabase = createAdminClient() as any;

  // Get services for this org's office
  const { data: departments } = await supabase
    .from('departments')
    .select('id')
    .eq('office_id', session.office_id);

  const deptIds = (departments ?? []).map((d: any) => d.id);
  const { data: services } = await supabase
    .from('services')
    .select('id, name, department_id')
    .in('department_id', deptIds.length > 0 ? deptIds : ['none']);

  if (!services || idx < 1 || idx > services.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const svc = services[idx - 1];
  await supabase.from('whatsapp_sessions').update({
    state: 'booking_select_date',
    department_id: svc.department_id,
    service_id: svc.id,
  }).eq('id', session.id);

  const orgName = await getOrgName(session.organization_id);
  await showAvailableDates(identifier, orgName, session.office_id, svc.id, locale, channel, sendMessage);
  return true;
}

async function handleBookingDateChoice(
  session: any, cleaned: string, identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
): Promise<boolean> {
  const supabase = createAdminClient() as any;
  // Current page stored as "page:N" in booking_date while in date selection
  const currentPage = session.booking_date?.startsWith('page:') ? Number(session.booking_date.split(':')[1]) : 0;

  // Pagination: # = next page, * = prev page
  if (cleaned === '#' || (cleaned === '*' && currentPage > 0)) {
    const newPage = cleaned === '#' ? currentPage + 1 : Math.max(0, currentPage - 1);
    await supabase.from('whatsapp_sessions').update({ booking_date: `page:${newPage}` }).eq('id', session.id);
    const orgName = await getOrgName(session.organization_id);
    await showAvailableDates(identifier, orgName, session.office_id, session.service_id || session.department_id, locale, channel, sendMessage, newPage);
    return true;
  }

  const numMatch = cleaned.match(/^(\d{1,2})$/);
  if (!numMatch) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const idx = parseInt(numMatch[1], 10);
  if (idx === 0) {
    // Go back — re-show service list
    await supabase.from('whatsapp_sessions').update({ state: 'booking_select_service', service_id: null, booking_date: null }).eq('id', session.id);
    const orgName = await getOrgName(session.organization_id);
    const { data: departments } = await supabase.from('departments').select('id').eq('office_id', session.office_id);
    const deptIds = (departments ?? []).map((d: any) => d.id);
    const { data: services } = await supabase.from('services').select('id, name, department_id').in('department_id', deptIds.length > 0 ? deptIds : ['none']);
    if (services && services.length > 1) {
      const list = services.map((s: any, i: number) => `*${i + 1}* — ${s.name}`).join('\n');
      await sendMessage({ to: identifier, body: t('booking_choose_service', locale, { name: orgName, list }) });
    }
    return true;
  }

  // Fetch all available dates — idx is 1-based across ALL pages
  const { getAvailableDates } = await import('@/lib/slot-generator');
  const dates = await getAvailableDates(session.office_id, session.service_id || session.department_id);

  if (!dates || idx < 1 || idx > dates.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const chosen = dates[idx - 1];
  await supabase.from('whatsapp_sessions').update({
    state: 'booking_select_time',
    booking_date: chosen.date,
  }).eq('id', session.id);

  // Show time slots
  await showAvailableSlots(identifier, session.office_id, session.service_id || session.department_id, chosen.date, locale, channel, sendMessage);
  return true;
}

async function handleBookingTimeChoice(
  session: any, cleaned: string, identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
): Promise<boolean> {
  const numMatch = cleaned.match(/^(\d{1,2})$/);
  if (!numMatch) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const idx = parseInt(numMatch[1], 10);
  if (idx === 0) {
    // Go back to date selection
    const supabase = createAdminClient() as any;
    await supabase.from('whatsapp_sessions').update({ state: 'booking_select_date', booking_date: null }).eq('id', session.id);
    const orgName = await getOrgName(session.organization_id);
    await showAvailableDates(identifier, orgName, session.office_id, session.service_id || session.department_id, locale, channel, sendMessage);
    return true;
  }

  // Fetch slots for the date (includes taken ones — the index the user
  // typed is 1-based over the FULL displayed list, so we must keep
  // taken slots in-place here to match.)
  const { getAvailableSlots } = await import('@/lib/slot-generator');
  const result = await getAvailableSlots({
    officeId: session.office_id,
    serviceId: session.service_id || session.department_id,
    date: session.booking_date,
  });

  if (!result.slots || idx < 1 || idx > result.slots.length) {
    await sendMessage({ to: identifier, body: t('invalid_choice', locale) });
    return true;
  }

  const chosenSlot = result.slots[idx - 1];

  // Reject taken slots with a friendly message and re-show the list.
  // The customer can see all options (available + taken) so this
  // should only fire if they deliberately pick a crossed-out number.
  if (chosenSlot.available === false) {
    const takenMsg = locale === 'ar'
      ? `⚠️ الوقت *${chosenSlot.time}* محجوز بالفعل. الرجاء اختيار وقت آخر.`
      : locale === 'fr'
        ? `⚠️ Le créneau *${chosenSlot.time}* est déjà réservé. Veuillez choisir un autre horaire.`
        : `⚠️ The slot *${chosenSlot.time}* is already taken. Please choose another time.`;
    await sendMessage({ to: identifier, body: takenMsg });
    await showAvailableSlots(identifier, session.office_id, session.service_id || session.department_id, session.booking_date, locale, channel, sendMessage);
    return true;
  }
  const supabase = createAdminClient() as any;

  // Check if name can be skipped for same-day bookings
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('settings, timezone')
    .eq('id', session.organization_id)
    .single();

  // Use unified intake fields system (phone auto-collected on WhatsApp only)
  // Future booking → context 'booking'
  const bookingPhoneExclude = channel === 'whatsapp' ? ['phone'] : [];
  const bookingEnabledFields = getEnabledIntakeFields((orgRow?.settings ?? {}) as Record<string, any>, bookingPhoneExclude, 'booking');

  if (bookingEnabledFields.length > 0) {
    // Intake fields to collect — go to unified pending_custom_intake
    await supabase.from('whatsapp_sessions').update({
      state: 'pending_custom_intake',
      booking_time: chosenSlot.time,
      custom_intake_data: { index: 0, answers: {} },
    }).eq('id', session.id);

    const firstField = bookingEnabledFields[0];
    const fieldLabel = getFieldLabel(firstField, locale);
    await sendMessage({ to: identifier, body: t('custom_intake_prompt', locale, { field: fieldLabel }) });
  } else {
    // No intake fields — go straight to booking_confirm
    await supabase.from('whatsapp_sessions').update({
      state: 'booking_confirm',
      booking_time: chosenSlot.time,
    }).eq('id', session.id);

    const orgName = await getOrgName(session.organization_id);
    const dateFormatted = formatDateForLocale(session.booking_date, locale);
    await sendMessage({
      to: identifier,
      body: t('booking_confirm', locale, {
        name: orgName,
        date: dateFormatted,
        time: chosenSlot.time,
        fields: buildBookingFieldsSummary(
          { name: session.booking_customer_name, wilaya: session.booking_customer_wilaya, reason: session.intake_reason },
          (orgRow?.settings ?? {}) as Record<string, any>, locale, channel,
        ),
      }),
    });
  }

  return true;
}

async function handleBookingNameInput(
  session: any, cleaned: string, identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
): Promise<boolean> {
  if (cleaned.length < 2 || cleaned.length > 100) {
    await sendMessage({ to: identifier, body: t('booking_enter_name', locale) });
    return true;
  }

  const supabase = createAdminClient() as any;
  await supabase.from('whatsapp_sessions').update({
    state: 'booking_enter_wilaya',
    booking_customer_name: cleaned,
  }).eq('id', session.id);

  await sendMessage({ to: identifier, body: t('booking_enter_wilaya', locale) });
  return true;
}

async function confirmBooking(
  session: any, identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
) {
  const supabase = createAdminClient() as any;

  // Re-fetch session to ensure latest intake fields are present
  const { data: fresh } = await supabase
    .from('whatsapp_sessions')
    .select('booking_customer_wilaya, intake_reason, custom_intake_data')
    .eq('id', session.id)
    .maybeSingle();
  // Read from unified answers first, then legacy columns
  const unifiedAnswers = (fresh?.custom_intake_data as any)?.answers ?? (session.custom_intake_data as any)?.answers ?? {};
  const wilaya = unifiedAnswers.wilaya || fresh?.booking_customer_wilaya || session.booking_customer_wilaya || null;
  const reason = unifiedAnswers.reason || fresh?.intake_reason || session.intake_reason || null;
  const customerName = unifiedAnswers.name || session.booking_customer_name || null;

  // Build scheduled_at from booking_date + booking_time in the org's timezone
  let scheduledAt = `${session.booking_date}T${session.booking_time}:00`;
  let bookingOrgTz = 'Africa/Algiers';
  try {
    const { toTimezoneAware } = await import('@/lib/timezone');
    const { data: orgTzRow } = await supabase
      .from('organizations')
      .select('timezone')
      .eq('id', session.organization_id)
      .single();
    bookingOrgTz = orgTzRow?.timezone || 'Africa/Algiers';
    scheduledAt = toTimezoneAware(scheduledAt, bookingOrgTz);
  } catch { /* fallback to naive string */ }

  // Centralized booking gate — same rules the web/admin paths enforce.
  // Rejects bookings when the business has booking_mode=disabled, is
  // always_closed, the office is closed on the day, it's a holiday, the
  // daily limit is reached, or the slot is taken. Keeps WhatsApp/Messenger
  // in lockstep with every other write path.
  try {
    await assertBookingAllowed({
      officeId: session.office_id,
      serviceId: session.service_id || session.department_id,
      scheduledAt: `${session.booking_date}T${session.booking_time}:00`,
    });
  } catch (err) {
    if (err instanceof BookingGuardError) {
      console.warn('[booking] blocked by guard:', err.reason, err.message);
      // Map guard reason → user-facing chat reply, then reset the session
      // to the appropriate step so the user can recover without losing context.
      if (err.reason === 'slot_unavailable' || err.reason === 'daily_limit_reached') {
        await sendMessage({ to: identifier, body: t('booking_slot_taken', locale) });
        await supabase.from('whatsapp_sessions').update({
          state: 'booking_select_time',
          booking_time: null,
        }).eq('id', session.id);
        await showAvailableSlots(identifier, session.office_id, session.service_id || session.department_id, session.booking_date, locale, channel, sendMessage);
        return;
      }
      // Hard blocks (disabled / always_closed / office_closed / holiday):
      // cancel the session and tell the user the business isn't booking.
      await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
      await sendMessage({ to: identifier, body: err.message });
      return;
    }
    throw err;
  }

  // Create appointment via direct insert (using service role)
  const { nanoid } = await import('nanoid');
  const calendarToken = nanoid(16);

  // Approval gate (mirrors web booking + admin createAppointment).
  // Default ON: bookings stay pending until provider approves.
  const { data: orgRowApproval } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', session.organization_id)
    .single();
  let requireApproval = Boolean(
    (orgRowApproval?.settings as any)?.require_appointment_approval ?? true,
  );
  // Per-customer override: when a customer row in this org is flagged
  // `auto_approve_reservations`, their WhatsApp/Messenger bookings are
  // auto-confirmed regardless of the org setting. `identifier` is the phone
  // number — same key the Station UI writes the flag against.
  if (requireApproval && identifier && session.organization_id) {
    try {
      const { isCustomerAutoApprove } = await import('@/lib/customer-auto-approve');
      const trusted = await isCustomerAutoApprove(
        supabase,
        session.organization_id,
        identifier,
        bookingOrgTz,
      );
      if (trusted) requireApproval = false;
    } catch { /* best-effort */ }
  }
  const initialStatus = requireApproval ? 'pending' : 'confirmed';

  const { data: appointment, error } = await supabase
    .from('appointments')
    .insert({
      office_id: session.office_id,
      department_id: session.department_id,
      service_id: session.service_id,
      customer_name: customerName || identifier,
      customer_phone: identifier, // WhatsApp phone number
      scheduled_at: scheduledAt,
      status: initialStatus,
      calendar_token: calendarToken,
      wilaya: wilaya,
      notes: (() => {
        // Build notes from non-core unified answers (exclude name/wilaya/reason/phone which have dedicated columns)
        const extraAnswers = Object.entries(unifiedAnswers).filter(([k]) => !['name', 'wilaya', 'reason', 'phone'].includes(k));
        const extraLines = extraAnswers.map(([k, v]) => `${k}: ${v}`).join('\n');
        if (extraLines && reason) return `${reason}\n---\n${extraLines}`;
        if (extraLines) return extraLines;
        return reason;
      })(),
      locale,
      source: channel === 'messenger' ? 'messenger' : 'whatsapp',
    })
    .select('id')
    .single();

  if (error) {
    // Race protection: 23505 is raised by both the partial unique index
    // `uniq_appointments_active_slot` and the `check_slot_capacity` trigger
    // when the slot was taken by a concurrent booker between slot listing
    // and confirmation. Don't kill the session — loop the user back to slot
    // selection with a fresh list.
    const code = (error as any).code;
    const msg = error.message || '';
    const slotTaken = code === '23505' || msg.includes('slot_full') || msg.includes('uniq_appointments_active_slot') || msg.includes('fully booked');
    if (slotTaken) {
      console.warn('[booking] slot just taken (race), restarting time selection:', msg);
      await sendMessage({ to: identifier, body: t('booking_slot_taken', locale) });
      await supabase.from('whatsapp_sessions').update({
        state: 'booking_select_time',
        booking_time: null,
      }).eq('id', session.id);
      await showAvailableSlots(identifier, session.office_id, session.service_id || session.department_id, session.booking_date, locale, channel, sendMessage);
      return;
    }
    console.error('[booking] Failed to create appointment:', msg);
    await supabase.from('whatsapp_sessions').delete().eq('id', session.id);
    await sendMessage({ to: identifier, body: t('booking_failed', locale) });
    return;
  }

  // Auto-add this customer to the customers table (non-fatal on error)
  // Pass raw wilaya — upsertCustomerFromBooking normalizes to code via toWilayaCode()
  const wilayaCode = wilaya ? wilaya.trim() : null;
  await upsertCustomerFromBooking(supabase, {
    organizationId: session.organization_id,
    name: customerName || undefined,
    phone: identifier,
    wilayaCode,
    source: channel === 'messenger' ? 'messenger' : 'whatsapp',
    timezone: bookingOrgTz,
  });

  // Clean up booking session
  await supabase.from('whatsapp_sessions').delete().eq('id', session.id);

  const orgName = await getOrgName(session.organization_id);
  const dateFormatted = formatDateForLocale(session.booking_date, locale);

  // When approval is required, use the pending_approval message so the
  // customer knows the booking isn't final until staff act on it. The slot
  // is held in the meantime.
  const templateKey = requireApproval ? 'booking_pending_approval' : 'booking_confirmed';
  await sendMessage({
    to: identifier,
    body: t(templateKey, locale, {
      name: orgName,
      date: dateFormatted,
      time: session.booking_time,
      customer: session.booking_customer_name,
    }),
  });
}

async function handleMyBookings(
  identifier: string, locale: Locale, sendMessage: SendFn,
) {
  const supabase = createAdminClient() as any;
  const now = new Date().toISOString();

  // Match by digits-only: stored phone may be in any format
  // (213..., +213..., 0..., local...). Fetch upcoming appointments in a
  // bounded window and filter in JS by comparing digit suffixes so any
  // phone format stored in customer_phone is matched reliably.
  const digits = identifier.replace(/\D/g, '');
  const last9 = digits.slice(-9);

  const in60d = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error: apptErr } = await supabase
    .from('appointments')
    .select('id, scheduled_at, status, customer_name, customer_phone, office_id, service_id')
    .in('status', ['pending', 'confirmed', 'checked_in'])
    .gte('scheduled_at', now)
    .lte('scheduled_at', in60d)
    .not('customer_phone', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(500);

  if (apptErr) {
    console.error('[my-bookings] query error', apptErr);
  }

  const appts = (candidates ?? []).filter((a: any) => {
    const d = String(a.customer_phone ?? '').replace(/\D/g, '');
    return d.length >= 9 && d.slice(-9) === last9;
  }).slice(0, 20);

  if (!appts || appts.length === 0) {
    await sendMessage({ to: identifier, body: t('my_bookings_none', locale) });
    return;
  }

  // Resolve office → organization, and fetch service names
  const officeIds = Array.from(new Set(appts.map((a: any) => a.office_id).filter(Boolean)));
  const svcIds = Array.from(new Set(appts.map((a: any) => a.service_id).filter(Boolean)));
  const [officesRes, svcsRes] = await Promise.all([
    officeIds.length ? supabase.from('offices').select('id, organization_id, organizations(name, timezone)').in('id', officeIds) : Promise.resolve({ data: [] }),
    svcIds.length ? supabase.from('services').select('id, name').in('id', svcIds) : Promise.resolve({ data: [] }),
  ]);
  const officeOrgMap = new Map<string, string>(
    (officesRes.data ?? []).map((o: any) => [o.id, o.organizations?.name ?? ''])
  );
  // Org timezone map — single source of truth per office
  const officeTzMap = new Map<string, string>(
    (officesRes.data ?? []).map((o: any) => [o.id, o.organizations?.timezone || 'Africa/Algiers'])
  );
  const svcMap = new Map<string, string>((svcsRes.data ?? []).map((s: any) => [s.id, s.name]));

  const statusLabel = (s: string): string => {
    if (locale === 'ar') return s === 'confirmed' ? '✅ مؤكد' : s === 'checked_in' ? '🟣 تم الحضور' : '⏳ قيد الانتظار';
    if (locale === 'fr') return s === 'confirmed' ? '✅ confirmé' : s === 'checked_in' ? '🟣 enregistré' : '⏳ en attente';
    return s === 'confirmed' ? '✅ confirmed' : s === 'checked_in' ? '🟣 checked in' : '⏳ pending';
  };

  const list = appts.map((a: any, i: number) => {
    const d = new Date(a.scheduled_at);
    const tz = officeTzMap.get(a.office_id) || 'Africa/Algiers';
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
    const tp = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    const timeStr = `${tp.find(p => p.type === 'hour')?.value ?? '00'}:${tp.find(p => p.type === 'minute')?.value ?? '00'}`;
    const dateFormatted = formatDateForLocale(dateStr, locale);
    const org = officeOrgMap.get(a.office_id) ?? '';
    const svc = a.service_id ? (svcMap.get(a.service_id) ?? '') : '';
    const svcPart = svc ? ` — ${svc}` : '';
    const idx = toLocaleDigits(i + 1, locale);
    // Arabic: title-first so in RTL the title lands on the right (visual
    // start) and the number on the left (visual end). Arabic-Indic digits
    // are strong-RTL so bidi won't reflow them weirdly.
    if (locale === 'ar') {
      return `🏢 ${org}${svcPart} *${idx}*\n   📅 ${dateFormatted} ⏰ ${timeStr}\n   ${statusLabel(a.status)}`;
    }
    return `*${idx}* — 🏢 ${org}${svcPart}\n   📅 ${dateFormatted} ⏰ ${timeStr}\n   ${statusLabel(a.status)}`;
  }).join('\n\n');

  await sendMessage({ to: identifier, body: t('my_bookings_list', locale, { list }) });
}

async function handleCancelBooking(
  identifier: string, locale: Locale, channel: Channel, sendMessage: SendFn,
  pickIndex: number | null = null,
) {
  const supabase = createAdminClient() as any;

  // Find upcoming appointments for this phone number (same ordering as MY BOOKINGS)
  const now = new Date().toISOString();
  const digits = identifier.replace(/\D/g, '');
  const last9 = digits.slice(-9);
  const in60d = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates } = await supabase
    .from('appointments')
    .select('id, scheduled_at, status, office_id, service_id, customer_name, customer_phone')
    .in('status', ['pending', 'confirmed', 'checked_in'])
    .gte('scheduled_at', now)
    .lte('scheduled_at', in60d)
    .not('customer_phone', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(500);
  const appointments = (candidates ?? []).filter((a: any) => {
    const d = String(a.customer_phone ?? '').replace(/\D/g, '');
    return d.length >= 9 && d.slice(-9) === last9;
  }).slice(0, 20);

  if (!appointments || appointments.length === 0) {
    await sendMessage({ to: identifier, body: t('cancel_booking_none', locale) });
    return;
  }

  // Multi-booking: present picker unless an index was supplied
  if (appointments.length > 1 && pickIndex === null) {
    // Resolve office → org and service names for display
    const officeIds = Array.from(new Set(appointments.map((a: any) => a.office_id).filter(Boolean)));
    const svcIds = Array.from(new Set(appointments.map((a: any) => a.service_id).filter(Boolean)));
    const [officesRes, svcsRes] = await Promise.all([
      officeIds.length ? supabase.from('offices').select('id, organizations(name, timezone)').in('id', officeIds) : Promise.resolve({ data: [] }),
      svcIds.length ? supabase.from('services').select('id, name').in('id', svcIds) : Promise.resolve({ data: [] }),
    ]);
    const officeOrgMap = new Map<string, string>(
      (officesRes.data ?? []).map((o: any) => [o.id, o.organizations?.name ?? ''])
    );
    const officeTzMap2 = new Map<string, string>(
      (officesRes.data ?? []).map((o: any) => [o.id, o.organizations?.timezone || 'Africa/Algiers'])
    );
    const svcMap = new Map<string, string>((svcsRes.data ?? []).map((s: any) => [s.id, s.name]));

    const list = appointments.map((a: any, i: number) => {
      const d = new Date(a.scheduled_at);
      const tz2 = officeTzMap2.get(a.office_id) || 'Africa/Algiers';
      const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz2 }).format(d);
      const tp2 = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz2 }).formatToParts(d);
      const timeStr = `${tp2.find(p => p.type === 'hour')?.value ?? '00'}:${tp2.find(p => p.type === 'minute')?.value ?? '00'}`;
      const dateFormatted = formatDateForLocale(dateStr, locale);
      const org = officeOrgMap.get(a.office_id) ?? '';
      const svc = a.service_id ? (svcMap.get(a.service_id) ?? '') : '';
      const svcPart = svc ? ` — ${svc}` : '';
      return `*${i + 1}* — 🏢 ${org}${svcPart}\n   📅 ${dateFormatted} ⏰ ${timeStr}`;
    }).join('\n\n');

    await sendMessage({ to: identifier, body: t('cancel_booking_pick', locale, { list }) });
    return;
  }

  // Single booking OR index supplied
  const resolvedIdx = pickIndex === null ? 1 : pickIndex;
  if (resolvedIdx < 1 || resolvedIdx > appointments.length) {
    await sendMessage({ to: identifier, body: t('cancel_booking_bad_index', locale) });
    return;
  }

  const appt = appointments[resolvedIdx - 1];
  // Fetch org timezone for this appointment's office
  const { data: cancelOfficeRow } = await supabase.from('offices').select('organizations(timezone)').eq('id', appt.office_id).maybeSingle();
  const cancelTz: string = (cancelOfficeRow as any)?.organizations?.timezone || 'Africa/Algiers';
  const scheduledDate = new Date(appt.scheduled_at);
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: cancelTz }).format(scheduledDate);
  const cancelTp = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: cancelTz }).formatToParts(scheduledDate);
  const timeStr = `${cancelTp.find(p => p.type === 'hour')?.value ?? '00'}:${cancelTp.find(p => p.type === 'minute')?.value ?? '00'}`;

  await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', appt.id);

  const dateFormatted = formatDateForLocale(dateStr, locale);
  await sendMessage({
    to: identifier,
    body: t('cancel_booking_done', locale, { date: dateFormatted, time: timeStr }),
  });
}

// ── Booking helpers ──

const DATES_PER_PAGE = 7;

async function showAvailableDates(
  identifier: string, orgName: string, officeId: string, serviceId: string,
  locale: Locale, channel: Channel, sendMessage: SendFn,
  page: number = 0,
) {
  const { getAvailableDates } = await import('@/lib/slot-generator');
  const allDates = await getAvailableDates(officeId, serviceId);

  if (allDates.length === 0) {
    await sendMessage({ to: identifier, body: t('booking_no_dates', locale) });
    return;
  }

  const totalPages = Math.ceil(allDates.length / DATES_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageStart = safePage * DATES_PER_PAGE;
  const pageDates = allDates.slice(pageStart, pageStart + DATES_PER_PAGE);

  const list = pageDates.map((d, i) => {
    const formatted = formatDateForLocale(d.date, locale);
    const slotsLabel = locale === 'ar' ? `${d.slotCount} متاح` : locale === 'fr' ? `${d.slotCount} dispo.` : `${d.slotCount} avail.`;
    return `*${pageStart + i + 1}* — ${formatted} (${slotsLabel})`;
  }).join('\n');

  // Pagination hints — clear, visible navigation for more dates
  let pagination = '';
  if (totalPages > 1) {
    const remaining = allDates.length - (pageStart + pageDates.length);
    const parts: string[] = [];

    if (locale === 'ar') {
      parts.push(`📄 صفحة ${safePage + 1} من ${totalPages}`);
      if (safePage < totalPages - 1) parts.push(`⬇️ *${remaining} تواريخ إضافية متاحة!*\n📲 أرسل *#* لعرض المزيد من التواريخ`);
      if (safePage > 0) parts.push(`⬆️ أرسل *\\** للعودة للتواريخ السابقة`);
    } else if (locale === 'fr') {
      parts.push(`📄 Page ${safePage + 1}/${totalPages}`);
      if (safePage < totalPages - 1) parts.push(`⬇️ *${remaining} dates supplémentaires disponibles !*\n📲 Envoyez *#* pour voir plus de dates`);
      if (safePage > 0) parts.push(`⬆️ Envoyez *\\** pour revenir aux dates précédentes`);
    } else {
      parts.push(`📄 Page ${safePage + 1} of ${totalPages}`);
      if (safePage < totalPages - 1) parts.push(`⬇️ *${remaining} more dates available!*\n📲 Send *#* to see more dates`);
      if (safePage > 0) parts.push(`⬆️ Send *\\** to go back to previous dates`);
    }
    pagination = parts.join('\n') + '\n\n';
  }

  await sendMessage({ to: identifier, body: t('booking_choose_date', locale, { list, pagination }) });
}

async function showAvailableSlots(
  identifier: string, officeId: string, serviceId: string, date: string,
  locale: Locale, channel: Channel, sendMessage: SendFn,
) {
  const { getAvailableSlots } = await import('@/lib/slot-generator');
  const result = await getAvailableSlots({ officeId, serviceId, date });

  // If the whole day has nothing to show (no slots at all — closed,
  // holiday, etc.) tell the customer. A day with only taken slots still
  // has entries, so we fall through and render them so the customer
  // understands "everything is booked today" at a glance.
  if (result.slots.length === 0) {
    await sendMessage({ to: identifier, body: t('booking_no_slots', locale) });
    return;
  }

  // Numbered list preserves index→slot mapping so the user can reply
  // with a digit. Taken slots are shown with a strikethrough and
  // (taken) tag; the reply handler rejects taken numbers with a
  // friendly message and re-shows the same list.
  const takenWord = locale === 'ar' ? 'محجوز' : locale === 'fr' ? 'réservé' : 'taken';
  const fullDayWord = locale === 'ar' ? 'اليوم ممتلئ' : locale === 'fr' ? 'journée complète' : 'full day';
  const spotsWord = locale === 'ar' ? 'متاح' : locale === 'fr' ? 'places' : 'spots';
  const list = result.slots.map((s, i) => {
    const idx = i + 1;
    if (s.available === false) {
      const label = s.reason === 'daily_limit' ? fullDayWord : takenWord;
      // WhatsApp/Messenger render ~text~ as strikethrough.
      return `~*${idx}* — ${s.time}~ _(${label})_`;
    }
    const remaining = s.remaining > 1 ? ` (${s.remaining} ${spotsWord})` : '';
    return `*${idx}* — ${s.time}${remaining}`;
  }).join('\n');

  const dateFormatted = formatDateForLocale(date, locale);
  await sendMessage({ to: identifier, body: t('booking_choose_time', locale, { date: dateFormatted, list }) });
}

async function getOrgName(orgId: string): Promise<string> {
  const supabase = createAdminClient() as any;
  const { data } = await supabase.from('organizations').select('name').eq('id', orgId).single();
  return data?.name ?? '';
}

/** Build the dynamic intake fields section for booking summary */
const FIELD_EMOJI: Record<string, string> = { name: '👤', wilaya: '📍', reason: '📝', phone: '📞', email: '📧', age: '🎂', party_size: '👥' };
function buildBookingFieldsSummary(
  answers: Record<string, string>,
  orgSettings: Record<string, any>,
  locale: Locale,
  channel: string,
  /** Legacy fallback values from session columns (pre-intake-fields bookings) */
  legacy?: { customer?: string; wilaya?: string; reason?: string },
): string {
  const phoneExclude = channel === 'whatsapp' ? ['phone'] : [];
  const enabledFields = getEnabledIntakeFields(orgSettings, phoneExclude, 'booking');
  const lines: string[] = [];
  for (const field of enabledFields) {
    const value = answers[field.key] || (legacy as any)?.[field.key === 'name' ? 'customer' : field.key] || '';
    if (!value) continue;
    const emoji = FIELD_EMOJI[field.key] || '📋';
    const label = getFieldLabel(field, locale);
    lines.push(`${emoji} ${label}: *${value}*`);
  }
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}

function formatDateForLocale(dateStr: string, locale: Locale): string {
  const d = new Date(dateStr + 'T12:00:00');
  if (locale === 'ar') {
    return d.toLocaleDateString('ar-DZ', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  if (locale === 'fr') {
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

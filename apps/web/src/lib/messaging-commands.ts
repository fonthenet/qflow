import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getQueuePosition } from '@/lib/queue-position';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';
import { BUSINESS_CATEGORIES } from '@/lib/business-categories';

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

type Locale = 'fr' | 'ar' | 'en';

// ── i18n translations ────────────────────────────────────────────────

const messages: Record<string, Record<Locale, string>> = {
  welcome: {
    fr: [
      '👋 Bienvenue sur *Qflo* !',
      '',
      'Pour rejoindre une file, envoyez :',
      '*REJOINDRE <code>*',
      '',
      'Exemple : *REJOINDRE HADABI*',
      '',
      'Le code se trouve sur l\'affiche QR ou la page d\'inscription.',
      '',
      'Envoyez *LISTE* pour voir les entreprises disponibles.',
    ].join('\n'),
    ar: [
      'مرحبًا بك في *Qflo*! 👋',
      '',
      'للانضمام إلى الطابور، أرسل:',
      '*انضم <الرمز>*',
      '',
      'مثال: *انضم HADABI*',
      '',
      'ستجد الرمز على ملصق QR أو صفحة الانضمام.',
      '',
      'أرسل *القائمة* لعرض الأعمال المتاحة.',
    ].join('\n'),
    en: [
      '👋 Welcome to *Qflo*!',
      '',
      'To join a queue, send:',
      '*JOIN <business code>*',
      '',
      'Example: *JOIN HADABI*',
      '',
      'You\'ll find the code on the business\'s QR poster or join page.',
      '',
      'Send *LIST* to browse available businesses.',
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
    fr: 'Vous êtes déjà dans la file chez *{name}*.\n{position}\n\nRépondez *STATUT* pour les mises à jour ou *ANNULER* pour quitter.',
    ar: 'أنت بالفعل في الطابور في *{name}*.\n{position}\n\nأرسل *حالة* للتحديثات أو *إلغاء* للمغادرة.',
    en: 'You\'re already in the queue at *{name}*.\n{position}\n\nReply *STATUS* for updates or *CANCEL* to leave.',
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
    fr: '✅ Vous êtes dans la file chez *{name}* !\n\n🎫 Ticket : *{ticket}*\n{position}{now_serving}\n\n📍 Suivez votre position : {url}\n\nRépondez *STATUT* pour les mises à jour ou *ANNULER* pour quitter.',
    ar: 'أنت في الطابور في *{name}*! ✅\n\nالتذكرة: *{ticket}* 🎫\n{position}{now_serving}\n\nتتبع موقعك: {url} 📍\n\nأرسل *حالة* للتحديثات أو *إلغاء* للمغادرة.',
    en: '✅ You\'re in the queue at *{name}*!\n\n🎫 Ticket: *{ticket}*\n{position}{now_serving}\n\n📍 Track your position: {url}\n\nReply *STATUS* for updates or *CANCEL* to leave.',
  },
  your_turn: {
    fr: '🔔 *C\'est votre tour !* Veuillez vous diriger vers le point de service.',
    ar: '*حان دورك!* يرجى التوجه إلى نقطة الخدمة 🔔',
    en: '🔔 *It\'s your turn!* Please proceed to your service point.',
  },
  ticket_inactive: {
    fr: 'Votre ticket n\'est plus actif. Envoyez *REJOINDRE <code>* pour rejoindre à nouveau.',
    ar: 'تذكرتك لم تعد نشطة. أرسل *انضم <الرمز>* للانضمام مجددًا.',
    en: 'Your ticket is no longer active. Send *JOIN <code>* to join again.',
  },
  status: {
    fr: '📊 *État de la file — {name}*\n\n🎫 Ticket : *{ticket}*\n📍 Votre position : *{position}*\n⏱ Attente estimée : *{wait} min*\n{now_serving}👥 En attente : *{total}*\n\nRépondez *ANNULER* pour quitter la file.',
    ar: '*حالة الطابور — {name}* 📊\n\nالتذكرة: *{ticket}* 🎫\nموقعك: *{position}* 📍\nالانتظار المقدر: *{wait} دقيقة* ⏱\n{now_serving}في الانتظار: *{total}* 👥\n\nأرسل *إلغاء* للمغادرة.',
    en: '📊 *Queue Status — {name}*\n\n🎫 Ticket: *{ticket}*\n📍 Your position: *{position}*\n⏱ Estimated wait: *{wait} min*\n{now_serving}👥 Total waiting: *{total}*\n\nReply *CANCEL* to leave the queue.',
  },
  cancelled: {
    fr: '🚫 Votre ticket *{ticket}* chez *{name}* a été annulé.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à tout moment.',
    ar: 'تم إلغاء تذكرتك *{ticket}* في *{name}* 🚫\n\nأرسل *انضم <الرمز>* للانضمام في أي وقت.',
    en: '🚫 Your ticket *{ticket}* at *{name}* has been cancelled.\n\nSend *JOIN <code>* to rejoin anytime.',
  },
  help_with_session: {
    fr: '📋 *{name}* — File\n\nCommandes :\n• *STATUT* — Vérifier votre position\n• *ANNULER* — Quitter la file\n• *LISTE* — Voir les entreprises',
    ar: '*{name}* — الطابور 📋\n\nالأوامر:\n*حالة* — التحقق من موقعك •\n*إلغاء* — مغادرة الطابور •\n*القائمة* — عرض الأعمال •',
    en: '📋 *{name}* — Queue\n\nCommands:\n• *STATUS* — Check your position\n• *CANCEL* — Leave the queue\n• *LIST* — Browse businesses',
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
};

// ── Notification messages (used by /api/notification-send) ───────────

export const notificationMessages: Record<string, Record<Locale, string>> = {
  called: {
    fr: '🔔 *C\'est votre tour !* Ticket *{ticket}* — veuillez vous rendre au *{desk}*.\n\nSuivi : {url}',
    ar: '*حان دورك!* التذكرة *{ticket}* — يرجى التوجه إلى *{desk}* 🔔\n\nتتبع: {url}',
    en: '🔔 *It\'s your turn!* Ticket *{ticket}* — please go to *{desk}*.\n\nTrack: {url}',
  },
  recall: {
    fr: '⏰ *Rappel :* Le ticket *{ticket}* vous attend toujours au *{desk}*.\n\nSuivi : {url}',
    ar: '*تذكير:* التذكرة *{ticket}* لا تزال بانتظارك في *{desk}* ⏰\n\nتتبع: {url}',
    en: '⏰ *Reminder:* Ticket *{ticket}* is still waiting for you at *{desk}*.\n\nTrack: {url}',
  },
  buzz: {
    fr: '📢 *Appel :* Le personnel essaie de vous joindre (ticket *{ticket}*). Rendez-vous au *{desk}*.\n\nSuivi : {url}',
    ar: '*تنبيه:* يحاول الموظفون الوصول إليك (التذكرة *{ticket}*). توجه إلى *{desk}* 📢\n\nتتبع: {url}',
    en: '📢 *Buzz:* Staff is trying to reach you (ticket *{ticket}*). Please go to *{desk}*.\n\nTrack: {url}',
  },
  no_show: {
    fr: '❌ Le ticket *{ticket}* chez *{name}* a été marqué *absent*. Vous avez manqué votre tour.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à nouveau.',
    ar: 'التذكرة *{ticket}* في *{name}* تم تسجيلها كـ *غائب*. لقد فاتك دورك ❌\n\nأرسل *انضم <الرمز>* للانضمام مجددًا.',
    en: '❌ Ticket *{ticket}* at *{name}* was marked as *no show*. You missed your turn.\n\nSend *JOIN <code>* to rejoin.',
  },
  served: {
    fr: '✅ Le ticket *{ticket}* chez *{name}* est terminé. Merci pour votre visite.',
    ar: 'التذكرة *{ticket}* في *{name}* مكتملة. شكرًا لزيارتكم. ✅',
    en: '✅ Ticket *{ticket}* at *{name}* is complete. Thank you for your visit.',
  },
  next_in_line: {
    fr: '⏳ *Vous êtes le prochain !* Ticket *{ticket}* — préparez-vous, c\'est bientôt votre tour.\n\nSuivi : {url}',
    ar: '*أنت التالي!* التذكرة *{ticket}* — استعد، دورك قريبًا ⏳\n\nتتبع: {url}',
    en: '⏳ *You\'re next!* Ticket *{ticket}* — get ready, it\'s almost your turn.\n\nTrack: {url}',
  },
  cancelled_notify: {
    fr: '🚫 Le ticket *{ticket}* a été annulé.',
    ar: 'تم إلغاء التذكرة *{ticket}* 🚫',
    en: '🚫 Ticket *{ticket}* has been cancelled.',
  },
  joined: {
    fr: '✅ Vous êtes dans la file chez *{name}* !\n\n🎫 Ticket : *{ticket}*\n{position}\n\n📍 Suivez votre position : {url}',
    ar: 'أنت في الطابور في *{name}*! ✅\n\nالتذكرة: *{ticket}* 🎫\n{position}\n\nتتبع موقعك: {url} 📍',
    en: '✅ You\'re in the queue at *{name}*!\n\n🎫 Ticket: *{ticket}*\n{position}\n\n📍 Track your position: {url}',
  },
  default: {
    fr: '📋 Mise à jour du ticket *{ticket}* : {url}',
    ar: 'تحديث التذكرة *{ticket}*: {url} 📋',
    en: '📋 Update for ticket *{ticket}*: {url}',
  },
};

// ── Locale detection ─────────────────────────────────────────────────

function detectLocale(message: string): Locale {
  const trimmed = message.trim();
  if (/^(REJOINDRE|STATUT|ANNULER|LISTE)\b/i.test(trimmed)) return 'fr';
  if (/^(انضم|حالة|الغاء|قائمة|القائمة|دليل|الفهرس)\b/.test(trimmed)) return 'ar';
  if (/^(JOIN|STATUS|CANCEL|LIST|DIRECTORY)\b/i.test(trimmed)) return 'en';
  if (/[\u0600-\u06FF]/.test(trimmed)) return 'ar';
  return 'fr';
}

/** RTL handling for Arabic text across messaging platforms.
 *  WhatsApp detects Arabic characters and applies RTL natively.
 *  Messenger ignores all Unicode bidi control characters.
 *  We rely on physical text ordering (Arabic text first, numbers last)
 *  which renders correctly on both platforms without any bidi markers. */
function ensureRTL(text: string): string {
  return text;
}

function t(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  let msg = messages[key]?.[locale] ?? messages[key]?.['fr'] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? '?'));
    }
  }
  return locale === 'ar' ? ensureRTL(msg) : msg;
}

export function tNotification(key: string, locale: Locale, vars?: Record<string, string | number | null | undefined>): string {
  let msg = notificationMessages[key]?.[locale] ?? notificationMessages[key]?.['fr'] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v ?? '?'));
    }
  }
  return locale === 'ar' ? ensureRTL(msg) : msg;
}

// ── Shared-number routing ────────────────────────────────────────────

function parseBusinessCode(message: string): { code: string; locale: Locale } | null {
  const trimmed = message.trim();
  const frMatch = trimmed.match(/^REJOINDRE[\s\-]+(.+)$/i);
  if (frMatch) return { code: frMatch[1].trim().toUpperCase(), locale: 'fr' };
  const arMatch = trimmed.match(/^انضم[\s\-]+(.+)$/);
  if (arMatch) return { code: arMatch[1].trim().toUpperCase(), locale: 'ar' };
  const enMatch = trimmed.match(/^JOIN[\s\-]+(.+)$/i);
  if (enMatch) return { code: enMatch[1].trim().toUpperCase(), locale: 'en' };
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
    return orgCode === code;
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
): Promise<Array<{ session: any; org: OrgContext }>> {
  const supabase = createAdminClient() as any;
  const idCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';

  const { data: sessions } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id, organization_id, locale, channel')
    .eq(idCol, identifier)
    .eq('state', 'active')
    .eq('channel', channel)
    .order('created_at', { ascending: false });

  // Also check BSUID for WhatsApp
  let bsuidSessions: any[] = [];
  if (channel === 'whatsapp' && bsuid) {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('id, ticket_id, organization_id, locale, channel')
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

export const positionLabel: Record<Locale, string> = { fr: 'Position', ar: 'الترتيب', en: 'Position' };
export const nowServingLabel: Record<Locale, string> = { fr: 'En service', ar: 'يُخدم الآن', en: 'Now serving' };
export const minLabel: Record<Locale, string> = { fr: 'min', ar: 'دقيقة', en: 'min' };

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
): Promise<void> {
  // Strip invisible Unicode characters (ZWJ, ZWNJ, LTR/RTL marks, BOM, Arabic marks, diacritics, etc.)
  // Then normalize Arabic Alef variants (أ إ آ ٱ → ا) and Taa Marbuta/Haa (ه ← ة kept distinct)
  const cleaned = messageBody.trim()
    .replace(/[\u00AD\u061C\u064B-\u0652\u0670\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .trim();
  const command = cleaned.toUpperCase();
  const detectedLocale = detectLocale(cleaned);

  // ── Pending join confirmation (YES/OUI/نعم or NO/NON/لا) ──
  // Check DB for a pending_confirmation session for this user
  {
    const supabaseCheck = createAdminClient() as any;
    const identCol = channel === 'messenger' ? 'messenger_psid' : 'whatsapp_phone';
    const { data: pendingSession } = await supabaseCheck
      .from('whatsapp_sessions')
      .select('id, organization_id, locale, channel, office_id, department_id, service_id, virtual_queue_code_id, whatsapp_phone, whatsapp_bsuid, messenger_psid, created_at')
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
      const pendingLocale = (pendingSession.locale as Locale) || 'fr';

      if (isYes) {
        // Look up org name for the joined message
        const { data: orgRow } = await supabaseCheck
          .from('organizations').select('id, name, settings').eq('id', pendingSession.organization_id).single();
        if (orgRow) {
          await handleJoin(identifier, orgRow as OrgContext, pendingLocale, channel, sendMessage, profileName, bsuid);
          // Clean up the pending session (handleJoin creates a new active one)
          await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
        }
        return;
      }
      if (isNo) {
        await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
        await sendMessage({ to: identifier, body: t('confirm_join_cancelled', pendingLocale) });
        return;
      }
      // Something else — clear pending and fall through to normal processing
      await supabaseCheck.from('whatsapp_sessions').delete().eq('id', pendingSession.id);
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
    const allSessions = await findAllActiveSessionsByUser(identifier, channel, bsuid);
    if (allSessions.length === 0) {
      await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
    } else if (allSessions.length === 1) {
      const { session, org } = allSessions[0];
      const sessionLocale = (session.locale as Locale) || detectedLocale;
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

    const allSessions = await findAllActiveSessionsByUser(identifier, channel, bsuid);
    if (allSessions.length === 0) {
      await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
    } else if (isAll) {
      // Cancel all active sessions
      await handleCancelAll(identifier, allSessions, detectedLocale, channel, sendMessage);
    } else if (cancelIdx !== null) {
      // Cancel specific session by index
      if (cancelIdx >= 1 && cancelIdx <= allSessions.length) {
        const { session, org } = allSessions[cancelIdx - 1];
        const sessionLocale = (session.locale as Locale) || detectedLocale;
        await handleCancel(identifier, org, sessionLocale, channel, sendMessage, session);
      } else {
        await sendMessage({ to: identifier, body: t('not_in_queue', detectedLocale) });
      }
    } else if (allSessions.length === 1) {
      const { session, org } = allSessions[0];
      const sessionLocale = (session.locale as Locale) || detectedLocale;
      await handleCancel(identifier, org, sessionLocale, channel, sendMessage, session);
    } else {
      // Multiple sessions — ask which one to cancel
      await handleCancelPick(identifier, allSessions, detectedLocale, channel, sendMessage);
    }
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

    const org = await findOrgByCode(parsed.code, channel);
    if (org) {
      await askJoinConfirmation(identifier, org, parsed.locale, channel, sendMessage, profileName, bsuid);
    } else {
      await sendMessage({ to: identifier, body: t('code_not_found', parsed.locale, { code: parsed.code }) });
    }
    return;
  }

  // ── Plain "JOIN" / "REJOINDRE" / "انضم" without code ──
  if (command === 'JOIN' || command === 'REJOINDRE' || /^انضم$/.test(cleaned)) {
    const found = await findOrgByActiveSession(identifier, channel, bsuid);
    if (found) {
      const sessionLocale = (found.session.locale as Locale) || detectedLocale;
      const pos = await getQueuePosition(found.session.ticket_id);
      await sendMessage({
        to: identifier,
        body: t('already_in_queue', sessionLocale, {
          name: found.org.name,
          position: formatPosition(pos, sessionLocale),
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

  // ── Unknown message ──
  const found = await findOrgByActiveSession(identifier, channel, bsuid);
  if (found) {
    const sessionLocale = (found.session.locale as Locale) || detectedLocale;
    await sendMessage({
      to: identifier,
      body: t('help_with_session', sessionLocale, { name: found.org.name }),
    });
  } else {
    await sendMessage({ to: identifier, body: t('welcome', detectedLocale) });
  }
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
      if (!s.listed_in_directory) return false;
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
      body += `${catLabel} ${emoji} — *${i + 1}*\n`;
    } else {
      body += `*${i + 1}.* ${emoji} ${catLabel} (${count})\n`;
    }
  }

  body += t('directory_footer', locale);

  await sendMessage({ to: identifier, body: locale === 'ar' ? ensureRTL(body) : body });
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
        body += `${biz.name} — *${catNum}-${i + 1}*\n`;
      } else {
        body += `*${catNum}-${i + 1}.* ${biz.name}\n`;
      }
    }

    body += t('category_footer', locale, { example: `${catNum}-1` });

    await sendMessage({ to: identifier, body: locale === 'ar' ? ensureRTL(body) : body });
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
  const baseUrl = (process.env.APP_CLIP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://qflo.net').replace(/\/+$/, '');
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

  // Clean up any stale pending confirmations for this user
  await supabase.from('whatsapp_sessions').delete()
    .eq(identCol, identifier).eq('state', 'pending_confirmation').eq('channel', channel);

  // Insert pending confirmation row
  const sessionData: Record<string, any> = {
    organization_id: org.id,
    state: 'pending_confirmation',
    locale,
    channel,
  };
  if (channel === 'messenger') {
    sessionData.messenger_psid = identifier;
  } else {
    sessionData.whatsapp_phone = identifier;
    if (bsuid) sessionData.whatsapp_bsuid = bsuid;
  }

  const { error: insertErr } = await supabase.from('whatsapp_sessions').insert(sessionData);
  if (insertErr) {
    console.error('[askJoinConfirmation] Insert failed:', insertErr.message);
    // Fall back to direct join (skip confirmation) so the user isn't stuck
    await handleJoin(identifier, org, locale, channel, sendMessage, profileName, bsuid);
    return;
  }
  await sendMessage({ to: identifier, body: t('confirm_join', locale, { name: org.name }) });
}

async function handleJoin(
  identifier: string,
  org: OrgContext,
  locale: Locale,
  channel: Channel,
  sendMessage: SendFn,
  profileName?: string,
  bsuid?: string,
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
    await sendMessage({
      to: identifier,
      body: t('already_in_queue', locale, {
        name: org.name,
        position: formatPosition(pos, locale),
      }),
    });
    return;
  }

  // Use channel-specific or shared virtual code
  const virtualCodeKey = channel === 'messenger'
    ? 'messenger_default_virtual_code_id'
    : 'whatsapp_default_virtual_code_id';
  const virtualCodeId = org.settings?.[virtualCodeKey] ?? org.settings?.whatsapp_default_virtual_code_id;

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

  const officeId = vCode.office_id;
  const departmentId = vCode.department_id;
  const serviceId = vCode.service_id;

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

  // Build customer data
  const customerData: Record<string, any> = { source: channel };
  if (channel === 'whatsapp') {
    customerData.phone = identifier;
  } else {
    customerData.messenger_psid = identifier;
  }
  if (profileName) {
    customerData.name = profileName;
  }

  const result = await createPublicTicket({
    officeId,
    departmentId,
    serviceId,
    customerData,
    isRemote: true,
    source: channel,
  });

  if ('error' in result && result.error) {
    await sendMessage({ to: identifier, body: t('join_error', locale, { error: result.error }) });
    return;
  }

  const ticket = result.data;
  if (!ticket) {
    await sendMessage({ to: identifier, body: t('join_failed', locale) });
    return;
  }

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

  const pos = await getQueuePosition(ticket.id);

  const baseUrl = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflo.net'
  ).replace(/\/+$/, '');
  const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

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
    await sendMessage({ to: identifier, body: t('not_in_queue_rejoin', locale) });
    return;
  }

  // Fetch ticket number
  const { data: ticketRow } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('id', session.ticket_id)
    .single();
  const ticketNum = ticketRow?.ticket_number ?? '?';

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

    await sendMessage({ to: identifier, body: t('ticket_inactive', locale) });
    return;
  }

  await sendMessage({
    to: identifier,
    body: t('status', locale, {
      name: org.name,
      ticket: ticketNum,
      position: pos.position,
      wait: pos.estimated_wait_minutes ?? '?',
      now_serving: formatNowServing(pos, locale),
      total: pos.total_waiting,
    }),
  });
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

  // Use the session already found by findOrgByActiveSession to avoid
  // maybeSingle() failing when multiple active sessions exist
  let session = activeSession;
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
    await sendMessage({ to: identifier, body: t('not_in_queue_rejoin', locale) });
    return;
  }

  // Fetch ticket number for the cancel message
  const { data: ticketRow } = await supabase
    .from('tickets')
    .select('ticket_number')
    .eq('id', session.ticket_id)
    .single();

  // Mark session completed BEFORE cancelling the ticket so the DB trigger
  // sees has_session = false and doesn't send a duplicate notification.
  await supabase
    .from('whatsapp_sessions')
    .update({ state: 'completed' })
    .eq('id', session.id);

  const { error: cancelError } = await supabase
    .from('tickets')
    .update({ status: 'cancelled' })
    .eq('id', session.ticket_id)
    .in('status', ['waiting', 'issued', 'called']);

  if (cancelError) {
    console.error(`[${channel}:cancel] Failed to cancel ticket:`, cancelError);
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
  let body = t('multi_status_header', locale);

  const supabase = createAdminClient() as any;
  for (let i = 0; i < allSessions.length; i++) {
    const { session, org } = allSessions[i];
    const { data: ticketRow } = await supabase
      .from('tickets')
      .select('ticket_number')
      .eq('id', session.ticket_id)
      .single();
    const ticketNum = ticketRow?.ticket_number ?? '?';
    const pos = await getQueuePosition(session.ticket_id);
    const posText = pos.position != null
      ? `#${pos.position} (~${pos.estimated_wait_minutes ?? '?'} min)`
      : '—';

    if (locale === 'ar') {
      body += `*${org.name}* — 🎫 *${ticketNum}* — ${posText} — *${i + 1}*\n`;
    } else {
      body += `*${i + 1}.* ${org.name} — 🎫 *${ticketNum}* — ${posText}\n`;
    }
  }

  body += t('multi_status_footer', locale, { n: '1' });
  await sendMessage({ to: identifier, body: locale === 'ar' ? ensureRTL(body) : body });
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
      list += `*${org.name}* — *${i + 1}*\n`;
    } else {
      list += `*${i + 1}.* ${org.name}\n`;
    }
  }

  const msg = t('cancel_pick', locale, {
    count: String(allSessions.length),
    list,
    n: '1',
  });
  await sendMessage({ to: identifier, body: locale === 'ar' ? ensureRTL(msg) : msg });
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
      .in('status', ['waiting', 'issued', 'called']);

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
  await sendMessage({ to: identifier, body: locale === 'ar' ? ensureRTL(msg) : msg });
}

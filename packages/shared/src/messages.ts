/**
 * Unified customer-facing notification message templates.
 *
 * Single source of truth — replaces duplicated templates that were in:
 *   - apps/web/src/lib/messaging-commands.ts (notificationMessages)
 *   - supabase/functions/notify-ticket/index.ts (messages)
 *
 * Uses the edge function's version (richer — includes {name}, {wait}, and
 * extra templates like "serving" and "approaching") as the canonical set.
 * Missing templates from the web version (position_update, default) are added.
 */

export type Locale = 'fr' | 'ar' | 'en';

/**
 * All notification message templates, keyed by event name.
 * Variables use {placeholder} syntax — replaced at send time.
 *
 * Common variables:
 *   {name}     — business/organization name
 *   {ticket}   — ticket number (e.g. "HAD-0125")
 *   {desk}     — desk name (e.g. "Guichet 3")
 *   {url}      — tracking URL
 *   {wait}     — estimated wait in minutes
 *   {position} — queue position number
 *   {code}     — business code for rejoining
 */
export const notificationMessages: Record<string, Record<Locale, string>> = {
  called: {
    fr: "🔔 C'est votre tour chez *{name}* ! Ticket *{ticket}* — veuillez vous rendre au *{desk}* dans les *{wait} minutes*.\n\nSuivi : {url}",
    ar: "حان دورك في *{name}*! التذكرة *{ticket}* — يرجى التوجه إلى *{desk}* خلال *{wait} دقائق* 🔔\n\nتتبع: {url}",
    en: "🔔 It's your turn at *{name}*! Ticket *{ticket}* — please go to *{desk}* within *{wait} minutes*.\n\nTrack: {url}",
  },
  recall: {
    fr: "⏰ *Rappel — {name} :* Le ticket *{ticket}* vous attend toujours au *{desk}*. Vous avez *{wait} minutes* pour vous présenter.\n\nSuivi : {url}",
    ar: "*تذكير — {name}:* التذكرة *{ticket}* لا تزال بانتظارك في *{desk}*. لديك *{wait} دقائق* للحضور ⏰\n\nتتبع: {url}",
    en: "⏰ *Reminder — {name}:* Ticket *{ticket}* is still waiting for you at *{desk}*. You have *{wait} minutes* to arrive.\n\nTrack: {url}",
  },
  buzz: {
    fr: "📢 *Appel — {name} :* Le personnel essaie de vous joindre (ticket *{ticket}*). Rendez-vous au *{desk}*.\n\nSuivi : {url}",
    ar: "*تنبيه — {name}:* يحاول الموظفون الوصول إليك (التذكرة *{ticket}*). توجه إلى *{desk}* 📢\n\nتتبع: {url}",
    en: "📢 *Buzz — {name}:* Staff is trying to reach you (ticket *{ticket}*). Please go to *{desk}*.\n\nTrack: {url}",
  },
  serving: {
    fr: "▶️ Votre service a commencé chez *{name}* ! Ticket *{ticket}* — vous êtes maintenant pris en charge au *{desk}*.",
    ar: "بدأت خدمتك في *{name}*! التذكرة *{ticket}* — أنت الآن قيد الخدمة في *{desk}* ▶️",
    en: "▶️ Your service has started at *{name}*! Ticket *{ticket}* — you're now being served at *{desk}*.",
  },
  no_show: {
    fr: "❌ Le ticket *{ticket}* chez *{name}* a été marqué *absent* le *{date}* à *{time}*. Vous avez manqué votre tour.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à nouveau.",
    ar: "التذكرة *{ticket}* في *{name}* تم تسجيلها كـ *غائب* بتاريخ *{date}* الساعة *{time}*. لقد فاتك دورك ❌\n\nأرسل *انضم <الرمز>* للانضمام مجددًا.",
    en: "❌ Ticket *{ticket}* at *{name}* was marked as *no show* on *{date}* at *{time}*. You missed your turn.\n\nSend *JOIN <code>* to rejoin.",
  },
  served: {
    fr: "✅ Le ticket *{ticket}* chez *{name}* est terminé le *{date}* à *{time}*. Merci pour votre visite !",
    ar: "التذكرة *{ticket}* في *{name}* مكتملة بتاريخ *{date}* الساعة *{time}*. شكرًا لزيارتكم! ✅",
    en: "✅ Ticket *{ticket}* at *{name}* is complete (*{date}* at *{time}*). Thank you for your visit!",
  },
  next_in_line: {
    fr: "⏳ *Vous êtes le prochain chez {name} !* Ticket *{ticket}* — préparez-vous, c'est bientôt votre tour.\n\nSuivi : {url}",
    ar: "*أنت التالي في {name}!* التذكرة *{ticket}* — استعد، دورك قريبًا ⏳\n\nتتبع: {url}",
    en: "⏳ *You're next at {name}!* Ticket *{ticket}* — get ready, it's almost your turn.\n\nTrack: {url}",
  },
  approaching: {
    fr: "📍 *Bientôt votre tour chez {name} !* Vous êtes *#{position}* dans la file (ticket *{ticket}*). Commencez à vous rapprocher.\n\nSuivi : {url}",
    ar: "*اقترب دورك في {name}!* أنت *#{position}* في الطابور (التذكرة *{ticket}*). ابدأ بالتوجه 📍\n\nتتبع: {url}",
    en: "📍 *Almost your turn at {name}!* You're *#{position}* in line (ticket *{ticket}*). Start heading over.\n\nTrack: {url}",
  },
  joined: {
    fr: "✅ Vous êtes dans la file chez *{name}* !\n\n🎫 Ticket : *{ticket}*\n📍 Position : *#{position}*\n⏱️ Attente estimée : *~{wait} min*\n\n📍 Suivez votre position : {url}",
    ar: "أنت في الطابور في *{name}*! ✅\n\n🎫 التذكرة: *{ticket}*\n📍 الموقع: *#{position}*\n⏱️ الانتظار المتوقع: *~{wait} د*\n\n📍 تتبع موقعك: {url}",
    en: "✅ You're in the queue at *{name}*!\n\n🎫 Ticket: *{ticket}*\n📍 Position: *#{position}*\n⏱️ Est. wait: *~{wait} min*\n\n📍 Track your position: {url}",
  },
  cancelled_notify: {
    fr: "🚫 Le ticket *{ticket}* chez *{name}* a été annulé.\n\n📅 Date : *{date}*\n🕐 Heure : *{time}*",
    ar: "تم إلغاء التذكرة *{ticket}* في *{name}* 🚫\n\n📅 التاريخ: *{date}*\n🕐 الوقت: *{time}*",
    en: "🚫 Ticket *{ticket}* at *{name}* has been cancelled.\n\n📅 Date: *{date}*\n🕐 Time: *{time}*",
  },
  position_update: {
    fr: "📍 *{name}* — Mise à jour\n\nVous êtes maintenant *#{position}* dans la file.\n⏱ Attente estimée : ~*{wait} min*\n\nSuivi : {url}",
    ar: "📍 *{name}* — تحديث\n\nأنت الآن *#{position}* في الطابور.\n⏱ الانتظار المتوقع: ~*{wait} دقيقة*\n\nتتبع: {url}",
    en: "📍 *{name}* — Update\n\nYou're now *#{position}* in line.\n⏱ Est. wait: ~*{wait} min*\n\nTrack: {url}",
  },
  default: {
    fr: '📋 Mise à jour du ticket *{ticket}* : {url}',
    ar: 'تحديث التذكرة *{ticket}*: {url} 📋',
    en: '📋 Update for ticket *{ticket}*: {url}',
  },
};

/**
 * Render a notification message template with variable substitution.
 *
 * @param key    Template key (e.g. "called", "served")
 * @param locale Target locale
 * @param vars   Variable values to substitute
 * @returns Rendered message string (falls back to French, then raw key)
 */
export function renderNotification(
  key: string,
  locale: Locale,
  vars?: Record<string, string | number | null | undefined>,
): string {
  let msg = notificationMessages[key]?.[locale]
    ?? notificationMessages[key]?.['fr']
    ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // Normalize: treat null, undefined, and empty string the same —
      // they all leave broken `**` markers in WhatsApp bold syntax and
      // look unprofessional. Substitute empty; the post-process step
      // below cleans up any bold pairs / orphan brackets we leave behind.
      const safe = v === null || v === undefined || v === '' ? '' : String(v);
      msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), safe);
    }
  }
  return sanitizeMessage(msg);
}

/**
 * Post-process a notification message to remove artefacts from missing
 * variable substitutions:
 *   - empty bold pairs `**` or `* *` (WhatsApp would render as literal stars)
 *   - empty parentheses `()` left from constructs like `(*{date}*)`
 *   - doubled spaces, trailing spaces before punctuation
 *   - stray leading separators ("at .", ", .", etc.)
 *
 * This is the last line of defence — callers should still pass real values,
 * but a missed value should never produce broken output for the customer.
 */
export function sanitizeMessage(msg: string): string {
  let out = msg
    // 1. Remove empty bold pairs: "**" or "* *" (from missing *{var}*)
    .replace(/\*\s*\*/g, '')
    // 2. Remove empty markdown italic pairs
    .replace(/\b_\s*_\b/g, '');

  // 3. Drop leading stop-words that lose their object when the var is empty:
  //    "at  ." → "."   "at  )" → ")"   "chez  ," → ","   "في  )" → ")"
  //    Covers EN "at/by", FR "chez/par", AR "في/من". Case-insensitive.
  //    Run BEFORE empty-parens so we can clean the inside first.
  out = out.replace(/\b(at|chez|by|par)\s+(?=[.,!?;:\n\)])/gi, '');
  out = out.replace(/(في|من)\s+(?=[.,!?;:\n\)])/g, '');

  // 4. Remove empty parens/brackets that result from `(*{var}*)` or `[{var}]`
  //    After step 1+3, these may have only whitespace inside. Loop because
  //    stripping "(  )" → "" may expose another empty wrapper above.
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '');
    if (out === before) break;
  }

  // 5. Collapse multiple spaces within a line (preserve newlines)
  out = out.replace(/[ \t]{2,}/g, ' ');
  // 6. Remove space before punctuation
  out = out.replace(/[ \t]+([.,!?;:])/g, '$1');
  // 7. Trim each line
  out = out.split('\n').map((l) => l.trim()).join('\n');

  return out.trim();
}

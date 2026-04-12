import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Meta Cloud API
const WA_ACCESS_TOKEN = Deno.env.get("WHATSAPP_META_ACCESS_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_META_PHONE_NUMBER_ID") ?? "";

// Messenger
const MESSENGER_PAGE_ACCESS_TOKEN = Deno.env.get("MESSENGER_PAGE_ACCESS_TOKEN") ?? "";

// Push notification endpoint (still on Vercel — lightweight)
const PUSH_SEND_URL = Deno.env.get("PUSH_SEND_URL") ?? "https://qflo.net/api/push-send";

// App base URL for tracking links
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "https://qflo.net").replace(/\/+$/, "");

// ── Types ────────────────────────────────────────────────────────────

type Locale = "fr" | "ar" | "en";
type Event = "called" | "recall" | "buzz" | "serving" | "no_show" | "served" | "cancelled" | "next_in_line" | "approaching" | "joined";

interface Session {
  id: string;
  organization_id: string;
  whatsapp_phone: string | null;
  whatsapp_bsuid: string | null;
  messenger_psid: string | null;
  channel: "whatsapp" | "messenger";
  locale: Locale;
  otn_token: string | null;
}

// ── i18n ─────────────────────────────────────────────────────────────

const messages: Record<string, Record<Locale, string>> = {
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
    fr: "❌ Le ticket *{ticket}* chez *{name}* a été marqué *absent*. Vous avez manqué votre tour.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à nouveau.",
    ar: "التذكرة *{ticket}* في *{name}* تم تسجيلها كـ *غائب*. لقد فاتك دورك ❌\n\nأرسل *انضم <الرمز>* للانضمام مجددًا.",
    en: "❌ Ticket *{ticket}* at *{name}* was marked as *no show*. You missed your turn.\n\nSend *JOIN <code>* to rejoin.",
  },
  served: {
    fr: "✅ Le ticket *{ticket}* chez *{name}* est terminé. Merci pour votre visite.",
    ar: "التذكرة *{ticket}* في *{name}* مكتملة. شكرًا لزيارتكم. ✅",
    en: "✅ Ticket *{ticket}* at *{name}* is complete. Thank you for your visit.",
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
    fr: "🚫 Le ticket *{ticket}* chez *{name}* a été annulé.",
    ar: "تم إلغاء التذكرة *{ticket}* في *{name}* 🚫",
    en: "🚫 Ticket *{ticket}* at *{name}* has been cancelled.",
  },
};

function t(key: string, locale: Locale, vars: Record<string, string>): string {
  let msg = messages[key]?.[locale] ?? messages[key]?.["fr"] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replaceAll(`{${k}}`, v);
  }
  return msg;
}

// ── WhatsApp send (Meta Cloud API — direct, no Vercel hop) ──────────

// Template name for outbound notifications (must be approved in Meta Business Manager)
const WA_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "qflo_queue_update";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";

async function sendWhatsAppRaw(phone: string, payload: Record<string, unknown>): Promise<{ ok: boolean; errorCode?: number }> {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) return { ok: false };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v22.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messaging_product: "whatsapp", to: phone, ...payload }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data?.error?.code ?? 0;
      console.error("[notify-ticket:whatsapp] Failed:", data?.error?.message ?? res.status, `(code=${code})`);
      return { ok: false, errorCode: code };
    }
    console.log("[notify-ticket:whatsapp] Sent to ***" + phone.slice(-4));
    return { ok: true };
  } catch (err) {
    console.error("[notify-ticket:whatsapp] Error:", err);
    return { ok: false };
  }
}

// Timezone → country calling code (same mapping as desktop/web)
const TZ_DIAL: Record<string, string> = {
  "Africa/Algiers": "213", "Africa/Tunis": "216", "Africa/Casablanca": "212",
  "Africa/Cairo": "20", "Africa/Lagos": "234", "Africa/Nairobi": "254",
  "Africa/Johannesburg": "27", "Europe/Paris": "33", "Europe/London": "44",
  "Europe/Berlin": "49", "Europe/Madrid": "34", "Europe/Rome": "39",
  "Europe/Brussels": "32", "Europe/Amsterdam": "31", "Europe/Zurich": "41",
  "Europe/Istanbul": "90", "Asia/Riyadh": "966", "Asia/Dubai": "971",
  "Asia/Qatar": "974", "Asia/Kuwait": "965", "Asia/Bahrain": "973",
  "Asia/Muscat": "968", "Asia/Amman": "962", "Asia/Beirut": "961",
  "Asia/Baghdad": "964", "America/New_York": "1", "America/Chicago": "1",
  "America/Denver": "1", "America/Los_Angeles": "1", "America/Toronto": "1",
  "America/Sao_Paulo": "55", "America/Mexico_City": "52",
  "Asia/Kolkata": "91", "Asia/Shanghai": "86", "Asia/Tokyo": "81",
  "Australia/Sydney": "61",
};

/**
 * Normalize phone to international digits (no + prefix).
 * Handles 10-digit US/CA numbers, 9-digit Algerian/French numbers,
 * and local format with leading 0.
 */
function normalizePhoneForMeta(phone: string, countryDialCode?: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  // Local format: leading 0 → strip and prepend country code
  if (digits.startsWith("0") && countryDialCode) {
    return countryDialCode + digits.slice(1);
  }
  // US/Canada: 10-digit number → prepend 1
  if (digits.length === 10 && !digits.startsWith("0")) {
    return "1" + digits;
  }
  // Algeria: 9-digit subscriber number
  if (digits.length === 9 && (countryDialCode === "213" || (!countryDialCode && /^[567]/.test(digits)))) {
    return "213" + digits;
  }
  // France: 9-digit subscriber number
  if (digits.length === 9 && countryDialCode === "33") {
    return "33" + digits;
  }
  return digits;
}

async function sendWhatsApp(phone: string, body: string): Promise<boolean> {
  const digits = normalizePhoneForMeta(phone);
  if (digits.length < 7) return false;

  // Try free-form text first (works if customer messaged us within 24h)
  const textResult = await sendWhatsAppRaw(digits, { type: "text", text: { body } });
  if (textResult.ok) return true;

  // If outside 24h window (error 131047) or recipient not in allowed list (131030/130429),
  // retry with an approved template message
  if (textResult.errorCode === 131047 || textResult.errorCode === 131030 || textResult.errorCode === 130429) {
    console.log("[notify-ticket:whatsapp] Outside 24h window, retrying with template...");

    // 1) Try custom template (queue_notification) with the message body as parameter
    const templateResult = await sendWhatsAppRaw(digits, {
      type: "template",
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: body }],
          },
        ],
      },
    });
    return templateResult.ok;
  }

  return false;
}

// ── Messenger send (direct — no Vercel hop) ─────────────────────────

async function sendMessenger(recipientId: string, text: string, tag?: string): Promise<boolean> {
  if (!MESSENGER_PAGE_ACCESS_TOKEN) return false;

  try {
    const payload: Record<string, unknown> = {
      recipient: { id: recipientId },
      message: { text },
    };

    if (tag) {
      payload.messaging_type = "MESSAGE_TAG";
      payload.tag = tag;
    } else {
      payload.messaging_type = "RESPONSE";
    }

    const res = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MESSENGER_PAGE_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      // If standard send fails (outside 24h), retry with CONFIRMED_EVENT_UPDATE tag
      if (!tag) {
        console.log("[notify-ticket:messenger] Retrying with tag...");
        return sendMessenger(recipientId, text, "CONFIRMED_EVENT_UPDATE");
      }
      console.error("[notify-ticket:messenger] Failed:", data?.error?.message ?? res.status);
      return false;
    }
    console.log("[notify-ticket:messenger] Sent to ***" + recipientId.slice(-4));
    return true;
  } catch (err) {
    console.error("[notify-ticket:messenger] Error:", err);
    return false;
  }
}

// ── Push notification (still forwarded to Vercel — lightweight) ─────

async function sendPush(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(PUSH_SEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error("[notify-ticket:push] Error:", err);
  }
}

// ── Main handler ─────────────────────────────────────────────────────

const VERSION = "19";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  try {
    // No auth check — this function is deployed with verify_jwt=false and is
    // only called by Postgres triggers (net.http_post) and internal systems.
    // The Supabase gateway handles network-level access control.

    const body = await req.json();
    const { ticketId, event, deskName, waitMinutes, position, pushPayload } = body as {
      ticketId: string;
      event: Event;
      deskName: string;
      waitMinutes?: number;
      position?: number;
      pushPayload?: Record<string, unknown>;
    };

    // Validate event type at runtime
    const validEvents: Event[] = ["called", "recall", "buzz", "serving", "no_show", "served", "cancelled", "next_in_line", "approaching", "joined"];
    if (!validEvents.includes(event)) {
      return new Response(JSON.stringify({ error: `Invalid event: ${event}` }), { status: 400 });
    }

    console.log(`[notify-ticket v${VERSION}] event=${event} ticketId=${ticketId}`);

    if (!ticketId || !event) {
      return new Response(JSON.stringify({ error: "Missing ticketId or event" }), { status: 400 });
    }

    // ── "joined" event — direct send, no session/ticket lookup needed ──
    if (event === "joined") {
      const { phone, ticketNumber, officeName, position: pos, trackUrl, waitMinutes: wait, countryDialCode, locale: reqLocale } = body as {
        phone?: string; ticketNumber?: string; officeName?: string;
        position?: number; trackUrl?: string; waitMinutes?: number;
        countryDialCode?: string; locale?: string;
      };
      if (!phone) {
        return Response.json({ sent: false, reason: "no phone for joined event" });
      }
      const normalizedPhone = normalizePhoneForMeta(phone, countryDialCode);
      if (normalizedPhone.length < 7) {
        return Response.json({ sent: false, error: "Invalid phone number" });
      }
      // Prefer the locale persisted on the ticket row over whatever the
      // caller passed (Station/kiosk pass their UI locale, which is wrong
      // for customers who booked in a different language).
      let joinedLocale: Locale = (reqLocale as Locale) || "fr";
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: tRow } = await sb.from("tickets").select("locale").eq("id", ticketId).single();
        const tl = (tRow as any)?.locale;
        if (tl === "ar" || tl === "en" || tl === "fr") joinedLocale = tl;
      } catch { /* ignore */ }
      const locale: Locale = joinedLocale;
      const message = t("joined", locale, {
        ticket: ticketNumber ?? "—",
        name: officeName ?? "",
        position: String(pos ?? 1),
        wait: String(wait ?? 10),
        url: trackUrl ?? "",
        desk: "",
      });
      const sent = await sendWhatsApp(normalizedPhone, message);
      console.log(`[notify-ticket v${VERSION}] joined direct send: phone=***${normalizedPhone.slice(-4)} sent=${sent}`);
      if (sent) {
        return Response.json({ sent: true, version: VERSION });
      }
      return Response.json({ sent: false, error: "WhatsApp send failed (outside 24h window or invalid number)", version: VERSION });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fire push notification in parallel (non-blocking)
    const pushPromise = pushPayload ? sendPush(pushPayload) : Promise.resolve();

    // Look up ticket + office timezone for phone normalization
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, ticket_number, qr_token, status, locale, office_id")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return Response.json({ sent: false, reason: "ticket not found" });
    }

    // Look up session (WhatsApp or Messenger) — include organization_id.
    // For terminal events (cancelled/served/no_show) we accept any session
    // state, since the customer must always be notified of the final outcome
    // even if their session was previously closed.
    const isTerminalEvent = event === "cancelled" || event === "served" || event === "no_show";
    let sessionQuery = supabase
      .from("whatsapp_sessions")
      .select("id, organization_id, whatsapp_phone, whatsapp_bsuid, messenger_psid, channel, locale, otn_token")
      .eq("ticket_id", ticketId);
    if (!isTerminalEvent) {
      sessionQuery = sessionQuery.eq("state", "active");
    }
    const { data: session } = await sessionQuery
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() as { data: Session | null };

    if (!session) {
      await pushPromise;
      console.log(`[notify-ticket v${VERSION}] No active session for ticket ${ticketId}`);
      return Response.json({ sent: false, reason: "no active session", version: VERSION });
    }

    const redactedId = session.channel === "messenger" && session.messenger_psid
      ? "psid:***" + session.messenger_psid.slice(-4)
      : session.whatsapp_phone
        ? "phone:***" + session.whatsapp_phone.slice(-4)
        : "bsuid:***" + (session.whatsapp_bsuid ?? "").slice(-4);
    console.log(`[notify-ticket v${VERSION}] Session found: channel=${session.channel} orgId=${session.organization_id} ${redactedId}`);

    // Prefer ticket-level locale (set at booking time) over session locale.
    const tl = (ticket as any)?.locale;
    const locale: Locale = (tl === "ar" || tl === "en" || tl === "fr")
      ? tl
      : ((session.locale as Locale) || "fr");
    const trackUrl = `${APP_BASE_URL}/q/${ticket.qr_token}`;

    // Fetch business name from organization
    let orgName = "";
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", session.organization_id)
      .single();
    orgName = org?.name ?? "";

    const msgKey = event === "cancelled" ? "cancelled_notify" : event;
    const message = t(msgKey, locale, {
      ticket: ticket.ticket_number,
      desk: deskName || "your desk",
      url: trackUrl,
      wait: String(waitMinutes ?? 10),
      position: String(position ?? 3),
      name: orgName,
    });

    // ── Duplicate notification prevention ──────────────────────────────
    const notifType = `${session.channel}_${event}`;
    const { data: recentNotif } = await supabase
      .from("notifications")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("type", notifType)
      .gte("sent_at", new Date(Date.now() - 60_000).toISOString()) // within last 60s
      .limit(1)
      .maybeSingle();

    if (recentNotif) {
      await pushPromise;
      console.log(`[notify-ticket v${VERSION}] Duplicate suppressed: ${notifType} for ticket ${ticketId}`);
      return Response.json({ sent: false, reason: "duplicate suppressed", version: VERSION });
    }

    // Look up org timezone to derive country dial code for phone normalization
    let countryDialCode: string | undefined;
    if ((ticket as any)?.office_id) {
      const { data: office } = await supabase
        .from("offices")
        .select("organization:organizations(timezone)")
        .eq("id", (ticket as any).office_id)
        .single();
      // Use org-level timezone as single source of truth
      const tz = (office as any)?.organization?.timezone;
      if (tz && TZ_DIAL[tz]) countryDialCode = TZ_DIAL[tz];
    }

    const isTerminal = ["no_show", "served", "cancelled"].includes(event);
    let sent = false;

    if (session.channel === "messenger" && session.messenger_psid) {
      sent = await sendMessenger(session.messenger_psid, message);
    } else if (session.whatsapp_phone) {
      const normalizedPhone = normalizePhoneForMeta(session.whatsapp_phone, countryDialCode);
      console.log(`[notify-ticket v${VERSION}] Normalized phone: ***${normalizedPhone.slice(-4)} (raw: ***${session.whatsapp_phone.slice(-4)}, dial: ${countryDialCode ?? 'none'})`);
      sent = await sendWhatsApp(normalizedPhone, message);
    } else if (session.whatsapp_bsuid) {
      // Username adopter without phone — BSUID sending available May 2026
      console.warn(`[notify-ticket v${VERSION}] No phone for session, bsuid=***${(session.whatsapp_bsuid ?? "").slice(-4)} — cannot send yet`);
    }

    if (sent) {
      // Log notification
      await supabase.from("notifications").insert({
        ticket_id: ticketId,
        type: notifType,
        channel: session.channel,
        payload: { locale, channel: session.channel },
        sent_at: new Date().toISOString(),
      }).then(() => {}, () => {}); // ignore errors

      // Complete session for terminal events
      if (isTerminal) {
        await supabase
          .from("whatsapp_sessions")
          .update({ state: "completed" })
          .eq("id", session.id);
      }
    }

    await pushPromise;

    console.log(`[notify-ticket v${VERSION}] ${event} via ${session.channel}: sent=${sent} ticket=${ticket.ticket_number}`);
    return Response.json({ sent, channel: session.channel, version: VERSION });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-ticket] Error:", message);
    return Response.json({ sent: false, error: message }, { status: 500 });
  }
});

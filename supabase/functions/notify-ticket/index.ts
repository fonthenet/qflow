import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Meta Cloud API — only used for "joined" event now
const WA_ACCESS_TOKEN = Deno.env.get("WHATSAPP_META_ACCESS_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_META_PHONE_NUMBER_ID") ?? "";

// Push notification endpoint (still on Vercel — lightweight)
const PUSH_SEND_URL = Deno.env.get("PUSH_SEND_URL") ?? "https://qflo.net/api/push-send";

// App base URL for tracking links
const APP_BASE_URL = (Deno.env.get("APP_BASE_URL") ?? "https://qflo.net").replace(/\/+$/, "");

// ── Types ────────────────────────────────────────────────────────────

type Locale = "fr" | "ar" | "en";
type Event = "called" | "recall" | "buzz" | "serving" | "no_show" | "served" | "cancelled" | "next_in_line" | "approaching" | "joined";

// ── i18n — only "joined" template needed now ────────────────────────
// Source of truth: packages/shared/src/messages.ts

const joinedMessages: Record<Locale, string> = {
  fr: "✅ Vous êtes dans la file chez *{name}* !\n\n🎫 Ticket : *{ticket}*\n📍 Position : *#{position}*\n⏱️ Attente estimée : *~{wait} min*\n\n📍 Suivez votre position : {url}",
  ar: "أنت في الطابور في *{name}*! ✅\n\n🎫 التذكرة: *{ticket}*\n📍 الموقع: *#{position}*\n⏱️ الانتظار المتوقع: *~{wait} د*\n\n📍 تتبع موقعك: {url}",
  en: "✅ You're in the queue at *{name}*!\n\n🎫 Ticket: *{ticket}*\n📍 Position: *#{position}*\n⏱️ Est. wait: *~{wait} min*\n\n📍 Track your position: {url}",
};

function renderJoined(locale: Locale, vars: Record<string, string>): string {
  let msg = joinedMessages[locale] ?? joinedMessages["fr"];
  for (const [k, v] of Object.entries(vars)) {
    msg = msg.replaceAll(`{${k}}`, v);
  }
  return msg;
}

// ── WhatsApp send (Meta Cloud API) — only for "joined" event ────────

const WA_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "qflo_queue_update";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";

/** Translate Meta WhatsApp error codes into a short operator-facing hint.
 *  Codes ref: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes */
function hintForCode(code?: number): string {
  switch (code) {
    case 131030: return "Recipient not in test allow-list (sandbox mode)";
    case 131026: return "Message undeliverable (number not on WhatsApp or blocked)";
    case 131047: return "Outside 24h window — template required";
    case 131051: return "Unsupported message type for this contact";
    case 132000: return "Template parameter mismatch";
    case 132001: return "Template not found or not approved";
    case 132005: return "Template language mismatch";
    case 132007: return "Template paused (low quality rating)";
    case 132012: return "Template parameter format invalid";
    case 132015: return "Template paused";
    case 132016: return "Template disabled";
    case 100:    return "Invalid parameter (check phone or template)";
    case 190:    return "Access token expired or invalid";
    case 80007:  return "Rate limit hit — try again";
    case 130429: return "Rate limit hit — try again";
    case 0:      return "Network or transport error";
    default:     return code ? `Meta error ${code}` : "Send failed";
  }
}

async function sendWhatsAppRaw(phone: string, payload: Record<string, unknown>): Promise<{ ok: boolean; errorCode?: number; errorMessage?: string; errorSubcode?: number }> {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) {
    return { ok: false, errorMessage: "WhatsApp not configured (missing access token or phone number id)" };
  }

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
      const subcode = data?.error?.error_subcode ?? data?.error?.error_data?.details ?? undefined;
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      console.error("[notify-ticket:whatsapp] Failed:", msg, `(code=${code}, subcode=${subcode ?? '-'})`);
      return { ok: false, errorCode: code, errorMessage: msg, errorSubcode: typeof subcode === "number" ? subcode : undefined };
    }
    console.log("[notify-ticket:whatsapp] Sent to ***" + phone.slice(-4));
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-ticket:whatsapp] Error:", msg);
    return { ok: false, errorMessage: msg };
  }
}

/**
 * Normalize phone to international digits (no + prefix).
 * Simplified — only needed for "joined" event.
 */
function normalizePhoneForMeta(phone: string, countryDialCode?: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0") && countryDialCode) return countryDialCode + digits.slice(1);
  if (digits.length === 10 && !digits.startsWith("0")) return "1" + digits;
  if (digits.length === 9 && (countryDialCode === "213" || (!countryDialCode && /^[567]/.test(digits)))) return "213" + digits;
  if (digits.length === 9 && countryDialCode === "33") return "33" + digits;
  return digits;
}

type SendResult = {
  ok: boolean;
  errorCode?: number;
  errorMessage?: string;
  errorSubcode?: number;
  attempted?: ("text" | "template")[];
};

async function sendWhatsApp(phone: string, body: string): Promise<SendResult> {
  const digits = normalizePhoneForMeta(phone);
  if (digits.length < 7) {
    return { ok: false, errorMessage: "Phone too short after normalization" };
  }

  const attempted: SendResult["attempted"] = [];

  // Try free-form text first (works if customer messaged us within 24h)
  attempted.push("text");
  const textResult = await sendWhatsAppRaw(digits, { type: "text", text: { body } });
  if (textResult.ok) return { ok: true, attempted };

  // If outside 24h window, retry with approved template
  if (textResult.errorCode === 131047 || textResult.errorCode === 131030 || textResult.errorCode === 130429) {
    console.log("[notify-ticket:whatsapp] Outside 24h window, retrying with template...");
    attempted.push("template");
    const templateResult = await sendWhatsAppRaw(digits, {
      type: "template",
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [{ type: "body", parameters: [{ type: "text", text: body }] }],
      },
    });
    if (templateResult.ok) return { ok: true, attempted };
    return {
      ok: false,
      errorCode: templateResult.errorCode,
      errorMessage: templateResult.errorMessage,
      errorSubcode: templateResult.errorSubcode,
      attempted,
    };
  }

  return {
    ok: false,
    errorCode: textResult.errorCode,
    errorMessage: textResult.errorMessage,
    errorSubcode: textResult.errorSubcode,
    attempted,
  };
}

// ── Push notification (forwarded to Vercel) ──────────────────────────

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
//
// As of v20, WhatsApp/Messenger notifications for called/serving/served/
// no_show/cancelled are handled by notifyCustomer() (web server actions)
// and /api/ticket-transition (desktop/mobile). This edge function only:
//   1. Handles "joined" event (WhatsApp welcome message on queue join)
//   2. Forwards push notifications (if pushPayload is provided)
//
// Service-type branching for ready/served (Takeout/Delivery/Dine-in copy)
// lives in apps/web/src/lib/notify.ts:notifyCustomer(), which imports
// resolveRestaurantServiceType from packages/shared/src/restaurant-services.ts.
// If this edge function ever needs to handle ready/served directly, use:
//
//   /* SHARED-COPY: keep in sync with packages/shared/src/restaurant-services.ts */
//   const TAKEOUT_RE  = /take.?out|à emporter|emporter|takeaway/i;
//   const DELIVERY_RE = /deliver|livrais/i;
//   const DINE_IN_RE  = /dine.?in|sur place|surplace/i;
//   function resolveServiceType(name) {
//     if (!name) return 'other';
//     const low = name.toLowerCase();
//     if (TAKEOUT_RE.test(low)) return 'takeout';
//     if (DELIVERY_RE.test(low)) return 'delivery';
//     if (DINE_IN_RE.test(low)) return 'dine_in';
//     return 'other';
//   }
//
// The old trigger-based WhatsApp path has been removed to prevent
// duplicate messages. To restore it, check git history.

const VERSION = "21";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { ticketId, event, pushPayload } = body as {
      ticketId: string;
      event: Event;
      pushPayload?: Record<string, unknown>;
    };

    const validEvents: Event[] = ["called", "recall", "buzz", "serving", "no_show", "served", "cancelled", "next_in_line", "approaching", "joined"];
    if (!validEvents.includes(event)) {
      return new Response(JSON.stringify({ error: `Invalid event: ${event}` }), { status: 400 });
    }

    console.log(`[notify-ticket v${VERSION}] event=${event} ticketId=${ticketId}`);

    if (!ticketId || !event) {
      return new Response(JSON.stringify({ error: "Missing ticketId or event" }), { status: 400 });
    }

    // ── "joined" event — send WhatsApp welcome message ────────────────
    if (event === "joined") {
      const { phone, ticketNumber, officeName, position, trackUrl, waitMinutes, countryDialCode, locale: reqLocale } = body as {
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
      // Prefer ticket-level locale over caller's locale
      let joinedLocale: Locale = (reqLocale as Locale) || "fr";
      try {
        const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: tRow } = await sb.from("tickets").select("locale").eq("id", ticketId).single();
        const tl = (tRow as any)?.locale;
        if (tl === "ar" || tl === "en" || tl === "fr") joinedLocale = tl;
      } catch { /* ignore */ }

      const message = renderJoined(joinedLocale, {
        ticket: ticketNumber ?? "—",
        name: officeName ?? "",
        position: String(position ?? 1),
        wait: String(waitMinutes ?? 1),
        url: trackUrl ?? "",
      });
      const result = await sendWhatsApp(normalizedPhone, message);
      console.log(`[notify-ticket v${VERSION}] joined: phone=***${normalizedPhone.slice(-4)} sent=${result.ok} code=${result.errorCode ?? '-'}`);
      return Response.json({
        sent: result.ok,
        version: VERSION,
        ...(result.ok ? {} : {
          metaErrorCode: result.errorCode,
          metaErrorSubcode: result.errorSubcode,
          metaErrorMessage: result.errorMessage,
          attempted: result.attempted,
          // Operator-facing hint translated from Meta error codes
          reason: hintForCode(result.errorCode),
        }),
      });
    }

    // ── All other events — push only, WhatsApp handled by notifyCustomer() ──
    if (pushPayload) {
      await sendPush(pushPayload);
    }

    console.log(`[notify-ticket v${VERSION}] ${event}: push-only (WhatsApp via notifyCustomer)`);
    return Response.json({ sent: false, reason: "whatsapp_handled_by_notify_customer", pushSent: !!pushPayload, version: VERSION });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[notify-ticket] Error:", message);
    return Response.json({ sent: false, error: message }, { status: 500 });
  }
});

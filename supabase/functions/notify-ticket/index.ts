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
type Event = "called" | "recall" | "buzz" | "no_show" | "served" | "cancelled" | "next_in_line" | "approaching";

interface Session {
  id: string;
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
    fr: "🔔 *C'est votre tour !* Ticket *{ticket}* — veuillez vous rendre au *{desk}* dans les *{wait} minutes*.\n\nSuivi : {url}",
    ar: "🔔 *حان دورك!* التذكرة *{ticket}* — يرجى التوجه إلى *{desk}* خلال *{wait} دقائق*.\n\nتتبع: {url}",
    en: "🔔 *It's your turn!* Ticket *{ticket}* — please go to *{desk}* within *{wait} minutes*.\n\nTrack: {url}",
  },
  recall: {
    fr: "⏰ *Rappel :* Le ticket *{ticket}* vous attend toujours au *{desk}*. Vous avez *{wait} minutes* pour vous présenter.\n\nSuivi : {url}",
    ar: "⏰ *تذكير:* التذكرة *{ticket}* لا تزال بانتظارك في *{desk}*. لديك *{wait} دقائق* للحضور.\n\nتتبع: {url}",
    en: "⏰ *Reminder:* Ticket *{ticket}* is still waiting for you at *{desk}*. You have *{wait} minutes* to arrive.\n\nTrack: {url}",
  },
  buzz: {
    fr: "📢 *Appel :* Le personnel essaie de vous joindre (ticket *{ticket}*). Rendez-vous au *{desk}*.\n\nSuivi : {url}",
    ar: "📢 *تنبيه:* يحاول الموظفون الوصول إليك (التذكرة *{ticket}*). توجه إلى *{desk}*.\n\nتتبع: {url}",
    en: "📢 *Buzz:* Staff is trying to reach you (ticket *{ticket}*). Please go to *{desk}*.\n\nTrack: {url}",
  },
  no_show: {
    fr: "❌ Le ticket *{ticket}* a été marqué *absent*. Vous avez manqué votre tour.\n\nEnvoyez *REJOINDRE <code>* pour rejoindre à nouveau.",
    ar: "❌ التذكرة *{ticket}* تم تسجيلها كـ *غائب*. لقد فاتك دورك.\n\nأرسل *انضم <الرمز>* للانضمام مجددًا.",
    en: "❌ Ticket *{ticket}* was marked as *no show*. You missed your turn.\n\nSend *JOIN <code>* to rejoin.",
  },
  served: {
    fr: "✅ Le ticket *{ticket}* est terminé. Merci pour votre visite !\n\nNous espérons vous revoir bientôt.",
    ar: "✅ التذكرة *{ticket}* مكتملة. شكرًا لزيارتكم!\n\nنتمنى رؤيتكم مجددًا.",
    en: "✅ Ticket *{ticket}* is complete. Thank you for visiting!\n\nWe hope to see you again.",
  },
  next_in_line: {
    fr: "⏳ *Vous êtes le prochain !* Ticket *{ticket}* — préparez-vous, c'est bientôt votre tour.\n\nSuivi : {url}",
    ar: "⏳ *أنت التالي!* التذكرة *{ticket}* — استعد، دورك قريبًا.\n\nتتبع: {url}",
    en: "⏳ *You're next!* Ticket *{ticket}* — get ready, it's almost your turn.\n\nTrack: {url}",
  },
  approaching: {
    fr: "📍 *Bientôt votre tour !* Vous êtes *#{position}* dans la file (ticket *{ticket}*). Commencez à vous rapprocher.\n\nSuivi : {url}",
    ar: "📍 *اقترب دورك!* أنت *#{position}* في الطابور (التذكرة *{ticket}*). ابدأ بالتوجه.\n\nتتبع: {url}",
    en: "📍 *Almost your turn!* You're *#{position}* in line (ticket *{ticket}*). Start heading over.\n\nTrack: {url}",
  },
  cancelled_notify: {
    fr: "🚫 Le ticket *{ticket}* a été annulé.",
    ar: "🚫 تم إلغاء التذكرة *{ticket}*.",
    en: "🚫 Ticket *{ticket}* has been cancelled.",
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

async function sendWhatsApp(phone: string, body: string): Promise<boolean> {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) return false;

  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 7) return false;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v22.0/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: digits,
          type: "text",
          text: { body },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[notify-ticket:whatsapp] Failed:", data?.error?.message ?? res.status);
      return false;
    }
    console.log("[notify-ticket:whatsapp] Sent to", digits, "msgId:", data?.messages?.[0]?.id);
    return true;
  } catch (err) {
    console.error("[notify-ticket:whatsapp] Error:", err);
    return false;
  }
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
      `https://graph.facebook.com/v22.0/me/messages?access_token=${MESSENGER_PAGE_ACCESS_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    console.log("[notify-ticket:messenger] Sent to", recipientId);
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
    });
  } catch (err) {
    console.error("[notify-ticket:push] Error:", err);
  }
}

// ── Main handler ─────────────────────────────────────────────────────

const VERSION = "8";

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { ticketId, event, deskName, waitMinutes, position, pushPayload } = body as {
      ticketId: string;
      event: Event;
      deskName: string;
      waitMinutes?: number;
      position?: number;
      pushPayload?: Record<string, unknown>;
    };

    console.log(`[notify-ticket v${VERSION}] event=${event} ticketId=${ticketId} hasMessengerToken=${!!MESSENGER_PAGE_ACCESS_TOKEN} hasWAToken=${!!WA_ACCESS_TOKEN}`);

    if (!ticketId || !event) {
      return new Response(JSON.stringify({ error: "Missing ticketId or event" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fire push notification in parallel (non-blocking)
    const pushPromise = pushPayload ? sendPush(pushPayload) : Promise.resolve();

    // Look up ticket
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, ticket_number, qr_token, status")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return Response.json({ sent: false, reason: "ticket not found" });
    }

    // Look up active session (WhatsApp or Messenger)
    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("id, whatsapp_phone, whatsapp_bsuid, messenger_psid, channel, locale, otn_token")
      .eq("ticket_id", ticketId)
      .eq("state", "active")
      .maybeSingle() as { data: Session | null };

    if (!session) {
      await pushPromise;
      console.log(`[notify-ticket v${VERSION}] No active session for ticket ${ticketId}`);
      return Response.json({ sent: false, reason: "no active session", version: VERSION });
    }

    console.log(`[notify-ticket v${VERSION}] Session found: channel=${session.channel} psid=${session.messenger_psid} phone=${session.whatsapp_phone} bsuid=${session.whatsapp_bsuid}`);

    const locale = (session.locale as Locale) || "fr";
    const trackUrl = `${APP_BASE_URL}/q/${ticket.qr_token}`;
    const msgKey = event === "cancelled" ? "cancelled_notify" : event;
    const message = t(msgKey, locale, {
      ticket: ticket.ticket_number,
      desk: deskName || "your desk",
      url: trackUrl,
      wait: String(waitMinutes ?? 10),
      position: String(position ?? 3),
    });

    const isTerminal = ["no_show", "served", "cancelled"].includes(event);
    let sent = false;

    if (session.channel === "messenger" && session.messenger_psid) {
      sent = await sendMessenger(session.messenger_psid, message);
    } else if (session.whatsapp_phone) {
      sent = await sendWhatsApp(session.whatsapp_phone, message);
    } else if (session.whatsapp_bsuid) {
      // Username adopter without phone — BSUID sending available May 2026
      console.warn(`[notify-ticket v${VERSION}] No phone for session, bsuid=${session.whatsapp_bsuid} — cannot send yet`);
    }

    if (sent) {
      // Log notification
      await supabase.from("notifications").insert({
        ticket_id: ticketId,
        type: `${session.channel}_${event}`,
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

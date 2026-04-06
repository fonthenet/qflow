import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Meta Cloud API
const WA_ACCESS_TOKEN = Deno.env.get("WHATSAPP_META_ACCESS_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_META_PHONE_NUMBER_ID") ?? "";

// Messenger
const MESSENGER_PAGE_ACCESS_TOKEN = Deno.env.get("MESSENGER_PAGE_ACCESS_TOKEN") ?? "";

// WhatsApp template fallback
const WA_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "qflo_queue_update";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";

// ── Types ────────────────────────────────────────────────────────────

type Locale = "fr" | "ar" | "en";

// ── i18n ─────────────────────────────────────────────────────────────

const positionMessages: Record<Locale, string> = {
  fr: "📍 *{name}* — Mise à jour\n\nVous êtes maintenant *#{position}* dans la file.\n⏱ Attente estimée : ~*{wait} min*",
  ar: "📍 *{name}* — تحديث\n\nأنت الآن *#{position}* في الطابور.\n⏱ الانتظار المتوقع: ~*{wait} دقيقة*",
  en: "📍 *{name}* — Update\n\nYou're now *#{position}* in line.\n⏱ Est. wait: ~*{wait} min*",
};

// ── WhatsApp send ────────────────────────────────────────────────────

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
      console.error("[position-update:whatsapp] Failed:", data?.error?.message ?? res.status, `(code=${code})`);
      return { ok: false, errorCode: code };
    }
    console.log("[position-update:whatsapp] Sent to ***" + phone.slice(-4));
    return { ok: true };
  } catch (err) {
    console.error("[position-update:whatsapp] Error:", err);
    return { ok: false };
  }
}

async function sendWhatsApp(phone: string, body: string): Promise<boolean> {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 7) return false;

  const textResult = await sendWhatsAppRaw(digits, { type: "text", text: { body } });
  if (textResult.ok) return true;

  // If outside 24h window, retry with approved template
  if (textResult.errorCode === 131047 || textResult.errorCode === 131030 || textResult.errorCode === 130429) {
    console.log("[position-update:whatsapp] Outside 24h window, retrying with template...");
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

// ── Messenger send ───────────────────────────────────────────────────

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
      if (!tag) {
        console.log("[position-update:messenger] Retrying with tag...");
        return sendMessenger(recipientId, text, "CONFIRMED_EVENT_UPDATE");
      }
      console.error("[position-update:messenger] Failed:", data?.error?.message ?? res.status);
      return false;
    }
    console.log("[position-update:messenger] Sent to ***" + recipientId.slice(-4));
    return true;
  } catch (err) {
    console.error("[position-update:messenger] Error:", err);
    return false;
  }
}

// ── Main handler ─────────────────────────────────────────────────────

const VERSION = "1";

// Average service time estimation (minutes per person)
const AVG_SERVICE_TIME = 3;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  try {
    const { officeId, departmentId } = await req.json();

    console.log(`[position-update v${VERSION}] officeId=${officeId} departmentId=${departmentId || "all"}`);

    if (!officeId) {
      return Response.json({ error: "officeId required" }, { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get all waiting tickets in this office (optionally filtered by department)
    let query = supabase
      .from("tickets")
      .select("id, ticket_number, office_id, department_id, created_at, priority")
      .eq("office_id", officeId)
      .eq("status", "waiting")
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    if (departmentId) query = query.eq("department_id", departmentId);

    const { data: waitingTickets } = await query;
    if (!waitingTickets || waitingTickets.length === 0) {
      return Response.json({ sent: 0, total: 0, version: VERSION });
    }

    // 2. For each waiting ticket, find active sessions
    const ticketIds = waitingTickets.map((t) => t.id);
    const { data: sessions } = await supabase
      .from("whatsapp_sessions")
      .select("id, ticket_id, channel, whatsapp_phone, messenger_psid, locale, last_notified_position, organization_id")
      .eq("state", "active")
      .in("ticket_id", ticketIds);

    if (!sessions || sessions.length === 0) {
      return Response.json({ sent: 0, total: 0, version: VERSION });
    }

    // 3. Build position map (ticket_id -> 1-based position)
    const positionMap = new Map<string, number>();
    waitingTickets.forEach((t, i) => positionMap.set(t.id, i + 1));

    // Get organization name for messages
    const { data: office } = await supabase
      .from("offices")
      .select("organization_id")
      .eq("id", officeId)
      .single();

    let orgName = "Queue";
    if (office) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", office.organization_id)
        .single();
      orgName = org?.name || "Queue";
    }

    let sent = 0;

    for (const session of sessions) {
      const position = positionMap.get(session.ticket_id);
      if (!position) continue;

      const lastPos = session.last_notified_position as number | null;

      // Determine if we should send an update:
      // - Never notified before and position <= 10
      // - Position decreased by 3+ since last notification
      // - Position crossed the 5-threshold (was >5, now <=5)
      // - Position is now 1 (next in line -- handled by separate trigger, skip here)
      const shouldNotify =
        (lastPos === null && position <= 10) ||
        (lastPos !== null && lastPos - position >= 3) ||
        (lastPos !== null && lastPos > 5 && position <= 5);

      // Skip position 1: "next_in_line" is handled by the existing notify_ticket_called trigger
      if (!shouldNotify || position <= 1) continue;

      const locale = (session.locale || "fr") as Locale;
      const msgTemplate = positionMessages[locale] || positionMessages.fr;
      const waitMin = position * AVG_SERVICE_TIME;
      const body = msgTemplate
        .replace("{name}", orgName)
        .replace("{position}", String(position))
        .replace("{wait}", String(waitMin));

      try {
        let messageSent = false;

        if (session.channel === "messenger" && session.messenger_psid) {
          messageSent = await sendMessenger(session.messenger_psid, body);
        } else if (session.channel === "whatsapp" && session.whatsapp_phone) {
          messageSent = await sendWhatsApp(session.whatsapp_phone, body);
        }

        if (messageSent) {
          sent++;
          // Update last_notified_position
          await supabase
            .from("whatsapp_sessions")
            .update({ last_notified_position: position })
            .eq("id", session.id);
        }
      } catch (err) {
        console.error(`[position-update] Error sending to session ${session.id}:`, err);
      }
    }

    console.log(`[position-update v${VERSION}] Done: sent=${sent} total_sessions=${sessions.length}`);
    return Response.json({ sent, total: sessions.length, version: VERSION });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[position-update] Error:", message);
    return Response.json({ sent: false, error: message }, { status: 500 });
  }
});

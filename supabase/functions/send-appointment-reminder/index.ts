import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// WhatsApp Meta Cloud API
const WA_ACCESS_TOKEN = Deno.env.get("WHATSAPP_META_ACCESS_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_META_PHONE_NUMBER_ID") ?? "";

// Template for appointment reminders (must be approved in Meta Business Manager)
const WA_TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "qflo_queue_update";
const WA_TEMPLATE_LANG = Deno.env.get("WHATSAPP_TEMPLATE_LANG") ?? "en";

const VERSION = "1";
const MAX_RETRIES = 3;
const BATCH_SIZE = 50;

// ── WhatsApp send (Meta Cloud API) ──────────────────────────────────

async function sendWhatsAppRaw(
  phone: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; errorCode?: number; errorMessage?: string }> {
  if (!WA_ACCESS_TOKEN || !WA_PHONE_NUMBER_ID) {
    return { ok: false, errorMessage: "Missing WA credentials" };
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
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          ...payload,
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const code = data?.error?.code ?? 0;
      const msg = data?.error?.message ?? `HTTP ${res.status}`;
      console.error(
        `[appointment-reminder:whatsapp] Failed: ${msg} (code=${code})`
      );
      return { ok: false, errorCode: code, errorMessage: msg };
    }
    console.log(
      "[appointment-reminder:whatsapp] Sent to ***" + phone.slice(-4)
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[appointment-reminder:whatsapp] Error:", msg);
    return { ok: false, errorMessage: msg };
  }
}

async function sendWhatsApp(phone: string, body: string): Promise<boolean> {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 7) return false;

  // Try free-form text first (works if customer messaged us within 24h)
  const textResult = await sendWhatsAppRaw(digits, {
    type: "text",
    text: { body },
  });
  if (textResult.ok) return true;

  // If outside 24h window, retry with an approved template message
  if (
    textResult.errorCode === 131047 ||
    textResult.errorCode === 131030 ||
    textResult.errorCode === 130429
  ) {
    console.log(
      "[appointment-reminder:whatsapp] Outside 24h window, retrying with template..."
    );

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

// ── Time formatting ─────────────────────────────────────────────────

function formatTime(dateStr: string, timezone: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone || "UTC",
      hour12: true,
    });
  } catch {
    // Fallback: extract HH:MM from ISO string
    const date = new Date(dateStr);
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { appointmentId } = body as { appointmentId?: string };

    console.log(
      `[appointment-reminder v${VERSION}] Invoked. appointmentId=${appointmentId ?? "batch-mode"}`
    );

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Build query for pending reminder jobs ───────────────────────
    let query = supabase
      .from("notification_jobs")
      .select("*")
      .eq("action", "appointment_reminder")
      .eq("channel", "whatsapp")
      .in("status", ["pending", "processing"])
      .lte("next_retry_at", new Date().toISOString())
      .lt("retry_count", MAX_RETRIES)
      .order("next_retry_at", { ascending: true })
      .limit(BATCH_SIZE);

    // If a specific appointmentId is provided, filter to just that one
    if (appointmentId) {
      query = query.filter("payload->>appointment_id", "eq", appointmentId);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error(
        "[appointment-reminder] Error fetching jobs:",
        jobsError.message
      );
      return Response.json(
        { error: "Failed to fetch jobs", detail: jobsError.message },
        { status: 500 }
      );
    }

    if (!jobs || jobs.length === 0) {
      console.log("[appointment-reminder] No pending reminder jobs found.");
      return Response.json({
        processed: 0,
        message: "No pending reminders",
        version: VERSION,
      });
    }

    console.log(`[appointment-reminder] Found ${jobs.length} pending jobs.`);

    // Mark all as processing to prevent duplicate pickup
    const jobIds = jobs.map((j: { id: string }) => j.id);
    await supabase
      .from("notification_jobs")
      .update({ status: "processing" })
      .in("id", jobIds);

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of jobs) {
      const payload = job.payload as {
        appointment_id: string;
        customer_name: string;
        customer_phone: string;
        customer_email?: string;
        scheduled_at: string;
        service_id: string;
        office_id: string;
        staff_id?: string;
        reminder_type: string;
      };

      if (!payload?.appointment_id) {
        console.warn(
          `[appointment-reminder] Job ${job.id} has no appointment_id in payload, skipping.`
        );
        await supabase
          .from("notification_jobs")
          .update({ status: "skipped" })
          .eq("id", job.id);
        skipped++;
        continue;
      }

      // ── Fetch appointment to check it's still valid ───────────────
      const { data: appointment } = await supabase
        .from("appointments")
        .select(
          "id, status, customer_name, customer_phone, scheduled_at, service_id, office_id, department_id, reminder_sent"
        )
        .eq("id", payload.appointment_id)
        .single();

      if (!appointment) {
        console.warn(
          `[appointment-reminder] Appointment ${payload.appointment_id} not found, skipping.`
        );
        await supabase
          .from("notification_jobs")
          .update({ status: "skipped" })
          .eq("id", job.id);
        skipped++;
        continue;
      }

      // Skip if appointment was cancelled, completed, or reminder already sent
      if (
        appointment.status === "cancelled" ||
        appointment.status === "completed" ||
        appointment.reminder_sent === true
      ) {
        console.log(
          `[appointment-reminder] Appointment ${appointment.id} status=${appointment.status} reminder_sent=${appointment.reminder_sent}, skipping.`
        );
        await supabase
          .from("notification_jobs")
          .update({ status: "skipped" })
          .eq("id", job.id);
        skipped++;
        continue;
      }

      // ── Fetch related data (service name, office timezone) ────────
      const [serviceRes, officeRes] = await Promise.all([
        supabase
          .from("services")
          .select("name")
          .eq("id", appointment.service_id)
          .single(),
        supabase
          .from("offices")
          .select("name, organization:organizations(timezone)")
          .eq("id", appointment.office_id)
          .single(),
      ]);

      const serviceName = serviceRes.data?.name ?? "your service";
      const officeName = officeRes.data?.name ?? "";
      // Use org-level timezone as single source of truth
      const timezone = (officeRes.data as any)?.organization?.timezone ?? "Africa/Algiers";
      const customerName = appointment.customer_name || "there";
      const phone = appointment.customer_phone || payload.customer_phone;
      const formattedTime = formatTime(appointment.scheduled_at, timezone);

      if (!phone) {
        console.warn(
          `[appointment-reminder] No phone for appointment ${appointment.id}, skipping.`
        );
        await supabase
          .from("notification_jobs")
          .update({ status: "skipped" })
          .eq("id", job.id);
        skipped++;
        continue;
      }

      // ── Compose message ───────────────────────────────────────────
      let message = `Hi ${customerName}, reminder: your appointment for ${serviceName} is at ${formattedTime} today.`;
      if (officeName) {
        message += ` Location: ${officeName}.`;
      }
      message += ` Reply YES to confirm or CANCEL to cancel.`;

      // ── Send WhatsApp message ─────────────────────────────────────
      const wasSent = await sendWhatsApp(phone, message);

      if (wasSent) {
        // Mark job as sent
        await supabase
          .from("notification_jobs")
          .update({
            status: "sent",
            last_error: null,
          })
          .eq("id", job.id);

        // Mark appointment reminder as sent
        await supabase
          .from("appointments")
          .update({ reminder_sent: true })
          .eq("id", appointment.id);

        // Log notification
        await supabase
          .from("notifications")
          .insert({
            ticket_id: job.ticket_id,
            type: "whatsapp_appointment_reminder",
            channel: "whatsapp",
            payload: {
              appointment_id: appointment.id,
              customer_phone: phone.slice(-4),
            },
            sent_at: new Date().toISOString(),
          })
          .then(
            () => {},
            () => {}
          ); // ignore errors

        sent++;
        console.log(
          `[appointment-reminder] Sent reminder for appointment ${appointment.id} to ***${phone.slice(-4)}`
        );
      } else {
        // Increment retry count and schedule next retry (exponential backoff)
        const retryCount = (job.retry_count ?? 0) + 1;
        const backoffMinutes = Math.min(5 * Math.pow(2, retryCount), 60);
        const nextRetry = new Date(
          Date.now() + backoffMinutes * 60 * 1000
        ).toISOString();

        if (retryCount >= MAX_RETRIES) {
          await supabase
            .from("notification_jobs")
            .update({
              status: "failed",
              retry_count: retryCount,
              last_error: "Max retries exceeded",
            })
            .eq("id", job.id);
          console.error(
            `[appointment-reminder] Max retries reached for appointment ${appointment.id}`
          );
        } else {
          await supabase
            .from("notification_jobs")
            .update({
              status: "pending",
              retry_count: retryCount,
              next_retry_at: nextRetry,
              last_error: "WhatsApp send failed",
            })
            .eq("id", job.id);
          console.warn(
            `[appointment-reminder] Retry ${retryCount}/${MAX_RETRIES} for appointment ${appointment.id}, next at ${nextRetry}`
          );
        }

        failed++;
      }
    }

    console.log(
      `[appointment-reminder v${VERSION}] Done: sent=${sent} failed=${failed} skipped=${skipped}`
    );
    return Response.json({
      processed: jobs.length,
      sent,
      failed,
      skipped,
      version: VERSION,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[appointment-reminder] Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
});

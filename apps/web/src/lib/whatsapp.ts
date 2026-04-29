import 'server-only';

// Re-export normalizePhone from shared package (single source of truth)
import { normalizePhone } from '@qflo/shared';
export { normalizePhone };

export interface WhatsAppSendResult {
  ok: boolean;
  provider: 'meta' | 'twilio' | 'none';
  to?: string;
  sid?: string;
  error?: string;
}

function getTrimmedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

// ── Meta Cloud API ──────────────────────────────────────────────
interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

function getMetaWhatsAppConfig(): MetaWhatsAppConfig | null {
  const accessToken = getTrimmedEnv('WHATSAPP_META_ACCESS_TOKEN');
  const phoneNumberId = getTrimmedEnv('WHATSAPP_META_PHONE_NUMBER_ID');
  if (!accessToken || !phoneNumberId) return null;
  return { accessToken, phoneNumberId };
}

// ── Twilio (fallback) ───────────────────────────────────────────
interface TwilioWhatsAppConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

function getTwilioWhatsAppConfig(): TwilioWhatsAppConfig | null {
  const accountSid = getTrimmedEnv('TWILIO_ACCOUNT_SID');
  const authToken = getTrimmedEnv('TWILIO_AUTH_TOKEN');
  const fromNumber =
    getTrimmedEnv('TWILIO_WHATSAPP_FROM_NUMBER') ??
    getTrimmedEnv('TWILIO_FROM_NUMBER');
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

export function isWhatsAppConfigured(): boolean {
  return getMetaWhatsAppConfig() !== null || getTwilioWhatsAppConfig() !== null;
}

// ── Send via Meta Cloud API ─────────────────────────────────────
async function sendViaMeta(
  config: MetaWhatsAppConfig,
  to: string,
  body: string,
  timezone?: string,
): Promise<WhatsAppSendResult> {
  const normalizedTo = normalizePhone(to, timezone);
  if (!normalizedTo) {
    return { ok: false, provider: 'meta', error: 'Phone number is not valid' };
  }

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { body },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorCode = data?.error?.code ?? 0;
    const errorMsg =
      data?.error?.message ??
      `Meta WhatsApp API failed with status ${response.status}`;
    console.error('[whatsapp:meta] Send failed:', errorMsg, `(code=${errorCode})`, data);

    // Outside 24h window or not in allowed list → retry with template
    if (errorCode === 131047 || errorCode === 131030 || errorCode === 130429) {
      console.log('[whatsapp:meta] Retrying with template message...');
      const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? 'qflo_queue_update';
      const templateLang = process.env.WHATSAPP_TEMPLATE_LANG ?? 'en';
      const templateRes = await fetch(
        `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'template',
            template: {
              name: templateName,
              language: { code: templateLang },
              components: [{ type: 'body', parameters: [{ type: 'text', text: body }] }],
            },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        }
      );
      const templateData = await templateRes.json().catch(() => ({}));
      if (templateRes.ok) {
        const tmplMsgId = templateData?.messages?.[0]?.id;
        return { ok: true, provider: 'meta', to: normalizedTo, sid: tmplMsgId };
      }
      console.error('[whatsapp:meta] Template send also failed:', templateData?.error?.message);
    }

    return { ok: false, provider: 'meta', to: normalizedTo, error: errorMsg };
  }

  const messageId = data?.messages?.[0]?.id;
  return { ok: true, provider: 'meta', to: normalizedTo, sid: messageId };
}

// ── Send via Twilio ─────────────────────────────────────────────
async function sendViaTwilio(
  config: TwilioWhatsAppConfig,
  to: string,
  body: string,
  timezone?: string,
): Promise<WhatsAppSendResult> {
  const normalizedTo = normalizePhone(to, timezone);
  if (!normalizedTo) {
    return { ok: false, provider: 'twilio', error: 'Phone number is not valid' };
  }

  const toE164 = normalizedTo.startsWith('+') ? normalizedTo : `+${normalizedTo}`;
  const payload = new URLSearchParams({
    From: `whatsapp:${config.fromNumber}`,
    To: `whatsapp:${toE164}`,
    Body: body,
  });

  const credentials = Buffer.from(
    `${config.accountSid}:${config.authToken}`
  ).toString('base64');

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      provider: 'twilio',
      to: toE164,
      error: data?.message ?? `Twilio failed with status ${response.status}`,
    };
  }

  return { ok: true, provider: 'twilio', to: toE164, sid: data?.sid };
}

// ── Send image via Meta Cloud API ───────────────────────────────
/**
 * Send a WhatsApp image message (link type) via the Meta Cloud API.
 * Used to deliver QR code images stored in Supabase Storage (signed URL).
 *
 * Falls back gracefully — if Meta is not configured or the call fails,
 * returns `{ ok: false }` without throwing. The caller should fall back to
 * sending the caption as a text message.
 */
export async function sendWhatsAppImageMessage({
  to,
  imageUrl,
  caption,
  timezone,
}: {
  to: string;
  imageUrl: string;
  caption?: string;
  timezone?: string;
}): Promise<WhatsAppSendResult> {
  const config = getMetaWhatsAppConfig();
  if (!config) {
    return { ok: false, provider: 'meta', error: 'Meta Cloud API not configured — image messages require Meta' };
  }

  const normalizedTo = normalizePhone(to, timezone);
  if (!normalizedTo) {
    return { ok: false, provider: 'meta', error: 'Phone number is not valid' };
  }

  const response = await fetch(
    `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'image',
        image: {
          link: imageUrl,
          ...(caption ? { caption } : {}),
        },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg =
      data?.error?.message ??
      `Meta WhatsApp image API failed with status ${response.status}`;
    console.error('[whatsapp:meta:image] Send failed:', errorMsg, data);
    return { ok: false, provider: 'meta', to: normalizedTo, error: errorMsg };
  }

  const messageId = data?.messages?.[0]?.id;
  return { ok: true, provider: 'meta', to: normalizedTo, sid: messageId };
}

// ── Main send function (tries Meta first, falls back to Twilio) ─
export async function sendWhatsAppMessage({
  to,
  body,
  timezone,
}: {
  to: string;
  body: string;
  timezone?: string;
}): Promise<WhatsAppSendResult> {
  // Try Meta Cloud API first
  const metaConfig = getMetaWhatsAppConfig();
  if (metaConfig) {
    return sendViaMeta(metaConfig, to, body, timezone);
  }

  // Fallback to Twilio
  const twilioConfig = getTwilioWhatsAppConfig();
  if (twilioConfig) {
    return sendViaTwilio(twilioConfig, to, body, timezone);
  }

  return {
    ok: false,
    provider: 'none',
    error: 'No WhatsApp provider configured (set WHATSAPP_META_ACCESS_TOKEN or TWILIO credentials)',
  };
}

// ── Location Request Message ────────────────────────────────────────
//
// Meta Cloud API supports a special interactive message type that renders
// a tappable "📍 Send Location" button inside the chat bubble. One tap
// opens WhatsApp's native picker, the customer chooses Send Current
// Location (one-tap permission grant) or pins a spot, and the reply
// arrives at our webhook as a regular `location` message — already
// handled by handleOrderAddressInput.
//
// This is the lowest-friction way to ask for an address. Twilio doesn't
// support this interactive type, so we degrade to plain text. Old WA
// clients without interactive support also get the text fallback
// automatically (Meta's degradation, not ours).
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-location-request-messages
export async function sendWhatsAppLocationRequest({
  to,
  bodyText,
  fallbackText,
  timezone,
}: {
  to: string;
  /** Bubble text shown above the Send Location button. */
  bodyText: string;
  /** Plain-text version sent alongside / instead of the interactive
   *  bubble. Should include explicit alternative instructions
   *  ("Tap 📎 → Location" + "Or just type the address…") so the
   *  customer can complete the flow even when the interactive
   *  bubble doesn't render. */
  fallbackText: string;
  timezone?: string;
}): Promise<WhatsAppSendResult> {
  // Always send the plain-text fallback FIRST. Some WhatsApp clients
  // (older versions, certain regions) misrender the interactive
  // location_request_message bubble as a "couldn't load" placeholder
  // or as a forwarded location pin — the API call succeeds (Meta
  // returns 200), but the customer's screen shows nothing usable. By
  // sending the text first, the customer always has working
  // instructions regardless of whether the interactive bubble below
  // it renders correctly.
  //
  // Cost: one extra outbound message per delivery order (~free since
  // we're inside the 24h customer-initiated window). Worth it — losing
  // a delivery customer at the address step is far more expensive.
  const textResult = await sendWhatsAppMessage({ to, body: fallbackText, timezone });

  const metaConfig = getMetaWhatsAppConfig();
  if (metaConfig) {
    const normalizedTo = normalizePhone(to, timezone);
    if (!normalizedTo) {
      // Phone normalisation failed — the text already went out, so
      // the customer still has instructions. Surface the error for
      // logging but don't pretend the whole call failed.
      return textResult.ok
        ? textResult
        : { ok: false, provider: 'meta', error: 'Phone number is not valid' };
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/v22.0/${metaConfig.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaConfig.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'interactive',
            interactive: {
              type: 'location_request_message',
              body: { text: bodyText.slice(0, 1024) },
              action: { name: 'send_location' },
            },
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        },
      );
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: true, provider: 'meta', to: normalizedTo, sid: data?.messages?.[0]?.id };
      }
      const errBody = await res.text().catch(() => '');
      console.warn('[whatsapp:locationRequest] Meta interactive failed (text fallback already sent):', errBody.slice(0, 200));
    } catch (e: any) {
      console.warn('[whatsapp:locationRequest] Meta interactive threw (text fallback already sent):', e?.message);
    }
  }
  // Either Meta isn't configured (Twilio path) or the interactive
  // attempt failed. The text fallback already went out at the top, so
  // we just return its result.
  return textResult;
}

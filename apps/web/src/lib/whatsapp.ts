import 'server-only';

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

/**
 * Normalize phone to digits-only with country code (no + prefix for Meta API).
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  return digits;
}

// ── Send via Meta Cloud API ─────────────────────────────────────
async function sendViaMeta(
  config: MetaWhatsAppConfig,
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  const normalizedTo = normalizePhone(to);
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
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg =
      data?.error?.message ??
      `Meta WhatsApp API failed with status ${response.status}`;
    console.error('[whatsapp:meta] Send failed:', errorMsg, data);
    return { ok: false, provider: 'meta', to: normalizedTo, error: errorMsg };
  }

  const messageId = data?.messages?.[0]?.id;
  return { ok: true, provider: 'meta', to: normalizedTo, sid: messageId };
}

// ── Send via Twilio ─────────────────────────────────────────────
async function sendViaTwilio(
  config: TwilioWhatsAppConfig,
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  const normalizedTo = normalizePhone(to);
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

// ── Main send function (tries Meta first, falls back to Twilio) ─
export async function sendWhatsAppMessage({
  to,
  body,
}: {
  to: string;
  body: string;
}): Promise<WhatsAppSendResult> {
  // Try Meta Cloud API first
  const metaConfig = getMetaWhatsAppConfig();
  if (metaConfig) {
    return sendViaMeta(metaConfig, to, body);
  }

  // Fallback to Twilio
  const twilioConfig = getTwilioWhatsAppConfig();
  if (twilioConfig) {
    return sendViaTwilio(twilioConfig, to, body);
  }

  return {
    ok: false,
    provider: 'none',
    error: 'No WhatsApp provider configured (set WHATSAPP_META_ACCESS_TOKEN or TWILIO credentials)',
  };
}

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

// ── Timezone → country calling code mapping ─────────────────────
const TIMEZONE_COUNTRY_CODE: Record<string, string> = {
  'Africa/Algiers': '213',
  'Africa/Tunis': '216',
  'Africa/Casablanca': '212',
  'Africa/Cairo': '20',
  'Africa/Lagos': '234',
  'Africa/Nairobi': '254',
  'Africa/Johannesburg': '27',
  'Europe/Paris': '33',
  'Europe/London': '44',
  'Europe/Berlin': '49',
  'Europe/Madrid': '34',
  'Europe/Rome': '39',
  'Europe/Brussels': '32',
  'Europe/Amsterdam': '31',
  'Europe/Zurich': '41',
  'Europe/Istanbul': '90',
  'Asia/Riyadh': '966',
  'Asia/Dubai': '971',
  'Asia/Qatar': '974',
  'Asia/Kuwait': '965',
  'Asia/Bahrain': '973',
  'Asia/Muscat': '968',
  'Asia/Amman': '962',
  'Asia/Beirut': '961',
  'Asia/Baghdad': '964',
  'America/New_York': '1',
  'America/Chicago': '1',
  'America/Denver': '1',
  'America/Los_Angeles': '1',
  'America/Toronto': '1',
  'America/Sao_Paulo': '55',
  'America/Mexico_City': '52',
  'Asia/Kolkata': '91',
  'Asia/Shanghai': '86',
  'Asia/Tokyo': '81',
  'Australia/Sydney': '61',
};

// ── ISO country code → calling code mapping ─────────────────────
const ISO_COUNTRY_DIAL: Record<string, string> = {
  DZ: '213', TN: '216', MA: '212', EG: '20', NG: '234', KE: '254', ZA: '27',
  FR: '33', GB: '44', DE: '49', ES: '34', IT: '39', BE: '32', NL: '31',
  CH: '41', TR: '90', SA: '966', AE: '971', QA: '974', KW: '965',
  BH: '973', OM: '968', JO: '962', LB: '961', IQ: '964',
  US: '1', CA: '1', MX: '52', BR: '55',
  IN: '91', CN: '86', JP: '81', AU: '61',
};

/**
 * Normalize phone to digits-only with country code (no + prefix for Meta API).
 * If the phone starts with 0 (local format), the leading 0 is replaced
 * with the country calling code derived from countryCode or timezone.
 */
/**
 * Known country dial codes sorted longest-first so we match 3-digit codes before 1-digit.
 * Used to detect if a number already starts with a valid international prefix.
 */
const ALL_DIAL_CODES = Object.values(ISO_COUNTRY_DIAL)
  .filter((v, i, a) => a.indexOf(v) === i) // unique
  .sort((a, b) => b.length - a.length);     // longest first

export function normalizePhone(phone: string, timezone?: string | null, countryCode?: string | null): string | null {
  // Strip everything except digits and leading +
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;

  // Already international with + prefix → use as-is (strip the +, Meta API wants digits only)
  if (hasPlus) return digits;

  const dialCode = (countryCode && ISO_COUNTRY_DIAL[countryCode.toUpperCase()])
    || (timezone && TIMEZONE_COUNTRY_CODE[timezone])
    || null;

  // Local format: starts with 0 → strip it and prepend country dial code
  // (common in Algeria, France, UK, etc.)
  if (digits.startsWith('0') && dialCode) {
    return dialCode + digits.slice(1);
  }

  // Already starts with the office's own dial code → use as-is
  if (dialCode && digits.startsWith(dialCode) && digits.length > dialCode.length + 6) {
    return digits;
  }

  // Detect if the number already starts with ANY known country code.
  // e.g. 16612346622 starts with "1" (US), 213551234567 starts with "213" (Algeria)
  // This handles cross-country numbers entered without "+"
  for (const code of ALL_DIAL_CODES) {
    if (digits.startsWith(code) && digits.length >= code.length + 7) {
      return digits; // already has a valid international prefix
    }
  }

  // US/Canada: 10-digit number → prepend 1
  // Works regardless of office country (US numbers are always 10 digits)
  if (digits.length === 10 && !digits.startsWith('0')) {
    return '1' + digits;
  }

  // Algeria: 9-digit subscriber number without leading 0 (e.g. 551234567)
  if (digits.length === 9 && dialCode === '213') {
    return '213' + digits;
  }

  // France: 9-digit subscriber number without leading 0 (e.g. 612345678)
  if (digits.length === 9 && dialCode === '33') {
    return '33' + digits;
  }

  // Generic: short local number → prepend office dial code
  if (dialCode && digits.length <= 9 && !digits.startsWith(dialCode)) {
    return dialCode + digits;
  }

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

// ── Send CTA URL button (Meta only) ─────────────────────────────
/**
 * Send an interactive CTA URL button message via Meta Cloud API.
 * Opens the URL inside WhatsApp's in-app browser.
 */
export async function sendWhatsAppCTAButton({
  to,
  body,
  buttonText,
  url,
  header,
  footer,
}: {
  to: string;
  body: string;
  buttonText: string;
  url: string;
  header?: string;
  footer?: string;
}): Promise<WhatsAppSendResult> {
  const config = getMetaWhatsAppConfig();
  if (!config) {
    return { ok: false, provider: 'meta', error: 'Meta WhatsApp not configured' };
  }

  const normalizedTo = normalizePhone(to);
  if (!normalizedTo) {
    return { ok: false, provider: 'meta', error: 'Phone number is not valid' };
  }

  const interactive: Record<string, any> = {
    type: 'cta_url',
    body: { text: body },
    action: {
      name: 'cta_url',
      parameters: {
        display_text: buttonText,
        url,
      },
    },
  };
  if (header) interactive.header = { type: 'text', text: header };
  if (footer) interactive.footer = { text: footer };

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
        type: 'interactive',
        interactive,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    },
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data?.error?.message ?? `Meta API failed with status ${response.status}`;
    console.error('[whatsapp:meta] CTA button send failed:', errorMsg, data);
    return { ok: false, provider: 'meta', to: normalizedTo, error: errorMsg };
  }

  const messageId = data?.messages?.[0]?.id;
  return { ok: true, provider: 'meta', to: normalizedTo, sid: messageId };
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

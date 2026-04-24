import 'server-only';

// Re-export normalizePhone from shared package (single source of truth)
import { normalizePhone } from '@qflo/shared';
import { decrypt } from '@/lib/crypto';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
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

/**
 * Load per-organization Meta credentials from the `organizations` row.
 * Returns null when the org hasn't connected their own number — the caller
 * then falls back to the platform-shared `getMetaWhatsAppConfig()` env vars.
 *
 * This is what powers the "use your own number" Embedded Signup path. The
 * shared Qflo number remains the default; per-org creds only override when
 * they exist for a given organizationId.
 */
async function getOrgMetaWhatsAppConfig(
  organizationId: string,
): Promise<MetaWhatsAppConfig | null> {
  try {
    const sb = await createServerSupabase();
    const { data, error } = await sb
      .from('organizations')
      .select('whatsapp_phone_number_id, whatsapp_access_token_encrypted')
      .eq('id', organizationId)
      .single();
    if (error || !data) return null;
    const phoneNumberId = (data as any).whatsapp_phone_number_id?.toString().trim();
    const encrypted = (data as any).whatsapp_access_token_encrypted?.toString();
    if (!phoneNumberId || !encrypted) return null;
    const accessToken = await decrypt(encrypted);
    if (!accessToken) return null;
    return { accessToken, phoneNumberId };
  } catch (err) {
    console.error('[whatsapp] getOrgMetaWhatsAppConfig failed:', err);
    return null;
  }
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
  organizationId,
}: {
  to: string;
  body: string;
  timezone?: string;
  /**
   * When provided, Qflo first tries this org's own WhatsApp credentials
   * (set via Embedded Signup). Falls back to the platform-shared number
   * from env when absent. Pass this on every call-site that has an org in
   * context so tenants who brought their own number are billed on their
   * WABA, not on Qflo's.
   */
  organizationId?: string;
}): Promise<WhatsAppSendResult> {
  // Try per-org Meta credentials first (Embedded Signup path)
  if (organizationId) {
    const orgConfig = await getOrgMetaWhatsAppConfig(organizationId);
    if (orgConfig) {
      return sendViaMeta(orgConfig, to, body, timezone);
    }
  }

  // Fall back to platform-shared Meta number
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

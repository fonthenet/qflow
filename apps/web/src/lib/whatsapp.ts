import 'server-only';

import { normalizePhoneNumber } from '@/lib/priority-alerts';

export interface WhatsAppSendResult {
  ok: boolean;
  provider: 'twilio' | 'none';
  to?: string;
  sid?: string;
  error?: string;
}

interface TwilioWhatsAppConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string; // The WhatsApp-enabled Twilio number (E.164)
}

function getTrimmedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getTwilioWhatsAppConfig(): TwilioWhatsAppConfig | null {
  const accountSid = getTrimmedEnv('TWILIO_ACCOUNT_SID');
  const authToken = getTrimmedEnv('TWILIO_AUTH_TOKEN');
  // Dedicated WhatsApp number, falls back to TWILIO_FROM_NUMBER
  const fromNumber =
    getTrimmedEnv('TWILIO_WHATSAPP_FROM_NUMBER') ??
    getTrimmedEnv('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken || !fromNumber) {
    return null;
  }

  return { accountSid, authToken, fromNumber };
}

export function isWhatsAppConfigured(): boolean {
  return getTwilioWhatsAppConfig() !== null;
}

export async function sendWhatsAppMessage({
  to,
  body,
}: {
  to: string;
  body: string;
}): Promise<WhatsAppSendResult> {
  const config = getTwilioWhatsAppConfig();

  if (!config) {
    return {
      ok: false,
      provider: 'none',
      error: 'WhatsApp provider is not configured',
    };
  }

  const normalizedTo = normalizePhoneNumber(to);
  if (!normalizedTo) {
    return {
      ok: false,
      provider: 'twilio',
      error: 'Phone number is not valid',
    };
  }

  // Twilio WhatsApp uses whatsapp: prefix on From and To
  const fromWhatsApp = `whatsapp:${config.fromNumber}`;
  const toWhatsApp = `whatsapp:${normalizedTo}`;

  const payload = new URLSearchParams({
    From: fromWhatsApp,
    To: toWhatsApp,
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
      to: normalizedTo,
      error:
        typeof data?.message === 'string'
          ? data.message
          : `Twilio WhatsApp request failed with status ${response.status}`,
    };
  }

  return {
    ok: true,
    provider: 'twilio',
    to: normalizedTo,
    sid: typeof data?.sid === 'string' ? data.sid : undefined,
  };
}

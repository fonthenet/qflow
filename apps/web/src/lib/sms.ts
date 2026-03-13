import 'server-only';

import { normalizePhoneNumber } from '@/lib/priority-alerts';

interface SmsSendParams {
  to: string;
  body: string;
}

export interface SmsSendResult {
  ok: boolean;
  provider: 'twilio' | 'none';
  to?: string;
  sid?: string;
  error?: string;
}

interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
}

function getTrimmedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function getTwilioConfig(): TwilioConfig | null {
  const accountSid = getTrimmedEnv('TWILIO_ACCOUNT_SID');
  const authToken = getTrimmedEnv('TWILIO_AUTH_TOKEN');
  const messagingServiceSid = getTrimmedEnv('TWILIO_MESSAGING_SERVICE_SID');
  const fromNumber = getTrimmedEnv('TWILIO_FROM_NUMBER');

  if (!accountSid || !authToken) {
    return null;
  }

  if (!messagingServiceSid && !fromNumber) {
    return null;
  }

  return {
    accountSid,
    authToken,
    messagingServiceSid,
    fromNumber,
  };
}

export function isSmsProviderConfigured(): boolean {
  return getTwilioConfig() !== null;
}

export async function sendSmsMessage({
  to,
  body,
}: SmsSendParams): Promise<SmsSendResult> {
  const config = getTwilioConfig();

  if (!config) {
    return {
      ok: false,
      provider: 'none',
      error: 'SMS provider is not configured',
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

  const payload = new URLSearchParams({
    To: normalizedTo,
    Body: body,
  });

  if (config.messagingServiceSid) {
    payload.set('MessagingServiceSid', config.messagingServiceSid);
  } else if (config.fromNumber) {
    payload.set('From', config.fromNumber);
  }

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
          : `Twilio request failed with status ${response.status}`,
    };
  }

  return {
    ok: true,
    provider: 'twilio',
    to: normalizedTo,
    sid: typeof data?.sid === 'string' ? data.sid : undefined,
  };
}

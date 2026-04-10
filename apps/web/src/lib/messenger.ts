import 'server-only';
import crypto from 'crypto';

export interface MessengerSendResult {
  ok: boolean;
  provider: 'messenger';
  recipientId?: string;
  messageId?: string;
  error?: string;
}

function getTrimmedEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

interface MessengerConfig {
  pageAccessToken: string;
}

function getMessengerConfig(): MessengerConfig | null {
  const pageAccessToken = getTrimmedEnv('MESSENGER_PAGE_ACCESS_TOKEN');
  if (!pageAccessToken) return null;
  return { pageAccessToken };
}

export function isMessengerConfigured(): boolean {
  return getMessengerConfig() !== null;
}

/**
 * Send a plain text message to a Messenger user (by PSID).
 */
export async function sendMessengerMessage({
  recipientId,
  text,
}: {
  recipientId: string;
  text: string;
}): Promise<MessengerSendResult> {
  const config = getMessengerConfig();
  if (!config) {
    return { ok: false, provider: 'messenger', error: 'Messenger not configured (set MESSENGER_PAGE_ACCESS_TOKEN)' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
          messaging_type: 'RESPONSE',
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `Messenger API failed with status ${response.status}`;
      console.error('[messenger] Send failed:', errorMsg, data);
      return { ok: false, provider: 'messenger', recipientId, error: errorMsg };
    }

    return { ok: true, provider: 'messenger', recipientId, messageId: data?.message_id };
  } catch (err: any) {
    return { ok: false, provider: 'messenger', recipientId, error: err?.message ?? 'Network error' };
  }
}

/**
 * Send a message with a Message Tag (for outside the 24h window).
 * Use CONFIRMED_EVENT_UPDATE for queue status updates.
 */
export async function sendMessengerMessageWithTag({
  recipientId,
  text,
  tag = 'CONFIRMED_EVENT_UPDATE',
}: {
  recipientId: string;
  text: string;
  tag?: string;
}): Promise<MessengerSendResult> {
  const config = getMessengerConfig();
  if (!config) {
    return { ok: false, provider: 'messenger', error: 'Messenger not configured' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
          messaging_type: 'MESSAGE_TAG',
          tag,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `Messenger API failed with status ${response.status}`;
      console.error('[messenger] Tagged send failed:', errorMsg, data);
      return { ok: false, provider: 'messenger', recipientId, error: errorMsg };
    }

    return { ok: true, provider: 'messenger', recipientId, messageId: data?.message_id };
  } catch (err: any) {
    return { ok: false, provider: 'messenger', recipientId, error: err?.message ?? 'Network error' };
  }
}

/**
 * Send a One-Time Notification opt-in request.
 * The user will see a "Notify Me" button; if they tap it,
 * we receive an optin webhook with a one_time_notif_token.
 */
export async function requestOneTimeNotification({
  recipientId,
  title,
  payload,
}: {
  recipientId: string;
  title: string;
  payload: string;
}): Promise<MessengerSendResult> {
  const config = getMessengerConfig();
  if (!config) {
    return { ok: false, provider: 'messenger', error: 'Messenger not configured' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'one_time_notif_req',
                title,
                payload,
              },
            },
          },
          messaging_type: 'RESPONSE',
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `Messenger OTN request failed with status ${response.status}`;
      console.error('[messenger] OTN request failed:', errorMsg, data);
      return { ok: false, provider: 'messenger', recipientId, error: errorMsg };
    }

    return { ok: true, provider: 'messenger', recipientId, messageId: data?.message_id };
  } catch (err: any) {
    return { ok: false, provider: 'messenger', recipientId, error: err?.message ?? 'Network error' };
  }
}

/**
 * Send a message using a One-Time Notification token (outside 24h window).
 */
export async function sendOneTimeNotification({
  recipientId,
  text,
  otnToken,
}: {
  recipientId: string;
  text: string;
  otnToken: string;
}): Promise<MessengerSendResult> {
  const config = getMessengerConfig();
  if (!config) {
    return { ok: false, provider: 'messenger', error: 'Messenger not configured' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { one_time_notif_token: otnToken },
          message: { text },
          messaging_type: 'MESSAGE_TAG',
          tag: 'CONFIRMED_EVENT_UPDATE',
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `Messenger OTN send failed with status ${response.status}`;
      console.error('[messenger] OTN send failed:', errorMsg, data);
      return { ok: false, provider: 'messenger', recipientId, error: errorMsg };
    }

    return { ok: true, provider: 'messenger', recipientId, messageId: data?.message_id };
  } catch (err: any) {
    return { ok: false, provider: 'messenger', recipientId, error: err?.message ?? 'Network error' };
  }
}

/**
 * Send a booking button (URL webview) to a Messenger user.
 * Opens the web booking page directly inside Messenger.
 */
export async function sendMessengerBookingButton({
  recipientId,
  text,
  buttonTitle,
  bookingUrl,
}: {
  recipientId: string;
  text: string;
  buttonTitle: string;
  bookingUrl: string;
}): Promise<MessengerSendResult> {
  const config = getMessengerConfig();
  if (!config) {
    return { ok: false, provider: 'messenger', error: 'Messenger not configured' };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/me/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.pageAccessToken}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: 'template',
              payload: {
                template_type: 'button',
                text,
                buttons: [
                  {
                    type: 'web_url',
                    url: bookingUrl,
                    title: buttonTitle,
                    webview_height_ratio: 'full',
                    messenger_extensions: false,
                  },
                ],
              },
            },
          },
          messaging_type: 'RESPONSE',
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message ?? `Messenger button send failed with status ${response.status}`;
      console.error('[messenger] Booking button failed:', errorMsg, data);
      return { ok: false, provider: 'messenger', recipientId, error: errorMsg };
    }

    return { ok: true, provider: 'messenger', recipientId, messageId: data?.message_id };
  } catch (err: any) {
    return { ok: false, provider: 'messenger', recipientId, error: err?.message ?? 'Network error' };
  }
}

/**
 * Fetch a Messenger user's profile name (first_name, last_name).
 */
export async function getMessengerProfile(psid: string): Promise<{ firstName?: string; lastName?: string } | null> {
  const config = getMessengerConfig();
  if (!config) return null;

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/${psid}?fields=first_name,last_name`,
      {
        headers: { 'Authorization': `Bearer ${config.pageAccessToken}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    return { firstName: data.first_name, lastName: data.last_name };
  } catch {
    return null;
  }
}

/**
 * Verify the X-Hub-Signature-256 header from a Messenger webhook request.
 */
export function verifyMessengerSignature(
  rawBody: string | Buffer,
  signature: string,
  appSecret: string,
): boolean {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

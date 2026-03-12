/**
 * Apple Push Notification service (APNs) HTTP/2 client.
 * Sends push notifications to iOS App Clip users via APNs.
 * Uses JWT (ES256) authentication with a p8 key from Apple Developer Console.
 */

import { SignJWT, importPKCS8 } from 'jose';
import { createClient } from '@supabase/supabase-js';

// APNs endpoints
const APNS_HOST_PRODUCTION = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com';

// JWT token cache (valid for ~55 minutes, APNs allows up to 1 hour)
let cachedToken: { jwt: string; expiresAt: number } | null = null;

/**
 * Generate a JWT for APNs authentication.
 * Tokens are cached for 55 minutes (APNs allows up to 1 hour).
 */
async function getAPNsJWT(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Return cached token if still valid (with 5 min buffer)
  if (cachedToken && cachedToken.expiresAt > now + 300) {
    return cachedToken.jwt;
  }

  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const keyP8 = process.env.APNS_KEY_P8;

  if (!keyId || !teamId || !keyP8) {
    throw new Error('APNs credentials not configured (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8)');
  }

  // Parse p8 key (handle escaped newlines from env vars)
  const pemKey = keyP8.replace(/\\n/g, '\n');
  const privateKey = await importPKCS8(pemKey, 'ES256');

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .sign(privateKey);

  // Cache for 55 minutes
  cachedToken = { jwt, expiresAt: now + 55 * 60 };
  return jwt;
}

interface APNsPayload {
  title: string;
  body: string;
  sound?: string;
  url?: string;
}

/**
 * Send a push notification to a single APNs device token.
 * Returns true on success, false on failure.
 * Throws on configuration errors.
 */
async function sendAPNsNotification(
  deviceToken: string,
  payload: APNsPayload,
  environment: string = 'production'
): Promise<{ success: boolean; status?: number; reason?: string }> {
  const bundleId = process.env.APNS_BUNDLE_ID || 'com.queueflow.app.QueueFlowClip';
  const host = environment === 'sandbox' ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  const url = `${host}/3/device/${deviceToken}`;

  const jwt = await getAPNsJWT();

  const apnsPayload = {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      sound: payload.sound || 'default',
      'interruption-level': 'time-sensitive' as const,
      'mutable-content': 1,
    },
    // Custom data for the App Clip to handle
    url: payload.url,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10', // Immediate delivery
        'apns-expiration': '0', // Deliver immediately or not at all
        'content-type': 'application/json',
      },
      body: JSON.stringify(apnsPayload),
    });

    if (response.status === 200) {
      return { success: true, status: 200 };
    }

    // Parse error response
    const errorBody = await response.json().catch(() => ({}));
    const reason = (errorBody as { reason?: string })?.reason || 'unknown';
    console.error(`[APNs] Failed: ${response.status} ${reason} for token ${deviceToken.slice(0, 12)}...`);
    return { success: false, status: response.status, reason };
  } catch (err) {
    console.error('[APNs] Network error:', err);
    return { success: false, reason: 'network_error' };
  }
}

/**
 * Send APNs push notification to all registered tokens for a ticket.
 * Handles cleanup of expired/invalid tokens.
 * Returns true if at least one notification was sent successfully.
 */
export async function sendAPNsToTicket(
  ticketId: string,
  payload: APNsPayload
): Promise<boolean> {
  // Check if APNs is configured
  if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID || !process.env.APNS_KEY_P8) {
    // APNs not configured — silently skip (web push still works)
    return false;
  }

  console.log('[APNs] Sending notification for ticket:', ticketId);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: tokens, error } = await supabase
    .from('apns_tokens')
    .select('id, device_token, environment')
    .eq('ticket_id', ticketId);

  if (error) {
    console.error('[APNs] Failed to fetch tokens:', error);
    return false;
  }

  if (!tokens || tokens.length === 0) {
    console.log('[APNs] No APNs tokens for ticket:', ticketId);
    return false;
  }

  console.log('[APNs] Found', tokens.length, 'token(s)');
  let anySent = false;

  for (const token of tokens) {
    const result = await sendAPNsNotification(
      token.device_token,
      payload,
      token.environment
    );

    if (result.success) {
      anySent = true;
    } else if (result.status === 410 || result.reason === 'Unregistered' || result.reason === 'BadDeviceToken') {
      // Token is invalid/expired — clean up
      console.log('[APNs] Removing invalid token:', token.id);
      await supabase.from('apns_tokens').delete().eq('id', token.id);
    }
  }

  return anySent;
}

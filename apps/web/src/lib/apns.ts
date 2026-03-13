/**
 * Apple Push Notification service (APNs) HTTP/2 client.
 * Sends push notifications to iOS App Clip users via APNs.
 * Uses JWT (ES256) authentication with a p8 key from Apple Developer Console.
 */

import { connect } from 'node:http2';
import { SignJWT, importPKCS8 } from 'jose';
import { createClient } from '@supabase/supabase-js';

// APNs endpoints
const APNS_HOST_PRODUCTION = 'https://api.push.apple.com';
const APNS_HOST_SANDBOX = 'https://api.sandbox.push.apple.com';
const DEFAULT_APNS_BUNDLE_ID =
  process.env.APNS_BUNDLE_ID?.trim() || 'com.queueflow.app.QueueFlowClip';

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

  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyP8 = process.env.APNS_KEY_P8?.trim();

  if (!keyId || !teamId || !keyP8) {
    throw new Error('APNs credentials not configured (APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_P8)');
  }

  // Parse p8 key (handle escaped newlines from env vars)
  const pemKey = keyP8.replace(/\\n/g, '\n').trim();
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

type APNsEnvironment = 'production' | 'sandbox';

interface APNsTarget {
  environment: APNsEnvironment;
  bundleId: string;
}

function buildInvocationURL(urlPath?: string): string | undefined {
  if (!urlPath) return undefined;

  if (/^https?:\/\//i.test(urlPath)) {
    return urlPath;
  }

  const baseURL = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflow-sigma.vercel.app'
  ).replace(/\/+$/, '');

  const normalizedPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  return `${baseURL}${normalizedPath}`;
}

/**
 * Send a push notification to a single APNs device token.
 * Returns true on success, false on failure.
 * Throws on configuration errors.
 */
async function sendAPNsNotification(
  deviceToken: string,
  payload: APNsPayload,
  target: APNsTarget
): Promise<{ success: boolean; status?: number; reason?: string }> {
  const host = target.environment === 'sandbox' ? APNS_HOST_SANDBOX : APNS_HOST_PRODUCTION;
  const url = `${host}/3/device/${deviceToken}`;
  const invocationURL = buildInvocationURL(payload.url);

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
      ...(invocationURL ? { 'target-content-id': invocationURL } : {}),
    },
    // Custom data for the App Clip to handle
    url: invocationURL,
  };

  return await new Promise((resolve) => {
    const client = connect(host);
    let settled = false;
    let statusCode: number | undefined;
    let responseBody = '';

    const finish = (result: { success: boolean; status?: number; reason?: string }) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(result);
    };

    client.on('error', (err) => {
      console.error('[APNs] HTTP/2 session error:', err);
      finish({ success: false, reason: 'network_error' });
    });

    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': target.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10', // Immediate delivery
      'apns-expiration': '0', // Deliver immediately or not at all
      'content-type': 'application/json',
    });

    request.setEncoding('utf8');

    request.on('response', (headers) => {
      const rawStatus = headers[':status'];
      statusCode = typeof rawStatus === 'number' ? rawStatus : Number(rawStatus);
    });

    request.on('data', (chunk) => {
      responseBody += chunk;
    });

    request.on('end', () => {
      if (statusCode === 200) {
        finish({ success: true, status: 200 });
        return;
      }

      let reason = 'unknown';
      if (responseBody) {
        try {
          reason = JSON.parse(responseBody).reason || reason;
        } catch {
          reason = responseBody;
        }
      }

      console.error(
        `[APNs] Failed: ${statusCode ?? 'unknown'} ${reason} for token ${deviceToken.slice(0, 12)}...` +
        ` env=${target.environment} topic=${target.bundleId}`
      );
      finish({ success: false, status: statusCode, reason });
    });

    request.on('error', (err) => {
      console.error('[APNs] Network error:', err);
      finish({ success: false, reason: 'network_error' });
    });

    request.setTimeout(10_000, () => {
      console.error('[APNs] Request timed out');
      request.close();
      finish({ success: false, reason: 'timeout' });
    });

    request.end(JSON.stringify(apnsPayload));
  });
}

function parseAPNsTarget(rawTarget?: string | null): APNsTarget {
  if (!rawTarget) {
    return {
      environment: 'production',
      bundleId: DEFAULT_APNS_BUNDLE_ID,
    };
  }

  const [environmentPart, bundleIdPart] = rawTarget.split('|', 2);
  const environment: APNsEnvironment =
    environmentPart === 'sandbox' ? 'sandbox' : 'production';
  const bundleId = bundleIdPart?.trim() || DEFAULT_APNS_BUNDLE_ID;

  return { environment, bundleId };
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

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey
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
    const target = parseAPNsTarget(token.environment);
    const result = await sendAPNsNotification(
      token.device_token,
      payload,
      target
    );

    if (result.success) {
      anySent = true;
    } else if (result.status === 410 || result.reason === 'Unregistered') {
      // Token is invalid/expired — clean up
      console.log('[APNs] Removing invalid token:', token.id);
      await supabase.from('apns_tokens').delete().eq('id', token.id);
    } else if (result.reason === 'BadDeviceToken' || result.reason === 'DeviceTokenNotForTopic') {
      console.warn(
        `[APNs] Preserving token ${token.id} after ${result.reason};` +
        ` verify Xcode bundle id and APNs topic match (${target.bundleId})`
      );
    }
  }

  return anySent;
}

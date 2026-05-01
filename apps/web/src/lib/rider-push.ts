import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendApnsAlertToToken } from '@/lib/apns';
import { getGoogleFcmAccessToken, getFcmProjectId } from '@/lib/android-push';

/**
 * Rider-side push delivery. The native rider screen registers its
 * APNs/FCM device token via /api/rider/register-push when it opens
 * the deeplink — we stash that on the ticket. This helper reads it
 * back and pushes the rider directly, no Web Push / VAPID involved
 * (those are scoped to the customer browser subscription).
 *
 * Use cases (already-running rider gets paged with phone locked):
 *   - operator unassigns the rider
 *   - customer cancels the order
 *   - operator updates the drop-off address mid-run
 *   - operator marks the order as cancelled
 *
 * On 410 Unregistered (iOS) or UNREGISTERED (FCM) we clear the
 * stored token so we stop hammering a dead device.
 */

interface RiderPushPayload {
  title: string;
  body: string;
  /** Deep link path or absolute URL — opened when the rider taps. */
  url?: string;
  /** Free-form data merged into the FCM data payload. */
  data?: Record<string, string>;
}

async function sendFcmToRider(deviceToken: string, payload: RiderPushPayload): Promise<{ success: boolean; gone: boolean }> {
  const projectId = getFcmProjectId();
  if (!projectId) return { success: false, gone: false };

  let accessToken: string;
  try { accessToken = await getGoogleFcmAccessToken(); }
  catch (e: any) {
    console.warn('[rider-push] FCM token fetch failed', e?.message);
    return { success: false, gone: false };
  }

  const r = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title: payload.title, body: payload.body },
          data: {
            ...(payload.data ?? {}),
            ...(payload.url ? { url: payload.url } : {}),
            kind: 'rider',
          },
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: 'queue-alerts',
              sound: 'default',
              notification_priority: 'PRIORITY_MAX',
              visibility: 'PUBLIC',
            },
          },
        },
      }),
      cache: 'no-store',
    },
  );

  if (r.ok) return { success: true, gone: false };
  const data = await r.json().catch(() => ({}));
  const code = (data?.error?.details ?? []).map((d: any) => d?.errorCode).find(Boolean) ?? '';
  const status = (data?.error?.status ?? '') as string;
  const gone = code === 'UNREGISTERED' || status === 'NOT_FOUND' || r.status === 404;
  return { success: false, gone };
}

export async function sendRiderPush(ticketId: string, payload: RiderPushPayload): Promise<boolean> {
  const supabase = createAdminClient() as any;
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, rider_push_token, rider_push_platform')
    .eq('id', ticketId)
    .maybeSingle();
  const token: string | null = ticket?.rider_push_token ?? null;
  const platform: string | null = ticket?.rider_push_platform ?? null;
  if (!token) return false;

  let result: { success: boolean; gone: boolean };
  if (platform === 'ios') {
    const r = await sendApnsAlertToToken({
      deviceToken: token,
      title: payload.title,
      body: payload.body,
      url: payload.url,
    });
    result = {
      success: r.success,
      gone: r.status === 410 || r.reason === 'Unregistered' || r.reason === 'BadDeviceToken',
    };
  } else if (platform === 'android') {
    result = await sendFcmToRider(token, payload);
  } else {
    return false;
  }

  if (result.gone) {
    // Stop hammering a dead token — let the rider re-register next time
    // they open the screen.
    await supabase
      .from('tickets')
      .update({ rider_push_token: null, rider_push_platform: null })
      .eq('id', ticketId);
  }
  return result.success;
}

export async function clearRiderPushToken(ticketId: string): Promise<void> {
  const supabase = createAdminClient() as any;
  await supabase
    .from('tickets')
    .update({ rider_push_token: null, rider_push_platform: null })
    .eq('id', ticketId);
}

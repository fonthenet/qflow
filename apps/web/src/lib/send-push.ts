import webpush from 'web-push';
import { createClient } from '@/lib/supabase/server';

// Configure web-push with VAPID keys (lazy for Vercel serverless compatibility)
let vapidReady = false;
function initVapid() {
  if (vapidReady) return true;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails('mailto:noreply@queueflow.app', pub, priv);
    vapidReady = true;
    return true;
  }
  return false;
}

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Send Web Push notification to all subscriptions for a ticket.
 * Called from server actions (runs on Node.js).
 * Returns true if at least one notification was sent successfully.
 */
export async function sendPushToTicket(ticketId: string, payload: PushPayload): Promise<boolean> {
  console.log('[SendPush] Sending push for ticket:', ticketId, payload);

  if (!initVapid()) {
    console.warn('[SendPush] VAPID keys not configured, skipping push');
    return false;
  }

  const supabase = await createClient();

  // Retry fetching subscriptions (race condition: subscription may still be saving)
  let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: subs, error: fetchErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('ticket_id', ticketId);

    if (fetchErr) {
      console.error('[SendPush] Failed to fetch subscriptions:', fetchErr);
      return false;
    }

    if (subs && subs.length > 0) {
      subscriptions = subs;
      break;
    }

    if (attempt === 0) {
      console.log('[SendPush] No subscriptions yet, retrying in 1s...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (subscriptions.length === 0) {
    console.warn('[SendPush] No subscriptions found for ticket:', ticketId);
    return false;
  }

  console.log('[SendPush] Found', subscriptions.length, 'subscription(s)');

  const message = JSON.stringify(payload);
  let anySent = false;

  for (const sub of subscriptions) {
    const endpoint = sub.endpoint.slice(0, 60) + '...';
    let sent = false;

    // Try up to 2 times (initial + 1 retry for transient failures)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) console.log('[SendPush] Retry', attempt, 'for', endpoint);
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message
        );
        console.log('[SendPush] Successfully sent to', endpoint);
        sent = true;
        anySent = true;
        break;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        console.error('[SendPush] Failed to send:', statusCode, err);

        // 404 or 410 = subscription expired/invalid, clean it up (no retry)
        if (statusCode === 404 || statusCode === 410) {
          console.log('[SendPush] Removing expired subscription:', sub.id);
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
          break;
        }

        // 429 (rate limited) or 5xx = transient, retry after delay
        if (attempt === 0 && (statusCode === 429 || !statusCode || (statusCode >= 500))) {
          console.log('[SendPush] Transient error, retrying in 1s...');
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        // Other errors (400, 401, 403) = don't retry
        break;
      }
    }

    if (!sent) {
      console.warn('[SendPush] Could not deliver to', endpoint);
    }
  }

  return anySent;
}

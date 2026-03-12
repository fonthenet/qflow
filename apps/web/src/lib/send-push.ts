import webpush from 'web-push';
import { createClient } from '@/lib/supabase/server';

// Lazy VAPID init — env vars not available at module load on Vercel serverless
let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (pub && priv) {
    webpush.setVapidDetails('mailto:noreply@queueflow.app', pub.replace(/=+$/, ''), priv.replace(/=+$/, ''));
    vapidConfigured = true;
  }
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
 */
export async function sendPushToTicket(ticketId: string, payload: PushPayload): Promise<void> {
  console.log('[SendPush] Sending push for ticket:', ticketId, payload);

  ensureVapid();
  if (!vapidConfigured) {
    console.warn('[SendPush] VAPID keys not configured, skipping push');
    return;
  }

  const supabase = await createClient();
  const { data: subscriptions, error: fetchErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('ticket_id', ticketId);

  if (fetchErr) {
    console.error('[SendPush] Failed to fetch subscriptions:', fetchErr);
    return;
  }

  if (!subscriptions || subscriptions.length === 0) {
    console.warn('[SendPush] No subscriptions found for ticket:', ticketId);
    return;
  }

  console.log('[SendPush] Found', subscriptions.length, 'subscription(s)');

  const message = JSON.stringify(payload);

  for (const sub of subscriptions) {
    try {
      console.log('[SendPush] Sending to endpoint:', sub.endpoint.slice(0, 60) + '...');
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        message
      );
      console.log('[SendPush] Successfully sent to', sub.endpoint.slice(0, 60) + '...');
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      console.error('[SendPush] Failed to send:', statusCode, err);
      // 404 or 410 = subscription expired/invalid, clean it up
      if (statusCode === 404 || statusCode === 410) {
        console.log('[SendPush] Removing expired subscription:', sub.id);
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      }
    }
  }
}

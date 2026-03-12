import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/push-send
 * Called by Supabase pg_net trigger when a ticket is called.
 * Self-contained: configures VAPID, fetches subscriptions, sends push.
 * Does NOT use sendPushToTicket (which needs cookie-based supabase client).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticketId, title, message, tag, url } = body;

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    console.log('[PushSend] Sending push for ticket:', ticketId);

    // Configure VAPID
    const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublic || !vapidPrivate) {
      return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
    }
    webpush.setVapidDetails('mailto:noreply@queueflow.app', vapidPublic, vapidPrivate);

    // Use direct supabase client (no cookies needed)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Check if subscription exists — if not, wait and retry (race condition fix)
    let subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('ticket_id', ticketId);

      if (subs && subs.length > 0) {
        subscriptions = subs;
        break;
      }

      if (attempt < 2) {
        console.log(`[PushSend] No subscription found, retry ${attempt + 1}/3 in 2s...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (subscriptions.length === 0) {
      console.log('[PushSend] No subscription after 3 attempts, giving up');
      return NextResponse.json({ ok: false, reason: 'no_subscription' });
    }

    console.log('[PushSend] Found', subscriptions.length, 'subscription(s)');

    const payload = JSON.stringify({
      title: title || "It's Your Turn!",
      body: message || 'Please proceed to the desk',
      tag: tag || `called-${ticketId}`,
      url: url,
    });

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload
        );
        console.log('[PushSend] Sent to', sub.endpoint.slice(0, 60) + '...');
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        console.error('[PushSend] Failed:', statusCode, err);
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PushSend] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

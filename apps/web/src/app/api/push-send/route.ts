import { NextRequest, NextResponse } from 'next/server';
import { sendPushToTicket } from '@/lib/send-push';
import { createClient } from '@supabase/supabase-js';

const PUSH_SECRET = process.env.PUSH_WEBHOOK_SECRET || 'qflow-push-internal';

/**
 * POST /api/push-send
 * Called by Supabase pg_net trigger when a ticket is called.
 * Includes retry logic: if no subscription found, waits and retries
 * (handles race condition where subscription is created after the call).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticketId, title, message, tag, url, secret, retry } = body;

    // Basic auth check
    if (secret !== PUSH_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    console.log('[PushSend] Sending push for ticket:', ticketId, 'retry:', retry ?? 0);

    // Check if subscription exists
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('ticket_id', ticketId);

    if (!subs || subs.length === 0) {
      const retryCount = retry ?? 0;
      if (retryCount < 3) {
        // No subscription yet — wait 2s and retry (handles race condition)
        console.log('[PushSend] No subscription found, waiting 2s for retry', retryCount + 1);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Re-check
        const { data: subs2 } = await supabase
          .from('push_subscriptions')
          .select('id')
          .eq('ticket_id', ticketId);

        if (!subs2 || subs2.length === 0) {
          console.log('[PushSend] Still no subscription after retry, giving up');
          return NextResponse.json({ ok: false, reason: 'no_subscription' });
        }
      } else {
        return NextResponse.json({ ok: false, reason: 'no_subscription_after_retries' });
      }
    }

    await sendPushToTicket(ticketId, {
      title: title || "It's Your Turn!",
      body: message || 'Please proceed to the desk',
      tag: tag || `called-${ticketId}`,
      url: url,
    });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PushSend] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

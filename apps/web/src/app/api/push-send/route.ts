import { NextRequest, NextResponse } from 'next/server';
import { sendPushToTicket } from '@/lib/send-push';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/push-send
 * Called by Supabase pg_net trigger when a ticket is called.
 * Includes retry logic: if no subscription found, waits and retries
 * (handles race condition where subscription is created after the call).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticketId, title, message, tag, url } = body;

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    console.log('[PushSend] Sending push for ticket:', ticketId);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Check if subscription exists — if not, wait and retry (race condition fix)
    let hasSubs = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('id')
        .eq('ticket_id', ticketId);

      if (subs && subs.length > 0) {
        hasSubs = true;
        break;
      }

      if (attempt < 2) {
        console.log(`[PushSend] No subscription found, retry ${attempt + 1}/3 in 2s...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    if (!hasSubs) {
      console.log('[PushSend] No subscription after 3 attempts, giving up');
      return NextResponse.json({ ok: false, reason: 'no_subscription' });
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

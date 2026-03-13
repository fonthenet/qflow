import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendPositionUpdatePush } from '@/lib/send-push';

export async function POST(request: NextRequest) {
  try {
    const { ticketId, subscription } = await request.json();

    if (!ticketId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = await createClient();

    // Delete old subscriptions for this ticket (endpoints change on every fresh subscribe)
    await supabase.from('push_subscriptions').delete().eq('ticket_id', ticketId);

    // Insert fresh subscription
    const { error } = await supabase
      .from('push_subscriptions')
      .insert({
        ticket_id: ticketId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });

    if (error) {
      console.error('Failed to save push subscription:', error);
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
    }

    // Send initial position notification immediately — gives "ongoing notification" feel
    sendPositionUpdatePush(ticketId).catch((err) =>
      console.error('[PushSubscribe] Initial position push error:', err)
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Push subscribe error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

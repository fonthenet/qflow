import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPositionUpdatePush } from '@/lib/send-push';

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const { ticketId, subscription } = await request.json();

    if (!ticketId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseUrl = getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey =
      getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

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
      return NextResponse.json({ error: error.message || 'Failed to save subscription' }, { status: 500 });
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

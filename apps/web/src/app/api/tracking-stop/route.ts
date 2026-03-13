import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushToTicket } from '@/lib/send-push';
import { endLiveActivityForTicket } from '@/lib/apns';
import { sendAndroidToTicket } from '@/lib/android-push';

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

function createServiceSupabaseClient() {
  const supabaseUrl =
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL') ||
    getTrimmedEnv('SUPABASE_URL');
  const supabaseKey =
    getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function POST(request: NextRequest) {
  try {
    const { ticketId } = await request.json();

    if (!ticketId || typeof ticketId !== 'string') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const supabase = createServiceSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase credentials not configured' }, { status: 500 });
    }

    await Promise.allSettled([
      sendPushToTicket(ticketId, {
        type: 'stop_tracking',
        title: 'Tracking stopped',
        body: 'QueueFlow tracking stopped for this visit.',
        ticketId,
        silent: true,
      }),
      sendAndroidToTicket(ticketId, {
        type: 'stop_tracking',
        title: 'Tracking stopped',
        body: 'QueueFlow tracking stopped for this visit.',
        ticketId,
        silent: true,
      }),
      endLiveActivityForTicket(ticketId),
    ]);

    await Promise.all([
      supabase.from('push_subscriptions').delete().eq('ticket_id', ticketId),
      supabase.from('apns_tokens').delete().eq('ticket_id', ticketId),
      supabase.from('android_tokens').delete().eq('ticket_id', ticketId),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TrackingStop] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

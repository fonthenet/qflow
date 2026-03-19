import { NextRequest, NextResponse } from 'next/server';
import { TICKET_EVENT_TYPES } from '@queueflow/shared';
import { createClient } from '@supabase/supabase-js';
import { sendPushToTicket } from '@/lib/send-push';
import { endLiveActivityForTicket } from '@/lib/apns';
import { notifyWaitingAndroidTickets, sendAndroidToTicket } from '@/lib/android-push';
import { notifyWaitingTickets } from '@/lib/send-push';

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

    const { data: existingTicket, error: ticketError } = await supabase
      .from('tickets')
      .select('id, status, office_id, department_id')
      .eq('id', ticketId)
      .single();

    if (ticketError || !existingTicket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const activeStatuses = new Set(['issued', 'waiting', 'called', 'serving']);
    const shouldLeaveQueue = activeStatuses.has(existingTicket.status);

    if (shouldLeaveQueue) {
      const { error: updateError } = await supabase
        .from('tickets')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      if (updateError) {
        console.error('[TrackingStop] Failed to cancel ticket:', updateError.message);
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      const { error: eventError } = await supabase.from('ticket_events').insert({
        ticket_id: ticketId,
        event_type: TICKET_EVENT_TYPES.CANCELLED,
        from_status: existingTicket.status,
        to_status: 'cancelled',
        metadata: {
          source: 'customer_leave_queue',
        },
      });

      if (eventError) {
        console.error('[TrackingStop] Failed to log cancellation event:', eventError.message);
      }
    }

    await Promise.allSettled([
      sendPushToTicket(ticketId, {
        type: 'stop_tracking',
        title: shouldLeaveQueue ? 'Queue cancelled' : 'Tracking stopped',
        body: shouldLeaveQueue
          ? 'This ticket has left the queue.'
          : 'Qflo tracking stopped for this visit.',
        ticketId,
        silent: true,
      }),
      sendAndroidToTicket(ticketId, {
        type: 'stop_tracking',
        title: shouldLeaveQueue ? 'Queue cancelled' : 'Tracking stopped',
        body: shouldLeaveQueue
          ? 'This ticket has left the queue.'
          : 'Qflo tracking stopped for this visit.',
        ticketId,
        silent: true,
      }),
      endLiveActivityForTicket(ticketId),
    ]);

    if (shouldLeaveQueue) {
      await Promise.allSettled([
        notifyWaitingTickets(existingTicket.department_id, existingTicket.office_id, ticketId),
        notifyWaitingAndroidTickets(existingTicket.department_id, existingTicket.office_id, ticketId),
      ]);
    }

    const [pushDelete, apnsDelete] = await Promise.all([
      supabase.from('push_subscriptions').delete().eq('ticket_id', ticketId),
      supabase.from('apns_tokens').delete().eq('ticket_id', ticketId),
    ]);

    // android_tokens table may not exist yet — delete only if available
    let androidDeleteError: { message: string } | null = null;
    try {
      const { error } = await supabase.from('android_tokens').delete().eq('ticket_id', ticketId);
      androidDeleteError = error;
    } catch {
      // Table doesn't exist yet, safe to ignore.
    }

    const deleteErrors = [
      pushDelete.error,
      apnsDelete.error,
    ].filter(Boolean);

    if (deleteErrors.length > 0) {
      const message = deleteErrors.map((item) => item?.message).join(' | ');
      console.error('[TrackingStop] Delete error:', message);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if (androidDeleteError) {
      console.warn('[TrackingStop] Android tokens cleanup skipped:', androidDeleteError.message);
    }

    return NextResponse.json({
      ok: true,
      leftQueue: shouldLeaveQueue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TrackingStop] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

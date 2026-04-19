import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAndroidTicketState, hasAndroidPushCredentials } from '@/lib/android-push';

function getTrimmedEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const { ticketId, appointmentId, qrToken, deviceToken, packageName } = await request.json();

    if ((!ticketId && !qrToken && !appointmentId) || !deviceToken) {
      return NextResponse.json(
        { error: 'ticketId, appointmentId, or qrToken and deviceToken are required' },
        { status: 400 }
      );
    }

    const supabaseUrl = getTrimmedEnv('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey =
      getTrimmedEnv('SUPABASE_SERVICE_ROLE_KEY') ||
      getTrimmedEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase credentials not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let resolvedTicketId = ticketId as string | undefined;
    const resolvedAppointmentId = appointmentId as string | undefined;

    if (!resolvedAppointmentId && !resolvedTicketId && qrToken) {
      const { data: ticket, error } = await supabase
        .from('tickets')
        .select('id')
        .eq('qr_token', qrToken)
        .single();

      if (error || !ticket) {
        return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
      }

      resolvedTicketId = ticket.id;
    }

    if (!resolvedTicketId && !resolvedAppointmentId) {
      return NextResponse.json({ error: 'Ticket or appointment not found' }, { status: 404 });
    }

    await supabase
      .from('android_tokens')
      .delete()
      .eq('device_token', deviceToken);

    const upsertRow: Record<string, unknown> = {
      device_token: deviceToken,
      package_name: typeof packageName === 'string' ? packageName : null,
      last_seen_at: new Date().toISOString(),
    };
    if (resolvedAppointmentId) {
      upsertRow.appointment_id = resolvedAppointmentId;
    } else {
      upsertRow.ticket_id = resolvedTicketId;
    }

    const { error: insertError } = await supabase
      .from('android_tokens')
      .upsert(upsertRow, {
        onConflict: resolvedAppointmentId
          ? 'appointment_id,device_token'
          : 'ticket_id,device_token',
      });

    if (insertError) {
      console.error('[Android Register] Insert failed:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const snapshot = resolvedTicketId ? await getAndroidTicketState(resolvedTicketId) : null;

    return NextResponse.json({
      ok: true,
      ticketId: resolvedTicketId ?? null,
      appointmentId: resolvedAppointmentId ?? null,
      androidPushConfigured: hasAndroidPushCredentials(),
      snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Android Register] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { tNotification } from '@/lib/whatsapp-commands';

/**
 * POST /api/whatsapp-send
 *
 * Sends a WhatsApp notification for a ticket event.
 * Called from server actions (which may run locally on QFlo Station)
 * to ensure the message is sent from Vercel where the Meta API token lives.
 */
export async function POST(request: NextRequest) {
  try {
    // Auth: accept service role key OR internal database trigger
    const authHeader = request.headers.get('authorization') ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const isServiceKey = serviceKey && authHeader.includes(serviceKey.substring(0, 20));
    const isInternalTrigger = authHeader === 'Bearer internal-trigger';
    if (!isServiceKey && !isInternalTrigger) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { ticketId, event, deskName } = body as {
      ticketId: string;
      event: 'called' | 'recall' | 'buzz' | 'no_show' | 'served' | 'cancelled';
      deskName: string;
    };

    if (!ticketId || !event) {
      return NextResponse.json({ error: 'Missing ticketId or event' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Look up ticket
    const { data: ticket } = await supabase
      .from('tickets')
      .select('id, ticket_number, qr_token, status')
      .eq('id', ticketId)
      .single();

    if (!ticket) {
      return NextResponse.json({ sent: false, reason: 'ticket not found' });
    }

    // Look up active WhatsApp session for this ticket (include locale)
    const { data: session } = await (supabase as any)
      .from('whatsapp_sessions')
      .select('id, whatsapp_phone, organization_id, locale')
      .eq('ticket_id', ticketId)
      .eq('state', 'active')
      .maybeSingle();

    if (!session?.whatsapp_phone) {
      return NextResponse.json({ sent: false, reason: 'no active whatsapp session' });
    }

    // Session locale — default to 'fr' for Algeria
    const locale = (session.locale as 'fr' | 'ar' | 'en') || 'fr';

    // Build tracking URL
    const baseUrl = (
      process.env.APP_CLIP_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://qflo.net'
    ).replace(/\/+$/, '');
    const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

    // Build localized message
    let message: string;
    let completeSession = false;
    const vars = { ticket: ticket.ticket_number, desk: deskName, url: trackUrl };

    switch (event) {
      case 'called':
        message = tNotification('called', locale, vars);
        break;
      case 'recall':
        message = tNotification('recall', locale, vars);
        break;
      case 'buzz':
        message = tNotification('buzz', locale, vars);
        break;
      case 'no_show':
        message = tNotification('no_show', locale, vars);
        completeSession = true;
        break;
      case 'served':
        message = tNotification('served', locale, vars);
        completeSession = true;
        break;
      case 'cancelled':
        message = tNotification('cancelled_notify', locale, vars);
        completeSession = true;
        break;
      default:
        message = tNotification('default', locale, vars);
    }

    console.log(`[whatsapp-send] Sending ${event} (${locale}) to ${session.whatsapp_phone} for ${ticket.ticket_number}`);

    const result = await sendWhatsAppMessage({
      to: session.whatsapp_phone,
      body: message,
    });

    console.log(`[whatsapp-send] Result:`, JSON.stringify(result));

    if (result.ok) {
      // Log notification
      try {
        await supabase.from('notifications').insert({
          ticket_id: ticketId,
          type: `whatsapp_${event}` as any,
          channel: 'whatsapp' as any,
          payload: { to: result.to, sid: result.sid, provider: result.provider, locale },
          sent_at: new Date().toISOString(),
        });
      } catch { /* non-critical */ }

      // Complete session for terminal events
      if (completeSession) {
        await (supabase as any)
          .from('whatsapp_sessions')
          .update({ state: 'completed' })
          .eq('id', session.id);
      }
    }

    return NextResponse.json({ sent: result.ok, provider: result.provider, error: result.error });
  } catch (err: any) {
    console.error('[whatsapp-send] Error:', err?.message ?? err);
    return NextResponse.json({ sent: false, error: err?.message }, { status: 500 });
  }
}

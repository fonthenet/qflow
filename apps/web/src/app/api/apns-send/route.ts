import { NextRequest, NextResponse } from 'next/server';
import { sendAPNsToTicket } from '@/lib/apns';

/**
 * POST /api/apns-send
 * Sends an APNs push notification to all registered tokens for a ticket.
 * Can be called by pg_net trigger or manually for testing.
 */
export async function POST(request: NextRequest) {
  try {
    const { ticketId, title, body, url } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    const success = await sendAPNsToTicket(ticketId, {
      title: title || "It's Your Turn!",
      body: body || 'Please proceed to the desk',
      url,
    });

    return NextResponse.json({ ok: true, sent: success });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[APNs Send] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

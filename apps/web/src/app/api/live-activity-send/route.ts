import { NextRequest, NextResponse } from 'next/server';
import { sendLiveActivityUpdateForTicket } from '@/lib/apns';

/**
 * POST /api/live-activity-send
 * Sends a Live Activity update using the ticket's current server-side state.
 */
export async function POST(request: NextRequest) {
  try {
    const { ticketId } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    const sent = await sendLiveActivityUpdateForTicket(ticketId);
    return NextResponse.json({ ok: true, sent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Live Activity Send] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

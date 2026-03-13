import { NextRequest, NextResponse } from 'next/server';
import { sendAndroidLiveUpdateForTicket } from '@/lib/android-push';

export async function POST(request: NextRequest) {
  try {
    const { ticketId } = await request.json();

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
    }

    const sent = await sendAndroidLiveUpdateForTicket(ticketId);
    return NextResponse.json({ ok: true, sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Android Send] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

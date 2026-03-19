import { NextRequest, NextResponse } from 'next/server';
import { sendPushToTicket } from '@/lib/send-push';

export async function GET(request: NextRequest) {
  const ticketId = request.nextUrl.searchParams.get('ticketId');
  if (!ticketId) {
    return NextResponse.json({ error: 'ticketId required' }, { status: 400 });
  }

  try {
    // Check env vars
    const hasPub = !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const hasPriv = !!process.env.VAPID_PRIVATE_KEY;
    const hasUrl = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
    const hasKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    console.log('[PushTest] ENV check:', { hasPub, hasPriv, hasUrl, hasKey });

    await sendPushToTicket(ticketId, {
      title: 'Test Push',
      body: 'This is a test notification from Qflo',
      tag: 'test',
    });

    return NextResponse.json({
      ok: true,
      env: { hasPub, hasPriv, hasUrl, hasKey },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PushTest] Error:', msg);
    return NextResponse.json({ error: msg, }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function encodeAPNsTarget(environment: unknown, bundleId: unknown): string {
  const normalizedEnvironment = environment === 'sandbox' ? 'sandbox' : 'production';
  const normalizedBundleId =
    typeof bundleId === 'string' && bundleId.trim().length > 0
      ? bundleId.trim()
      : '';

  return normalizedBundleId
    ? `${normalizedEnvironment}|${normalizedBundleId}`
    : normalizedEnvironment;
}

/**
 * POST /api/apns-register
 * Registers an APNs device token for a ticket.
 * Called by the iOS App Clip after it gets a push token.
 * No auth required — App Clip users are anonymous.
 */
export async function POST(request: NextRequest) {
  try {
    const { ticketId, deviceToken, environment, bundleId } = await request.json();

    if (!ticketId || !deviceToken) {
      return NextResponse.json(
        { error: 'ticketId and deviceToken are required' },
        { status: 400 }
      );
    }

    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      supabaseKey
    );

    // Delete old tokens for this ticket (fresh token on each launch)
    await supabase
      .from('apns_tokens')
      .delete()
      .eq('ticket_id', ticketId);

    // Insert new token
    const { error } = await supabase
      .from('apns_tokens')
      .insert({
        ticket_id: ticketId,
        device_token: deviceToken,
        environment: encodeAPNsTarget(environment, bundleId),
      });

    if (error) {
      console.error('[APNs Register] Insert failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[APNs Register] Token saved for ticket:', ticketId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[APNs Register] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

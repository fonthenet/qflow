import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderToken } from '@/lib/rider-token';

/**
 * POST /api/rider/heartbeat
 *
 * Rider portal streams browser geolocation updates here. Each request
 * is one row in `rider_locations`; the customer's tracking page listens
 * via Supabase Realtime and updates the live map pin.
 *
 * Auth: rider portal token (stateless HMAC), passed in the body. We
 * deliberately don't accept a Bearer header — this endpoint is open to
 * the public domain (rider's phone, no Qflo session) so the only thing
 * gating it is knowledge of the token. Same threat model as a kiosk
 * screen token.
 *
 * Rate-limited at the edge (publicLimiter), idempotent (every row is a
 * new datapoint — duplicates are harmless), and short-circuits when
 * the ticket has already been delivered so the rider's idle phone
 * can't accidentally keep streaming after the job is done.
 *
 * Body: { ticketId, token, lat, lng, accuracy?, heading?, speed? }
 */

import { checkRateLimit, publicLimiter } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, publicLimiter);
  if (blocked) return blocked;

  let body: {
    ticketId?: string;
    token?: string;
    lat?: number;
    lng?: number;
    accuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const { ticketId, token, lat, lng, accuracy, heading, speed } = body;
  if (!ticketId || !token) {
    return NextResponse.json({ ok: false, error: 'ticketId and token required' }, { status: 400 });
  }
  if (!verifyRiderToken(ticketId, token)) {
    return NextResponse.json({ ok: false, error: 'Invalid rider token' }, { status: 401 });
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ ok: false, error: 'lat/lng required' }, { status: 400 });
  }
  // Sanity bounds — refuse absurd values that would be a buggy client
  // rather than a real reading.
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json({ ok: false, error: 'lat/lng out of range' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Stop accepting heartbeats once the order is delivered or cancelled.
  // The rider's portal page also auto-stops watchPosition when it sees
  // the terminal state via realtime, but this is the server-side guard
  // for stuck/idle clients.
  const { data: tk } = await supabase
    .from('tickets')
    .select('id, status, delivered_at')
    .eq('id', ticketId)
    .maybeSingle();
  if (!tk) {
    return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
  }
  if (tk.delivered_at || tk.status === 'served' || tk.status === 'cancelled') {
    return NextResponse.json({ ok: true, stopped: true });
  }

  const { error: insErr } = await supabase
    .from('rider_locations')
    .insert({
      ticket_id: ticketId,
      lat,
      lng,
      accuracy_m: typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null,
      heading_deg: typeof heading === 'number' && Number.isFinite(heading) ? heading : null,
      speed_mps: typeof speed === 'number' && Number.isFinite(speed) ? speed : null,
    } as any);
  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

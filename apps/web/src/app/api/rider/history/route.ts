import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyRiderSession } from '@/lib/rider-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/rider/history?cursor=<iso>&limit=<n>
 *
 * Paginated list of completed deliveries for the calling rider.
 * "Completed" = delivered_at IS NOT NULL OR status IN ('served',
 * 'cancelled', 'no_show'). Cancelled/no-show runs are surfaced too
 * because the rider's history should include "didn't deliver because
 * customer cancelled" — they did the work of getting there.
 *
 * Cursor is the ISO timestamp of the last item's `completed_at`
 * (or delivered_at fallback). New page = items strictly older than
 * that cursor. limit caps at 50.
 *
 * Aggregates: today_count + total_count (best-effort, not paginated).
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  const session = await verifyRiderSession(request.headers.get('authorization'));
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIMIT));

  const supabase = createAdminClient() as any;
  let query = supabase
    .from('tickets')
    .select(`
      id, ticket_number, status,
      dispatched_at, arrived_at, delivered_at,
      completed_at, created_at,
      delivery_address, customer_data, notes,
      offices ( name )
    `)
    .eq('assigned_rider_id', session.riderId)
    .or('delivered_at.not.is.null,status.in.(served,cancelled,no_show)')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(limit + 1); // peek one extra to know if there's another page

  if (cursor) {
    // Older than the cursor — uses completed_at as the keyed column.
    query = query.lt('completed_at', cursor);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && page.length > 0
    ? (page[page.length - 1].completed_at ?? page[page.length - 1].delivered_at ?? null)
    : null;

  // Aggregates — small queries, fine to run inline.
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [{ count: todayCount }, { count: totalCount }] = await Promise.all([
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_rider_id', session.riderId)
      .not('delivered_at', 'is', null)
      .gte('delivered_at', startOfToday.toISOString()),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_rider_id', session.riderId)
      .not('delivered_at', 'is', null),
  ]);

  const items = page.map((t: any) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    status: t.status,
    dispatched_at: t.dispatched_at,
    delivered_at: t.delivered_at,
    completed_at: t.completed_at,
    delivery_address: t.delivery_address,
    customer_data: t.customer_data,
    pickup_name: t.offices?.name ?? null,
  }));

  return NextResponse.json({
    ok: true,
    items,
    next_cursor: nextCursor,
    today_count: todayCount ?? 0,
    total_count: totalCount ?? 0,
  });
}

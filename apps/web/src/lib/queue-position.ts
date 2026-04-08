/**
 * CANONICAL QUEUE POSITION CALCULATION
 * =====================================
 * Single source of truth for queue position across the entire app.
 *
 * Rules:
 *   1. Position is OFFICE-scoped (same office, all services) — matches the
 *      operator-facing waiting list in the Station so customer-facing and
 *      operator-facing counts always agree.
 *   2. Only 'waiting' tickets count (parked tickets excluded)
 *   3. Ordering: priority DESC (higher number = served first), then created_at ASC (FIFO)
 *   4. Position is 1-based (1 = next to be called)
 *   5. Estimated wait = (position - 1) * avg service time
 *   6. Now serving = most recently called/serving ticket in the office
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

export interface QueuePositionResult {
  position: number | null;
  total_waiting: number;
  estimated_wait_minutes: number | null;
  now_serving: string | null;
}

export async function getQueuePosition(ticketId: string): Promise<QueuePositionResult> {
  // 1. Get the ticket
  const supabase = getSupabase();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('id, status, office_id, service_id, priority, created_at, parked_at')
    .eq('id', ticketId)
    .single();

  if (error || !ticket) {
    return { position: null, total_waiting: 0, estimated_wait_minutes: null, now_serving: null };
  }

  // Called/serving tickets are at position 0 (your turn)
  if (ticket.status === 'called' || ticket.status === 'serving') {
    // Get now_serving for context
    const { data: nowServing } = await supabase
      .from('tickets')
      .select('ticket_number')
      .eq('office_id', ticket.office_id)
      .in('status', ['serving', 'called'])
      .order('called_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    return { position: 0, total_waiting: 0, estimated_wait_minutes: 0, now_serving: nowServing?.ticket_number ?? null };
  }

  // Completed tickets have no position
  if (ticket.status !== 'waiting') {
    return { position: null, total_waiting: 0, estimated_wait_minutes: null, now_serving: null };
  }

  const ticketPriority = ticket.priority ?? 0;

  // 2. Count tickets AHEAD: same office + same service
  //    Higher priority, OR same priority + earlier created_at
  const [higherPriorityResult, samePriorityEarlierResult, totalResult, nowServingResult] =
    await Promise.all([
      // Tickets with strictly higher priority
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', ticket.office_id)
        .eq('service_id', ticket.service_id)
        .eq('status', 'waiting')
        .is('parked_at', null)
        .neq('id', ticketId)
        .gt('priority', ticketPriority),

      // Tickets with same priority but created earlier (FIFO)
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', ticket.office_id)
        .eq('service_id', ticket.service_id)
        .eq('status', 'waiting')
        .is('parked_at', null)
        .neq('id', ticketId)
        .eq('priority', ticketPriority)
        .lt('created_at', ticket.created_at),

      // Total waiting for this service (excluding parked)
      supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', ticket.office_id)
        .eq('service_id', ticket.service_id)
        .eq('status', 'waiting')
        .is('parked_at', null),

      // Currently serving/called ticket for same service
      supabase
        .from('tickets')
        .select('ticket_number')
        .eq('office_id', ticket.office_id)
        .eq('service_id', ticket.service_id)
        .in('status', ['serving', 'called'])
        .order('called_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const position = 1 + (higherPriorityResult.count ?? 0) + (samePriorityEarlierResult.count ?? 0);
  const totalWaiting = totalResult.count ?? 0;

  // 3. Estimate wait time from recent service history (same service)
  const { data: recentServed } = await supabase
    .from('tickets')
    .select('completed_at, serving_started_at')
    .eq('office_id', ticket.office_id)
    .eq('service_id', ticket.service_id)
    .eq('status', 'served')
    .not('completed_at', 'is', null)
    .not('serving_started_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(20);

  let avgServiceTime = 5; // default 5 min per ticket
  if (recentServed && recentServed.length > 0) {
    const totalMinutes = recentServed.reduce((sum, t) => {
      const start = new Date(t.serving_started_at).getTime();
      const end = new Date(t.completed_at).getTime();
      return sum + (end - start) / 60000;
    }, 0);
    const avg = totalMinutes / recentServed.length;
    if (avg > 0) avgServiceTime = avg;
  }

  const estimatedWait = Math.ceil((position - 1) * avgServiceTime);

  return {
    position,
    total_waiting: totalWaiting,
    estimated_wait_minutes: estimatedWait,
    now_serving: nowServingResult.data?.ticket_number ?? null,
  };
}

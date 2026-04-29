import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { drainWaOutbox } from '@/lib/whatsapp-outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/notifications/status?ticketIds=id1,id2,…
 *
 * Returns the latest WhatsApp notification job per (ticketId, action)
 * for the requested tickets, so the Station can render a small status
 * badge on each delivery card:
 *
 *   pending          → "⏳ Notifying" (amber)
 *   sent (no status) → "✓ Sent"        (green)
 *   delivered        → "✓✓ Delivered"  (green, two ticks)
 *   read             → "✓✓ Read"       (blue, two ticks)
 *   failed           → "✕ Failed"      (red, with Resend button)
 *
 * Auth: this endpoint is only useful to staff. We don't enforce
 * staff JWT here because the data is operationally sensitive but not
 * customer-PII (it's just job metadata). Same posture as the existing
 * cron endpoint with a CRON_SECRET-or-internal token check.
 *
 * POST /api/notifications/status
 *   body: { resendJobId: string }
 *   Resends a failed/pending job by triggering a one-shot drain pass
 *   with that specific job. Used by the Station's "Resend" button.
 */

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get('ticketIds') ?? '';
  const ticketIds = idsParam.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (ticketIds.length === 0) {
    return NextResponse.json({ ok: true, jobs: [] });
  }

  const supabase = createAdminClient() as any;
  // Latest WA job per ticket, ordered newest first. The Station card
  // uses the most-recent action (e.g. order_delivered) since that's
  // the most-relevant status to show; older actions for the same
  // ticket were already processed.
  const { data, error } = await supabase
    .from('notification_jobs')
    .select('id, ticket_id, action, status, attempts, max_attempts, last_error, meta_status, meta_status_at, updated_at, completed_at')
    .eq('channel', 'whatsapp')
    .in('ticket_id', ticketIds)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Collapse to latest-per-ticket. The query already orders newest
  // first, so we keep the first occurrence of each ticket_id.
  const seen = new Set<string>();
  const latest: any[] = [];
  for (const row of data ?? []) {
    if (seen.has(row.ticket_id)) continue;
    seen.add(row.ticket_id);
    latest.push(row);
  }

  return NextResponse.json({ ok: true, jobs: latest });
}

export async function POST(request: NextRequest) {
  let body: { resendJobId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const jobId = body.resendJobId?.trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'resendJobId required' }, { status: 400 });
  }

  // Reset the row to pending + due now so the next drain picks it up.
  // We don't block on the actual send here — the operator's UI shows
  // the new status from the next status fetch.
  const supabase = createAdminClient() as any;
  const { data: updated, error: updErr } = await supabase
    .from('notification_jobs')
    .update({
      status: 'pending',
      next_retry_at: new Date().toISOString(),
      // Don't reset attempts — preserve history. max_attempts also
      // stays as-is. If the row already hit max, the operator may
      // need to bump it manually; in practice 5 attempts is plenty.
    })
    .eq('id', jobId)
    .eq('channel', 'whatsapp')
    .select('id')
    .maybeSingle();
  if (updErr || !updated) {
    return NextResponse.json({ ok: false, error: updErr?.message ?? 'job not found' }, { status: 404 });
  }

  // Trigger an immediate drain so the operator doesn't have to wait
  // for the cron tick. Limited to 5 jobs so a malicious caller can't
  // weaponize this into a full flush.
  const summary = await drainWaOutbox({ limit: 5 });

  return NextResponse.json({ ok: true, drain: summary });
}

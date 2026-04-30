import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage, type WhatsAppSendResult } from '@/lib/whatsapp';

/**
 * WhatsApp notification outbox — durable, retried, audited.
 *
 * Why this exists:
 *   Order-lifecycle WhatsApp messages (Out for delivery, At your door,
 *   Delivered + receipt, etc.) sometimes failed silently. Causes:
 *   transient Meta 5xx, network timeouts in the Vercel function,
 *   recipient phone temporarily offline, or our own code throwing
 *   between mutation and send.
 *
 *   Every fix-and-forget call to sendWhatsAppMessage was a single
 *   point of failure. If the send threw or returned !ok, we logged a
 *   warning and moved on — the customer never got the ping.
 *
 *   This module routes EVERY customer-facing WA message through a
 *   durable outbox row in `notification_jobs` (channel='whatsapp').
 *   Reliability primitives:
 *
 *   1. Best-effort inline send. The handler still tries to send right
 *      away so successful cases stay fast (no cron lag).
 *   2. On failure, the row stays `pending` and the cron worker (every
 *      60 s) retries with exponential backoff (1m, 5m, 15m, 30m, 60m).
 *      Up to 5 attempts before the row is marked `failed`.
 *   3. Idempotency_key = `{ticket_id}:{action}:whatsapp` — duplicate
 *      enqueues from webhook replays / fast operator clicks no-op.
 *   4. meta_message_id is recorded on success and correlated with
 *      Meta's delivery-status webhook (sent → delivered → read OR
 *      failed). Operator sees the actual delivery state per ticket,
 *      not just "we tried".
 *
 * Caller doesn't await the send — enqueueWaJob always returns
 * quickly. Callers can pass `await` if they want to fail the request
 * on enqueue failure (rare; only happens if the DB is down).
 */

export type WaAction =
  | 'order_pending'        // pending_approval — operator should accept/decline
  | 'order_accepted'       // approval_approved — kitchen prep starts
  | 'order_declined'       // approval_declined
  | 'order_dispatched'     // 🛵 out for delivery (rider portal link sent)
  | 'order_arrived'        // 🚪 driver at the door
  | 'order_delivered'      // ✅ receipt + thanks
  | 'order_cancelled'      // operator cancel
  | 'order_ready'          // takeout ready for pickup
  | 'order_other';         // generic / fallback

export interface EnqueueWaJobInput {
  ticketId: string;
  action: WaAction;
  toPhone: string;
  body: string;
  /** Optional metadata stored on the job row for later inspection. */
  payload?: Record<string, any>;
  /** Override the default 5-attempt cap if needed (e.g. a less-critical
   *  notification might cap at 3). */
  maxAttempts?: number;
  /** Override the default idempotency key (`ticketId:action:whatsapp`).
   *  Required when the same (ticket, action, channel) tuple can fire
   *  legitimately more than once with different content — e.g. rider
   *  assign/unassign cycles, where each rider gets their own message.
   *  Pass something deterministic per intended message (e.g. include
   *  rider id, attempt number, or a kind label) so reassignments don't
   *  collide with the previous rider's notification row. */
  idempotencyKey?: string;
}

export interface EnqueueWaJobResult {
  /** Did the inline send succeed? When true the customer already has
   *  the message and the job is marked `sent`. When false the job is
   *  `pending` and the cron will retry. */
  delivered: boolean;
  /** The job row id, useful for tracing in logs. */
  jobId: string | null;
  /** Set when delivered=true; the wamid Meta returns. */
  metaMessageId?: string | null;
  /** Set when delivered=false; surfaces the most recent error to logs. */
  lastError?: string | null;
}

/**
 * Backoff schedule in minutes. Index = attempt count just made (1 for
 * first failure, 2 for second, etc.). Last entry repeats for any
 * further attempts up to max_attempts.
 *
 *   attempt 1 fails → wait 1 min, try again
 *   attempt 2 fails → wait 5 min
 *   attempt 3 fails → wait 15 min
 *   attempt 4 fails → wait 30 min
 *   attempt 5 fails → max reached, mark `failed`
 */
const BACKOFF_MINUTES = [1, 5, 15, 30, 60];

function nextRetryAt(attempts: number): string {
  const idx = Math.min(Math.max(0, attempts - 1), BACKOFF_MINUTES.length - 1);
  const mins = BACKOFF_MINUTES[idx];
  return new Date(Date.now() + mins * 60 * 1000).toISOString();
}

/**
 * Enqueue a WhatsApp lifecycle notification.
 *
 *   - Inserts a row into notification_jobs with idempotency on
 *     (ticket_id, action, channel='whatsapp'). Duplicate inserts no-op.
 *   - Tries an inline send. On success the row is updated to
 *     status='sent' with meta_message_id captured.
 *   - On failure, the row stays pending and the cron worker will
 *     retry on the schedule above.
 */
export async function enqueueWaJob(input: EnqueueWaJobInput): Promise<EnqueueWaJobResult> {
  const supabase = createAdminClient() as any;
  const { ticketId, action, toPhone, body, payload, maxAttempts = 5 } = input;

  // Default idempotency: one row per (ticket, action). Callers that
  // legitimately need multiple sends (e.g. rider reassignment cycles)
  // pass an explicit key including a discriminator like rider id.
  const idempotencyKey = input.idempotencyKey ?? `${ticketId}:${action}:whatsapp`;

  // Insert (or no-op on conflict) the outbox row. We start in
  // 'pending' status; the inline send below will flip it to 'sent'
  // on success.
  const { data: insertRows, error: insertErr } = await supabase
    .from('notification_jobs')
    .upsert(
      {
        ticket_id: ticketId,
        action,
        channel: 'whatsapp',
        status: 'pending',
        to_phone: toPhone,
        body_text: body,
        payload: payload ?? {},
        attempts: 0,
        max_attempts: maxAttempts,
        idempotency_key: idempotencyKey,
        next_retry_at: new Date().toISOString(),
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();

  // ON CONFLICT DO NOTHING returns null data. Look up the existing job.
  let jobId: string | null = insertRows?.id ?? null;
  if (!jobId) {
    const { data: existing } = await supabase
      .from('notification_jobs')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    jobId = existing?.id ?? null;
    // If the existing job is already 'sent' or 'failed', don't re-send.
    if (existing && (existing.status === 'sent' || existing.status === 'skipped')) {
      return { delivered: true, jobId, metaMessageId: null };
    }
    if (existing?.status === 'failed') {
      return { delivered: false, jobId, lastError: 'previously_failed' };
    }
  }

  if (insertErr) {
    console.warn('[wa-outbox] insert failed', insertErr.message);
    // We still attempt the send so the customer isn't penalised by
    // a DB blip. They'll just lose the retry safety net for THIS
    // notification.
  }

  // Inline best-effort send.
  const result = await tryWaSend(toPhone, body);
  if (result.ok) {
    if (jobId) {
      await supabase
        .from('notification_jobs')
        .update({
          status: 'sent',
          meta_message_id: result.sid ?? null,
          completed_at: new Date().toISOString(),
          attempts: 1,
        })
        .eq('id', jobId);
    }
    return { delivered: true, jobId, metaMessageId: result.sid ?? null };
  }

  // Inline send failed. Row stays pending; the cron picks it up.
  if (jobId) {
    await supabase
      .from('notification_jobs')
      .update({
        attempts: 1,
        last_error: result.error ?? 'unknown',
        next_retry_at: nextRetryAt(1),
      })
      .eq('id', jobId);
  }
  return { delivered: false, jobId, lastError: result.error ?? null };
}

/**
 * Single send attempt with a defensive try/catch. Used by both the
 * enqueue path (inline best-effort) and the cron worker (retry).
 */
async function tryWaSend(to: string, body: string): Promise<WhatsAppSendResult> {
  try {
    return await sendWhatsAppMessage({ to, body });
  } catch (e: any) {
    return { ok: false, provider: 'none', error: e?.message ?? 'unknown' };
  }
}

/**
 * Drain the outbox. Picks up to `limit` pending whatsapp jobs whose
 * next_retry_at has passed, attempts each, updates the row.
 *
 * Called by the Vercel cron (`/api/cron/wa-outbox`) every minute. Also
 * exposed for manual replay from a Station "Resend" button.
 *
 * Returns a summary so the cron route can include it in the response
 * body for log inspection.
 */
export async function drainWaOutbox(opts: { limit?: number } = {}): Promise<{
  picked: number;
  sent: number;
  retried: number;
  failed: number;
}> {
  const supabase = createAdminClient() as any;
  const limit = opts.limit ?? 50;

  // Atomically claim a batch of jobs by flipping them to 'processing'
  // so concurrent cron invocations don't double-send. Postgres'
  // SELECT … FOR UPDATE SKIP LOCKED would be cleaner but the JS
  // client doesn't expose it; using an UPDATE … RETURNING with a
  // sub-select is equivalent for our concurrency profile.
  const claimAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from('notification_jobs')
    .update({ status: 'processing' })
    .eq('channel', 'whatsapp')
    .eq('status', 'pending')
    .lte('next_retry_at', claimAt)
    .select('id, ticket_id, action, to_phone, body_text, attempts, max_attempts')
    .limit(limit);

  if (claimErr) {
    console.warn('[wa-outbox] claim failed', claimErr.message);
    return { picked: 0, sent: 0, retried: 0, failed: 0 };
  }
  const jobs = claimed ?? [];
  if (jobs.length === 0) {
    return { picked: 0, sent: 0, retried: 0, failed: 0 };
  }

  let sent = 0, retried = 0, failed = 0;
  for (const job of jobs as Array<{
    id: string;
    ticket_id: string;
    action: string;
    to_phone: string | null;
    body_text: string | null;
    attempts: number;
    max_attempts: number;
  }>) {
    if (!job.to_phone || !job.body_text) {
      // Malformed job — mark skipped so we don't loop forever.
      await supabase
        .from('notification_jobs')
        .update({
          status: 'skipped',
          completed_at: new Date().toISOString(),
          last_error: 'missing to_phone or body_text',
        })
        .eq('id', job.id);
      failed++;
      continue;
    }
    const result = await tryWaSend(job.to_phone, job.body_text);
    const newAttempts = job.attempts + 1;
    if (result.ok) {
      await supabase
        .from('notification_jobs')
        .update({
          status: 'sent',
          meta_message_id: result.sid ?? null,
          completed_at: new Date().toISOString(),
          attempts: newAttempts,
          last_error: null,
        })
        .eq('id', job.id);
      sent++;
      continue;
    }
    if (newAttempts >= job.max_attempts) {
      await supabase
        .from('notification_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          attempts: newAttempts,
          last_error: result.error ?? 'unknown',
        })
        .eq('id', job.id);
      failed++;
      // Audit on the ticket so operators can see the failure.
      await supabase.from('ticket_events').insert({
        ticket_id: job.ticket_id,
        event_type: 'customer_notify_failed',
        metadata: { channel: 'whatsapp', action: job.action, error: result.error ?? null, source: 'wa-outbox' },
      }).then(() => {}, () => {});
      continue;
    }
    await supabase
      .from('notification_jobs')
      .update({
        status: 'pending',
        attempts: newAttempts,
        last_error: result.error ?? 'unknown',
        next_retry_at: nextRetryAt(newAttempts),
      })
      .eq('id', job.id);
    retried++;
  }

  return { picked: jobs.length, sent, retried, failed };
}

/**
 * Update a job's Meta delivery status from the webhook callback.
 * Called from the WhatsApp webhook handler when Meta posts the
 * `statuses` array.
 *
 * Meta's status enum:
 *   - 'sent'      — left Meta's edge servers
 *   - 'delivered' — landed on the recipient's device
 *   - 'read'      — recipient opened the chat
 *   - 'failed'    — Meta couldn't deliver (recipient blocked / not on WA)
 */
export async function updateJobMetaStatus(
  metaMessageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  error?: string | null,
): Promise<void> {
  const supabase = createAdminClient() as any;
  const patch: Record<string, any> = {
    meta_status: status,
    meta_status_at: new Date().toISOString(),
  };
  if (status === 'failed') {
    patch.last_error = error ?? 'meta_status_failed';
    // Don't override status='sent' even when meta_status='failed' —
    // we already shipped the message; Meta's "failed" callback
    // happens after-the-fact. The audit trail still surfaces it.
  }
  await supabase
    .from('notification_jobs')
    .update(patch)
    .eq('meta_message_id', metaMessageId);
}

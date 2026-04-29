import { NextRequest, NextResponse } from 'next/server';
import { drainWaOutbox } from '@/lib/whatsapp-outbox';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * WhatsApp outbox drain — Vercel cron, every minute.
 *
 * Picks up any pending whatsapp jobs whose next_retry_at has passed,
 * attempts the Meta send, updates the row:
 *   - success     → status='sent', meta_message_id captured
 *   - retry-able  → attempts++, next_retry_at += backoff (1m, 5m, 15m, 30m, 60m)
 *   - max reached → status='failed', last_error stored, ticket_event audit row
 *
 * Why a cron and not a more elegant queue (Inngest / BullMQ / etc.):
 *   - Vercel cron is included with the existing plan, no extra infra
 *   - 60-second cadence is tight enough for "out for delivery" /
 *     "delivered" notifications; the customer's phone won't notice
 *     a 60s difference between operator click and ping arrival
 *   - The notification_jobs table is the source of truth either way,
 *     so swapping in a fancier scheduler later is one file change
 *
 * Auth: Bearer CRON_SECRET. Vercel sets this header automatically
 * when invoking the cron; manual triggers from a Station "Resend"
 * button can use the same header.
 *
 * Configured in apps/web/vercel.json with schedule "* * * * *".
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Cap each invocation at a moderate batch so a backlog doesn't
  // exhaust the function's 10s execution budget on Vercel hobby/pro.
  // 50 jobs × ~200ms median per Meta send = ~10s worst case.
  const summary = await drainWaOutbox({ limit: 50 });

  return NextResponse.json({
    ok: true,
    at: new Date().toISOString(),
    ...summary,
  });
}

// Allow POST too — Vercel sometimes prefers POST for cron, and this
// makes the manual-resend flow easier (operators can call the same
// endpoint from the Station UI without method gymnastics).
export const POST = GET;

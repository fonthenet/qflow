import { NextRequest, NextResponse } from 'next/server';
import { lineAdapter } from '@/lib/channels/line';
import { dedupChannelEvent, markChannelEventProcessed } from '@/lib/channels/dedup';
import { checkRateLimit, webhookLimiter } from '@/lib/rate-limit';

/**
 * LINE Messaging API webhook.
 *
 * LINE sends a GET verification challenge on first registration
 * (responds with 200 and empty body — LINE re-confirms via dashboard ping).
 *
 * POST: HMAC-SHA256 via X-Line-Signature. Dedup via channel_webhook_events.
 * Always returns 200 — LINE retries on non-2xx.
 */
export async function GET(_request: NextRequest) {
  // LINE does not use a query-string challenge like Meta.
  // The channel must respond 200 to all GET requests.
  return new NextResponse('OK', { status: 200 });
}

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, webhookLimiter);
  if (blocked) return blocked;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-line-signature') ?? '';

    if (!signature) {
      console.warn('[line-webhook] Missing X-Line-Signature');
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
    }

    const valid = await lineAdapter.verifyWebhook(rawBody, signature, {});
    if (!valid) {
      console.warn('[line-webhook] Invalid signature — rejecting');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const incoming = lineAdapter.parseIncoming(rawBody);
    if (!incoming) {
      // Non-message event (follow, join, postback, read receipt, etc.)
      return NextResponse.json({ ok: true });
    }

    // ── Dedup ──────────────────────────────────────────────────────────────
    const dedup = await dedupChannelEvent('line', incoming.messageId, incoming.rawPayload);
    if (dedup === 'duplicate') {
      console.log(`[line-webhook] Duplicate messageId=${incoming.messageId} — skipping`);
      return NextResponse.json({ ok: true });
    }

    // ── Route to booking/queue logic (channel-agnostic) ────────────────────
    // TODO: call shared handleChannelMessage(incoming, 'line') once available.
    // For now log and acknowledge — stub until adapter is wired into booking flow.
    console.log(
      `[line-webhook] Incoming from=${incoming.from} text="${incoming.text.substring(0, 40)}"`,
    );

    await markChannelEventProcessed('line', incoming.messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[line-webhook] Error:', err);
    // Always 200 — LINE retries on non-2xx
    return NextResponse.json({ ok: true });
  }
}

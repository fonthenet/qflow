import { NextRequest, NextResponse } from 'next/server';
import { zaloAdapter } from '@/lib/channels/zalo';
import { dedupChannelEvent, markChannelEventProcessed } from '@/lib/channels/dedup';
import { checkRateLimit, webhookLimiter } from '@/lib/rate-limit';

/**
 * Zalo Official Account webhook.
 *
 * Zalo sends a GET verification challenge on first OA webhook registration.
 * POST: HMAC-SHA256 via X-ZEvent-Signature. Dedup via channel_webhook_events.
 * Always returns 200 — Zalo retries on non-2xx.
 */
export async function GET(request: NextRequest) {
  // Zalo verification: echoes back the hub.challenge (same pattern as Meta)
  const url = new URL(request.url);
  const challenge = url.searchParams.get('hub.challenge');
  if (challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('OK', { status: 200 });
}

export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, webhookLimiter);
  if (blocked) return blocked;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-zevent-signature') ?? '';

    if (!signature) {
      console.warn('[zalo-webhook] Missing X-ZEvent-Signature');
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
    }

    const valid = await zaloAdapter.verifyWebhook(rawBody, signature, {});
    if (!valid) {
      console.warn('[zalo-webhook] Invalid signature — rejecting');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const incoming = zaloAdapter.parseIncoming(rawBody);
    if (!incoming) {
      // Non-text event (reaction, image, location, etc.)
      return NextResponse.json({ ok: true });
    }

    // ── Dedup ──────────────────────────────────────────────────────────────
    const dedup = await dedupChannelEvent('zalo', incoming.messageId, incoming.rawPayload);
    if (dedup === 'duplicate') {
      console.log(`[zalo-webhook] Duplicate messageId=${incoming.messageId} — skipping`);
      return NextResponse.json({ ok: true });
    }

    // ── Route to booking/queue logic (channel-agnostic) ────────────────────
    // TODO: call shared handleChannelMessage(incoming, 'zalo') once available.
    console.log(
      `[zalo-webhook] Incoming from=${incoming.from} text="${incoming.text.substring(0, 40)}"`,
    );

    await markChannelEventProcessed('zalo', incoming.messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[zalo-webhook] Error:', err);
    return NextResponse.json({ ok: true });
  }
}

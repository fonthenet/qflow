import { NextRequest, NextResponse } from 'next/server';
import { kakaoAdapter } from '@/lib/channels/kakao';
import { dedupChannelEvent, markChannelEventProcessed } from '@/lib/channels/dedup';
import { checkRateLimit, webhookLimiter } from '@/lib/rate-limit';

/**
 * KakaoTalk Biz Message / Open Builder webhook.
 *
 * Kakao sends a POST for every user utterance or button action.
 * Signature: X-Kakao-Signature (HMAC-SHA256 hex of rawBody with KAKAO_ADMIN_KEY).
 * Always returns 200 — Kakao expects an immediate 200 with a response body for
 * Open Builder skill webhooks. For Biz Message, non-2xx triggers a retry.
 */
export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, webhookLimiter);
  if (blocked) return blocked;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-kakao-signature') ?? '';

    if (!signature) {
      console.warn('[kakao-webhook] Missing X-Kakao-Signature');
      return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
    }

    const valid = await kakaoAdapter.verifyWebhook(rawBody, signature, {});
    if (!valid) {
      console.warn('[kakao-webhook] Invalid signature — rejecting');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const incoming = kakaoAdapter.parseIncoming(rawBody);
    if (!incoming) {
      // Status event, postback, or unrecognised shape
      return NextResponse.json({ ok: true });
    }

    // ── Dedup ──────────────────────────────────────────────────────────────
    const dedup = await dedupChannelEvent('kakao', incoming.messageId, incoming.rawPayload);
    if (dedup === 'duplicate') {
      console.log(`[kakao-webhook] Duplicate messageId=${incoming.messageId} — skipping`);
      return NextResponse.json({ ok: true });
    }

    // ── Route to booking/queue logic (channel-agnostic) ────────────────────
    // TODO: call shared handleChannelMessage(incoming, 'kakao') once available.
    console.log(
      `[kakao-webhook] Incoming from=${incoming.from} text="${incoming.text.substring(0, 40)}"`,
    );

    await markChannelEventProcessed('kakao', incoming.messageId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[kakao-webhook] Error:', err);
    return NextResponse.json({ ok: true });
  }
}

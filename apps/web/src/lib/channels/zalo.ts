import 'server-only';
import crypto from 'crypto';
import { ChannelAdapter, ChannelIncomingMessage, ChannelSendResult } from './types';

// ── Zalo Official Account API (Vietnam) ─────────────────────────────────────
// Docs: https://developers.zalo.me/docs/official-account/
//
// STUB: sendMessage is scaffolded — production calls require a live
// ZALO_OA_ID and ZALO_OA_SECRET_KEY, plus an approved Zalo Official Account.
// Signature: HMAC-SHA256(rawBody, ZALO_OA_SECRET_KEY), hex in X-ZEvent-Signature.

function getTrimmedEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

const GREETINGS: Record<string, string> = {
  vi: 'Xin chào',
  en: 'Hello',
  fr: 'Salut',
  ar: 'مرحبا',
};

class ZaloAdapter implements ChannelAdapter {
  readonly channel = 'zalo';
  readonly defaultLocale = 'vi';

  async sendMessage(
    to: string,
    content: string,
    locale: string,
    _orgId?: string,
  ): Promise<ChannelSendResult> {
    const oaId = getTrimmedEnv('ZALO_OA_ID');
    const secretKey = getTrimmedEnv('ZALO_OA_SECRET_KEY');

    if (!oaId || !secretKey) {
      return {
        ok: false,
        channel: this.channel,
        error: 'ZALO_OA_ID or ZALO_OA_SECRET_KEY not set — stub mode',
      };
    }

    // STUB: Zalo OA message API.
    // Production endpoint: POST https://openapi.zalo.me/v2.0/oa/message
    // Headers: access_token (OAuth2 from ZALO_OA_SECRET_KEY exchange)
    // Body: { recipient: { user_id: to }, message: { text: content } }
    console.log(`[zalo] STUB sendMessage to=${to} locale=${locale} len=${content.length}`);
    return {
      ok: false,
      channel: this.channel,
      to,
      error: 'Zalo sendMessage is a stub — activate with live OA credentials',
    };
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
    _headers: Record<string, string>,
  ): Promise<boolean> {
    const secretKey = getTrimmedEnv('ZALO_OA_SECRET_KEY');
    if (!secretKey) {
      console.error('[zalo] ZALO_OA_SECRET_KEY not set — rejecting all webhooks');
      return false;
    }

    // Zalo uses HMAC-SHA256; header is X-ZEvent-Signature (hex, no prefix)
    const expected = crypto
      .createHmac('sha256', secretKey)
      .update(rawBody, 'utf-8')
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;

    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  parseIncoming(rawBody: string): ChannelIncomingMessage | null {
    let json: any;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }

    // Zalo OA webhook shape:
    // { event_name, timestamp, sender: { id }, recipient: { id }, message: { msg_id, text } }
    const eventName = json?.event_name as string | undefined;
    if (!eventName?.startsWith('user_send_text')) return null;

    const msgId = json?.message?.msg_id as string | undefined;
    const senderId = json?.sender?.id as string | undefined;
    const text = json?.message?.text as string | undefined;

    if (!msgId || !senderId) return null;

    return {
      messageId: `zalo:${msgId}`,
      from: senderId,
      text: text ?? '',
      rawPayload: json,
    };
  }

  getGreeting(locale: string): string {
    return GREETINGS[locale] ?? GREETINGS['vi'];
  }
}

export const zaloAdapter: ChannelAdapter = new ZaloAdapter();

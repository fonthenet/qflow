import 'server-only';
import crypto from 'crypto';
import { ChannelAdapter, ChannelIncomingMessage, ChannelSendResult } from './types';

// ── LINE Messaging API (Japan / Thailand / Taiwan) ──────────────────────────
// Docs: https://developers.line.biz/en/reference/messaging-api/
//
// STUB: sendMessage is scaffolded — production calls require a live
// LINE_CHANNEL_ACCESS_TOKEN and the Messaging API channel to be activated.
// verifyWebhook and parseIncoming are production-ready.

function getTrimmedEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

const GREETINGS: Record<string, string> = {
  ja: 'こんにちは',
  th: 'สวัสดี',
  zh: '你好',
  en: 'Hello',
  fr: 'Salut',
  ar: 'مرحبا',
};

class LineAdapter implements ChannelAdapter {
  readonly channel = 'line';
  readonly defaultLocale = 'ja';

  async sendMessage(
    to: string,
    content: string,
    locale: string,
    _orgId?: string,
  ): Promise<ChannelSendResult> {
    const accessToken = getTrimmedEnv('LINE_CHANNEL_ACCESS_TOKEN');
    if (!accessToken) {
      return {
        ok: false,
        channel: this.channel,
        error: 'LINE_CHANNEL_ACCESS_TOKEN not set — stub mode',
      };
    }

    // STUB: replace with real LINE reply/push message API call once credentials active.
    // LINE push message endpoint: POST https://api.line.me/v2/bot/message/push
    // Payload: { to: userId, messages: [{ type: 'text', text: content }] }
    console.log(`[line] STUB sendMessage to=${to} locale=${locale} len=${content.length}`);
    return {
      ok: false,
      channel: this.channel,
      to,
      error: 'LINE sendMessage is a stub — activate with live credentials',
    };
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
    _headers: Record<string, string>,
  ): Promise<boolean> {
    const secret = getTrimmedEnv('LINE_CHANNEL_SECRET');
    if (!secret) {
      console.error('[line] LINE_CHANNEL_SECRET not set — rejecting all webhooks');
      return false;
    }

    // LINE uses HMAC-SHA256; header is X-Line-Signature (base64, no prefix)
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf-8')
      .digest('base64');

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

    const event = json?.events?.[0];
    if (!event) return null;

    // Only handle text messages; skip join/leave/postback/follow events
    if (event.type !== 'message' || event.message?.type !== 'text') {
      return null;
    }

    const messageId = event.message?.id as string | undefined;
    const from = event.source?.userId as string | undefined;
    const text = event.message?.text as string | undefined;

    if (!messageId || !from) return null;

    return {
      messageId: `line:${messageId}`,
      from,
      text: text ?? '',
      rawPayload: json,
    };
  }

  getGreeting(locale: string): string {
    return GREETINGS[locale] ?? GREETINGS['ja'];
  }
}

export const lineAdapter: ChannelAdapter = new LineAdapter();

import 'server-only';
import crypto from 'crypto';
import { ChannelAdapter, ChannelIncomingMessage, ChannelSendResult } from './types';

// ── KakaoTalk Biz Message API (South Korea) ─────────────────────────────────
// Docs: https://kakaobusiness.gitbook.io/main/bizmessage/kakao-channel
//
// STUB: sendMessage is scaffolded — production calls require a live
// KAKAO_REST_API_KEY, KAKAO_ADMIN_KEY, and an approved KakaoTalk Channel.
// Signature verification is HMAC-SHA256 over the raw body using KAKAO_ADMIN_KEY.

function getTrimmedEnv(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

const GREETINGS: Record<string, string> = {
  ko: '안녕하세요',
  en: 'Hello',
  fr: 'Salut',
  ar: 'مرحبا',
};

class KakaoAdapter implements ChannelAdapter {
  readonly channel = 'kakao';
  readonly defaultLocale = 'ko';

  async sendMessage(
    to: string,
    content: string,
    locale: string,
    _orgId?: string,
  ): Promise<ChannelSendResult> {
    const restApiKey = getTrimmedEnv('KAKAO_REST_API_KEY');
    if (!restApiKey) {
      return {
        ok: false,
        channel: this.channel,
        error: 'KAKAO_REST_API_KEY not set — stub mode',
      };
    }

    // STUB: Kakao Biz Message API (alimtalk / friendtalk).
    // Production endpoint: POST https://kapi.kakao.com/v1/api/talk/friends/message/default/send
    // Requires OAuth token exchange and an approved message template.
    console.log(`[kakao] STUB sendMessage to=${to} locale=${locale} len=${content.length}`);
    return {
      ok: false,
      channel: this.channel,
      to,
      error: 'KakaoTalk sendMessage is a stub — activate with live credentials + approved template',
    };
  }

  async verifyWebhook(
    rawBody: string,
    signature: string,
    _headers: Record<string, string>,
  ): Promise<boolean> {
    const adminKey = getTrimmedEnv('KAKAO_ADMIN_KEY');
    if (!adminKey) {
      console.error('[kakao] KAKAO_ADMIN_KEY not set — rejecting all webhooks');
      return false;
    }

    // Kakao webhook signature: HMAC-SHA256(rawBody, adminKey), hex-encoded.
    // The header sent by Kakao is X-Kakao-Signature.
    const expected = crypto
      .createHmac('sha256', adminKey)
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

    // Kakao Open Builder / Biz Message webhook shape:
    // { userRequest: { user: { id }, utterance }, action: { id }, ... }
    const utterance = json?.userRequest?.utterance as string | undefined;
    const userId = json?.userRequest?.user?.id as string | undefined;
    const actionId = json?.action?.id as string | undefined;

    // Also support Kakao channel webhook (friendtalk):
    // { message_id, user_id, content }
    const friendtalkId = json?.message_id as string | undefined;
    const friendtalkUser = json?.user_id as string | undefined;
    const friendtalkContent = json?.content as string | undefined;

    if (friendtalkId && friendtalkUser) {
      return {
        messageId: `kakao:${friendtalkId}`,
        from: friendtalkUser,
        text: friendtalkContent ?? '',
        rawPayload: json,
      };
    }

    if (actionId && userId) {
      return {
        messageId: `kakao:${actionId}`,
        from: userId,
        text: utterance ?? '',
        rawPayload: json,
      };
    }

    return null;
  }

  getGreeting(locale: string): string {
    return GREETINGS[locale] ?? GREETINGS['ko'];
  }
}

export const kakaoAdapter: ChannelAdapter = new KakaoAdapter();

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('server-only', () => ({}));

const dedupResults: Map<string, 'duplicate' | 'inserted' | 'error'> = new Map();

vi.mock('@/lib/channels/dedup', () => ({
  dedupChannelEvent: vi.fn(async (channel: string, messageId: string) => {
    const key = `${channel}:${messageId}`;
    const result = dedupResults.get(key) ?? 'inserted';
    dedupResults.set(key, 'duplicate');
    return result;
  }),
  markChannelEventProcessed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
  webhookLimiter: {},
}));

import { kakaoAdapter } from '../kakao';
import { POST } from '@/app/api/channels/kakao/webhook/route';

const ADMIN_KEY = 'test-kakao-admin-key';

function makeKakaoSignature(body: string, key = ADMIN_KEY): string {
  return crypto.createHmac('sha256', key).update(body, 'utf-8').digest('hex');
}

function makeKakaoOpenBuilderPayload(userId: string, utterance: string, actionId: string) {
  return JSON.stringify({
    userRequest: { user: { id: userId }, utterance },
    action: { id: actionId },
  });
}

function buildRequest(body: string, sig: string): Request {
  return new Request('http://localhost/api/channels/kakao/webhook', {
    method: 'POST',
    headers: { 'x-kakao-signature': sig, 'content-type': 'application/json' },
    body,
  });
}

describe('KakaoAdapter.verifyWebhook', () => {
  beforeEach(() => {
    process.env.KAKAO_ADMIN_KEY = ADMIN_KEY;
  });

  it('accepts a valid HMAC-SHA256 hex signature', async () => {
    const body = 'test-kakao-body';
    const sig = makeKakaoSignature(body);
    expect(await kakaoAdapter.verifyWebhook(body, sig, {})).toBe(true);
  });

  it('rejects an invalid signature', async () => {
    expect(await kakaoAdapter.verifyWebhook('body', 'badhex', {})).toBe(false);
  });

  it('rejects when KAKAO_ADMIN_KEY is not set', async () => {
    delete process.env.KAKAO_ADMIN_KEY;
    const sig = makeKakaoSignature('body');
    expect(await kakaoAdapter.verifyWebhook('body', sig, {})).toBe(false);
    process.env.KAKAO_ADMIN_KEY = ADMIN_KEY;
  });
});

describe('KakaoAdapter.parseIncoming', () => {
  it('parses Open Builder utterance payload', () => {
    const body = makeKakaoOpenBuilderPayload('user-k1', '예약하기', 'action-001');
    const msg = kakaoAdapter.parseIncoming(body);
    expect(msg).not.toBeNull();
    expect(msg?.messageId).toBe('kakao:action-001');
    expect(msg?.from).toBe('user-k1');
    expect(msg?.text).toBe('예약하기');
  });

  it('parses friendtalk message payload', () => {
    const body = JSON.stringify({ message_id: 'fm-001', user_id: 'uk-42', content: '안녕하세요' });
    const msg = kakaoAdapter.parseIncoming(body);
    expect(msg?.messageId).toBe('kakao:fm-001');
    expect(msg?.from).toBe('uk-42');
    expect(msg?.text).toBe('안녕하세요');
  });

  it('returns null for unrecognised payload', () => {
    expect(kakaoAdapter.parseIncoming(JSON.stringify({ event: 'unknown' }))).toBeNull();
  });
});

describe('KakaoAdapter.sendMessage (stub)', () => {
  it('returns ok=false with stub error when key missing', async () => {
    delete process.env.KAKAO_REST_API_KEY;
    const result = await kakaoAdapter.sendMessage('user-k1', '안녕', 'ko');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stub/i);
  });
});

describe('KakaoAdapter.getGreeting', () => {
  it('returns Korean greeting for ko locale', () => {
    expect(kakaoAdapter.getGreeting('ko')).toBe('안녕하세요');
  });
});

describe('Kakao webhook route — dedup', () => {
  beforeEach(() => {
    process.env.KAKAO_ADMIN_KEY = ADMIN_KEY;
    dedupResults.clear();
  });

  it('returns 200 on first delivery', async () => {
    const body = makeKakaoOpenBuilderPayload('user-k2', '예약', 'action-dedup-001');
    const sig = makeKakaoSignature(body);
    const res = await POST(buildRequest(body, sig) as any);
    expect(res.status).toBe(200);
  });

  it('returns 200 on duplicate without double-processing', async () => {
    const body = makeKakaoOpenBuilderPayload('user-k3', '예약', 'action-dedup-002');
    const sig = makeKakaoSignature(body);
    await POST(buildRequest(body, sig) as any);
    const res2 = await POST(buildRequest(body, sig) as any);
    expect((await res2.json()).ok).toBe(true);
    expect(res2.status).toBe(200);
  });

  it('returns 403 on missing signature', async () => {
    const req = new Request('http://localhost/api/channels/kakao/webhook', {
      method: 'POST',
      body: '{}',
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

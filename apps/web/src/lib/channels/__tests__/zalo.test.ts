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

import { zaloAdapter } from '../zalo';
import { POST } from '@/app/api/channels/zalo/webhook/route';

const SECRET_KEY = 'test-zalo-oa-secret-key';

function makeZaloSignature(body: string, key = SECRET_KEY): string {
  return crypto.createHmac('sha256', key).update(body, 'utf-8').digest('hex');
}

function makeZaloTextPayload(senderId: string, text: string, msgId: string) {
  return JSON.stringify({
    event_name: 'user_send_text',
    timestamp: Date.now(),
    sender: { id: senderId },
    recipient: { id: 'oa-123' },
    message: { msg_id: msgId, text },
  });
}

function buildRequest(body: string, sig: string): Request {
  return new Request('http://localhost/api/channels/zalo/webhook', {
    method: 'POST',
    headers: { 'x-zevent-signature': sig, 'content-type': 'application/json' },
    body,
  });
}

describe('ZaloAdapter.verifyWebhook', () => {
  beforeEach(() => {
    process.env.ZALO_OA_SECRET_KEY = SECRET_KEY;
  });

  it('accepts a valid HMAC-SHA256 hex signature', async () => {
    const body = 'test-zalo-body';
    const sig = makeZaloSignature(body);
    expect(await zaloAdapter.verifyWebhook(body, sig, {})).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    expect(await zaloAdapter.verifyWebhook('body', 'deadbeef', {})).toBe(false);
  });

  it('rejects when ZALO_OA_SECRET_KEY is not set', async () => {
    delete process.env.ZALO_OA_SECRET_KEY;
    const sig = makeZaloSignature('body');
    expect(await zaloAdapter.verifyWebhook('body', sig, {})).toBe(false);
    process.env.ZALO_OA_SECRET_KEY = SECRET_KEY;
  });
});

describe('ZaloAdapter.parseIncoming', () => {
  it('parses a user_send_text event', () => {
    const body = makeZaloTextPayload('zuser-1', 'Xin chào', 'zmsg-001');
    const msg = zaloAdapter.parseIncoming(body);
    expect(msg).not.toBeNull();
    expect(msg?.messageId).toBe('zalo:zmsg-001');
    expect(msg?.from).toBe('zuser-1');
    expect(msg?.text).toBe('Xin chào');
  });

  it('returns null for non-text events (e.g. image)', () => {
    const body = JSON.stringify({ event_name: 'user_send_image', sender: { id: 'z1' } });
    expect(zaloAdapter.parseIncoming(body)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(zaloAdapter.parseIncoming('not-json')).toBeNull();
  });
});

describe('ZaloAdapter.sendMessage (stub)', () => {
  it('returns ok=false with stub error when creds missing', async () => {
    delete process.env.ZALO_OA_ID;
    delete process.env.ZALO_OA_SECRET_KEY;
    const result = await zaloAdapter.sendMessage('zuser-1', 'Xin chào', 'vi');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stub/i);
  });
});

describe('ZaloAdapter.getGreeting', () => {
  it('returns Vietnamese greeting for vi locale', () => {
    expect(zaloAdapter.getGreeting('vi')).toBe('Xin chào');
  });
});

describe('Zalo webhook route — dedup', () => {
  beforeEach(() => {
    process.env.ZALO_OA_SECRET_KEY = SECRET_KEY;
    dedupResults.clear();
  });

  it('returns 200 on first delivery', async () => {
    const body = makeZaloTextPayload('zuser-2', 'Đặt lịch', 'zmsg-dedup-001');
    const sig = makeZaloSignature(body);
    const res = await POST(buildRequest(body, sig) as any);
    expect(res.status).toBe(200);
  });

  it('returns 200 on duplicate without re-processing', async () => {
    const body = makeZaloTextPayload('zuser-3', 'Đặt lịch', 'zmsg-dedup-002');
    const sig = makeZaloSignature(body);
    await POST(buildRequest(body, sig) as any);
    const res2 = await POST(buildRequest(body, sig) as any);
    expect((await res2.json()).ok).toBe(true);
    expect(res2.status).toBe(200);
  });

  it('returns 403 on missing signature', async () => {
    const req = new Request('http://localhost/api/channels/zalo/webhook', {
      method: 'POST',
      body: '{}',
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

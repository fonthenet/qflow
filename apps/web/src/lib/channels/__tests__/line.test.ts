import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('server-only', () => ({}));

// ── Dedup mock ────────────────────────────────────────────────────────────────
const dedupResults: Map<string, 'duplicate' | 'inserted' | 'error'> = new Map();

vi.mock('@/lib/channels/dedup', () => ({
  dedupChannelEvent: vi.fn(async (channel: string, messageId: string) => {
    const key = `${channel}:${messageId}`;
    const result = dedupResults.get(key) ?? 'inserted';
    dedupResults.set(key, 'duplicate'); // second call = dup
    return result;
  }),
  markChannelEventProcessed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(null),
  webhookLimiter: {},
}));

import { lineAdapter } from '../line';
import { POST } from '@/app/api/channels/line/webhook/route';

const SECRET = 'test-line-channel-secret';

function makeLineSignature(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body, 'utf-8').digest('base64');
}

function makeLineTextPayload(userId: string, text: string, messageId: string) {
  return JSON.stringify({
    events: [
      {
        type: 'message',
        message: { id: messageId, type: 'text', text },
        source: { userId },
        timestamp: Date.now(),
      },
    ],
  });
}

function buildRequest(body: string, sig: string): Request {
  return new Request('http://localhost/api/channels/line/webhook', {
    method: 'POST',
    headers: { 'x-line-signature': sig, 'content-type': 'application/json' },
    body,
  });
}

describe('LineAdapter.verifyWebhook', () => {
  beforeEach(() => {
    process.env.LINE_CHANNEL_SECRET = SECRET;
  });

  it('accepts a valid HMAC-SHA256 base64 signature', async () => {
    const body = 'test-body';
    const sig = makeLineSignature(body);
    const result = await lineAdapter.verifyWebhook(body, sig, {});
    expect(result).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const body = 'test-body';
    const result = await lineAdapter.verifyWebhook(body, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', {});
    expect(result).toBe(false);
  });

  it('rejects when secret is not set', async () => {
    delete process.env.LINE_CHANNEL_SECRET;
    const body = 'test-body';
    const sig = makeLineSignature(body);
    const result = await lineAdapter.verifyWebhook(body, sig, {});
    expect(result).toBe(false);
    process.env.LINE_CHANNEL_SECRET = SECRET;
  });
});

describe('LineAdapter.parseIncoming', () => {
  it('returns message for text event', () => {
    const body = makeLineTextPayload('U123', 'Hello', 'msg001');
    const msg = lineAdapter.parseIncoming(body);
    expect(msg).not.toBeNull();
    expect(msg?.messageId).toBe('line:msg001');
    expect(msg?.from).toBe('U123');
    expect(msg?.text).toBe('Hello');
  });

  it('returns null for non-text events', () => {
    const body = JSON.stringify({
      events: [{ type: 'follow', source: { userId: 'U123' }, timestamp: Date.now() }],
    });
    expect(lineAdapter.parseIncoming(body)).toBeNull();
  });

  it('returns null for empty events array', () => {
    expect(lineAdapter.parseIncoming(JSON.stringify({ events: [] }))).toBeNull();
  });
});

describe('LineAdapter.sendMessage (stub)', () => {
  it('returns ok=false with stub error when token missing', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const result = await lineAdapter.sendMessage('U123', 'Hello', 'ja');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/stub/i);
  });
});

describe('LineAdapter.getGreeting', () => {
  it('returns Japanese greeting for ja locale', () => {
    expect(lineAdapter.getGreeting('ja')).toBe('こんにちは');
  });

  it('falls back to Japanese for unknown locale', () => {
    expect(lineAdapter.getGreeting('xx')).toBe('こんにちは');
  });
});

describe('LINE webhook route — dedup', () => {
  beforeEach(() => {
    process.env.LINE_CHANNEL_SECRET = SECRET;
    dedupResults.clear();
  });

  it('processes the first delivery and returns 200', async () => {
    const body = makeLineTextPayload('U999', 'Xin chào', 'dedup-line-001');
    const sig = makeLineSignature(body);
    const req = buildRequest(body, sig) as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  it('returns 200 on duplicate without re-processing', async () => {
    const body = makeLineTextPayload('U999', 'Xin chào', 'dedup-line-002');
    const sig = makeLineSignature(body);
    const req = buildRequest(body, sig) as any;

    // First delivery — sets dup flag in mock
    await POST(req);

    // Second delivery — dedup mock returns 'duplicate'
    const req2 = buildRequest(body, sig) as any;
    const res2 = await POST(req2);
    const json = await res2.json();
    expect(res2.status).toBe(200);
    expect(json.ok).toBe(true);
  });

  it('returns 403 when signature is missing', async () => {
    const req = new Request('http://localhost/api/channels/line/webhook', {
      method: 'POST',
      body: '{}',
    }) as any;
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

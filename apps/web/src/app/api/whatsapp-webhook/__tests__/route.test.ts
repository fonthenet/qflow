/**
 * WhatsApp webhook handler tests.
 *
 * Covers:
 *  1. GET — hub.challenge verification (valid token, wrong token, no env var)
 *  2. POST — missing app secret → 500
 *  3. POST — missing signature → 403
 *  4. POST — invalid signature → 403
 *  5. POST — valid signature, first delivery → 200, handler called
 *  6. POST — duplicate wamid (dedup) → 200, handler NOT called a second time
 *  7. POST — status-update payload (no messages[]) → 200, handler NOT called
 *  8. Multi-tenant routing: message "JOIN BISTRO" routes to handler with correct phone
 *  9. Greeting locale: Arabic سلام → handler invoked (locale resolution tested via messaging-commands)
 * 10. Greeting locale: French Salut → handler invoked
 */

import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import crypto from 'crypto';

// ── Hoisted mocks (must come before any imports that trigger module loading) ──

const { handleWhatsAppMessageMock, normalizePhoneMock, checkRateLimitMock } = vi.hoisted(() => ({
  handleWhatsAppMessageMock: vi.fn().mockResolvedValue(undefined),
  normalizePhoneMock: vi.fn((v: string) => v.replace(/\D/g, '')),
  checkRateLimitMock: vi.fn().mockResolvedValue(null), // null = not blocked
}));

// Track dedup inserts and updates across test cases
let dedupInsertResults: Array<{ data: null; error: null | { code: string; message: string } }> = [];
let dedupInsertCallCount = 0;
let dedupUpdateCallCount = 0;

/** Builds a fully awaitable Supabase chain stub (supports eq chaining + await) */
function makeChain(resolved: unknown = { data: null, error: null }) {
  const chain: any = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolved);
  // Allow `await chain` by implementing the Promise interface
  chain.then = (onfulfilled: any, onrejected?: any) =>
    Promise.resolve(resolved).then(onfulfilled, onrejected);
  chain.catch = (onrejected: any) => Promise.resolve(resolved).catch(onrejected);
  chain.finally = (onfinally: any) => Promise.resolve(resolved).finally(onfinally);
  return chain;
}

const mockSupabase = {
  from: vi.fn((table: string) => {
    // Production code uses `channel_webhook_events` (generic multi-channel dedup table).
    // The old table name `whatsapp_webhook_events` no longer exists — dedup.ts line 25.
    if (table === 'channel_webhook_events') {
      return {
        insert: vi.fn(() => {
          const result = dedupInsertResults[dedupInsertCallCount] ?? { data: null, error: null };
          dedupInsertCallCount++;
          return Promise.resolve(result);
        }),
        update: vi.fn(() => makeChain({ data: null, error: null })),
      };
    }
    return {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(() => makeChain({ data: null, error: null })),
    };
  }),
};

vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/whatsapp-commands', () => ({
  handleWhatsAppMessage: handleWhatsAppMessageMock,
}));

vi.mock('@/lib/messaging-commands', () => ({
  normalizePhone: normalizePhoneMock,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: checkRateLimitMock,
  webhookLimiter: {},
}));

// ── Import route AFTER mocks ──────────────────────────────────────────────────

import { GET, POST } from '../route';

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_SECRET = 'test-app-secret-32chars-padpadpad';
const VERIFY_TOKEN = 'test-verify-token-abc';
const PHONE_NUMBER_ID = '123456789012345';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a signed Meta webhook payload.
 * Returns { body: string, signature: string } ready for the mock request.
 */
function buildMetaPayload(messageOverride?: Partial<{
  id: string;
  from: string;
  text_body: string;
  user_id: string;
}>) {
  const msg = {
    id: 'wamid.test001',
    from: '213555000001',
    ...messageOverride,
  };

  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '213600000000',
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [{ profile: { name: 'Test User' } }],
              messages: [
                {
                  id: msg.id,
                  from: msg.from,
                  type: 'text',
                  text: { body: messageOverride?.text_body ?? 'JOIN BISTRO' },
                  ...(messageOverride?.user_id ? { user_id: messageOverride.user_id } : {}),
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };

  const body = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
  return { body, signature };
}

/** Build a NextRequest-like mock that supports both text() and json() */
function buildRequest(
  rawBody: string,
  headers: Record<string, string>,
  url = 'http://localhost:3000/api/whatsapp-webhook',
): any {
  const headersMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url,
    headers: {
      get: (key: string) => headersMap.get(key.toLowerCase()) ?? null,
    },
    text: vi.fn().mockResolvedValue(rawBody),
    json: vi.fn().mockResolvedValue(JSON.parse(rawBody || '{}')),
  };
}

function buildGetRequest(params: Record<string, string>): any {
  const url = new URL('http://localhost:3000/api/whatsapp-webhook');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return { url: url.toString(), headers: { get: () => null } };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  handleWhatsAppMessageMock.mockClear();
  normalizePhoneMock.mockClear();
  checkRateLimitMock.mockResolvedValue(null);
  dedupInsertResults = [];
  dedupInsertCallCount = 0;
  dedupUpdateCallCount = 0;

  // Default environment
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
});

afterEach(() => {
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/whatsapp-webhook (hub.challenge verification)', () => {
  it('returns the challenge when mode=subscribe and token matches', async () => {
    const req = buildGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'challenge-abc-123',
    });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('challenge-abc-123');
  });

  it('returns 403 when the token does not match', async () => {
    const req = buildGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'challenge-xyz',
    });
    const res = await GET(req as any);
    expect(res.status).toBe(403);
  });

  it('returns 403 when WHATSAPP_WEBHOOK_VERIFY_TOKEN env var is absent', async () => {
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const req = buildGetRequest({
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'challenge-xyz',
    });
    const res = await GET(req as any);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/whatsapp-webhook — signature verification', () => {
  it('returns 403 when WHATSAPP_APP_SECRET is not configured (fail-closed behaviour)', async () => {
    // Production code intentionally returns 403 (forbidden/reject) rather than
    // 500 when the app secret is absent — unverified payloads are rejected, not
    // treated as a server error. Updated to match current production behaviour.
    delete process.env.WHATSAPP_APP_SECRET;
    const { body } = buildMetaPayload();
    const req = buildRequest(body, { 'content-type': 'application/json' });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/not configured|verification/i);
  });

  it('returns 403 when X-Hub-Signature-256 header is absent', async () => {
    const { body } = buildMetaPayload();
    const req = buildRequest(body, {
      'content-type': 'application/json',
      // No x-hub-signature-256
    });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/missing signature/i);
  });

  it('returns 403 when the signature is invalid (tampered body)', async () => {
    const { body } = buildMetaPayload();
    // Sign with a DIFFERENT secret so the computed HMAC won't match
    const wrongSig = 'sha256=' + crypto
      .createHmac('sha256', 'wrong-secret')
      .update(body)
      .digest('hex');
    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': wrongSig,
    });
    const res = await POST(req as any);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/invalid signature/i);
  });
});

describe('POST /api/whatsapp-webhook — first delivery (happy path)', () => {
  it('returns 200 and calls handleWhatsAppMessage for a valid signed payload', async () => {
    // First delivery: dedup insert succeeds (no conflict)
    dedupInsertResults = [{ data: null, error: null }];

    const { body, signature } = buildMetaPayload({ id: 'wamid.unique001', from: '213555000001', text_body: 'JOIN BISTRO' });
    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(handleWhatsAppMessageMock).toHaveBeenCalledOnce();
    expect(handleWhatsAppMessageMock).toHaveBeenCalledWith(
      expect.any(String), // normalised phone
      'JOIN BISTRO',
      'Test User',
      undefined, // bsuid absent in this payload
      undefined, // locationData absent
    );
  });
});

describe('POST /api/whatsapp-webhook — deduplication (CRITICAL)', () => {
  it('second delivery of the same wamid returns 200 without calling the handler', async () => {
    // First call succeeds; second call returns a unique-constraint error
    dedupInsertResults = [
      { data: null, error: null }, // first delivery → insert OK
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }, // second delivery → conflict
    ];

    const WAMID = 'wamid.dedup-test-002';
    const { body, signature } = buildMetaPayload({ id: WAMID, text_body: 'STATUS' });

    const req1 = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });
    const res1 = await POST(req1 as any);
    expect(res1.status).toBe(200);
    expect(handleWhatsAppMessageMock).toHaveBeenCalledOnce();

    handleWhatsAppMessageMock.mockClear();

    const req2 = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });
    const res2 = await POST(req2 as any);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.ok).toBe(true);

    // Handler must NOT be called on second delivery
    expect(handleWhatsAppMessageMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp-webhook — status updates (no messages[])', () => {
  it('returns 200 without calling the handler for a delivery receipt payload', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '213600000000', phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: 'wamid.statusupdate', status: 'delivered', timestamp: '1234567890' }],
                // NOTE: no messages[] array
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');

    const req = buildRequest(rawBody, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(handleWhatsAppMessageMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/whatsapp-webhook — multi-tenant routing via JOIN command', () => {
  it('passes the normalised phone and JOIN BISTRO body to the handler', async () => {
    dedupInsertResults = [{ data: null, error: null }];

    const { body, signature } = buildMetaPayload({
      id: 'wamid.routing-test-001',
      from: '213669000001',
      text_body: 'JOIN BISTRO',
    });

    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    await POST(req as any);

    // The handler is called with the normalised from-phone and the raw message body.
    // The actual org lookup (findOrgByCode) lives in messaging-commands.ts and is
    // tested separately; here we only assert the adapter contract.
    expect(handleWhatsAppMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('213669000001'),
      'JOIN BISTRO',
      'Test User',
      undefined,
      undefined,
    );
  });
});

describe('POST /api/whatsapp-webhook — greeting locale detection', () => {
  /**
   * Locale resolution itself lives in messaging-commands.ts (detectGreeting).
   * The webhook layer simply forwards the message body to handleWhatsAppMessage.
   * These tests assert that the body reaches the handler unmodified so that
   * the downstream locale logic can operate on the original text.
   */

  it('forwards Arabic greeting سلام to the handler unchanged', async () => {
    dedupInsertResults = [{ data: null, error: null }];

    const arabicBody = 'سلام';
    const { body, signature } = buildMetaPayload({
      id: 'wamid.ar-greet-001',
      from: '213669000002',
      text_body: arabicBody,
    });

    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    await POST(req as any);

    expect(handleWhatsAppMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      arabicBody,
      'Test User',
      undefined,
      undefined,
    );
  });

  it('forwards French greeting Salut to the handler unchanged', async () => {
    dedupInsertResults = [{ data: null, error: null }];

    const frBody = 'Salut';
    const { body, signature } = buildMetaPayload({
      id: 'wamid.fr-greet-001',
      from: '213669000003',
      text_body: frBody,
    });

    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    await POST(req as any);

    expect(handleWhatsAppMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      frBody,
      'Test User',
      undefined,
      undefined,
    );
  });

  it('forwards English greeting Hi to the handler unchanged', async () => {
    dedupInsertResults = [{ data: null, error: null }];

    const enBody = 'Hi';
    const { body, signature } = buildMetaPayload({
      id: 'wamid.en-greet-001',
      from: '16195550001',
      text_body: enBody,
    });

    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    await POST(req as any);

    expect(handleWhatsAppMessageMock).toHaveBeenCalledWith(
      expect.any(String),
      enBody,
      'Test User',
      undefined,
      undefined,
    );
  });
});

describe('POST /api/whatsapp-webhook — rate limiting', () => {
  it('returns the rate-limit response when the limiter blocks the request', async () => {
    const { NextResponse } = await import('next/server');
    const blockedResponse = NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    checkRateLimitMock.mockResolvedValueOnce(blockedResponse);

    const { body, signature } = buildMetaPayload();
    const req = buildRequest(body, {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(429);
    expect(handleWhatsAppMessageMock).not.toHaveBeenCalled();
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { handleWhatsAppMessage } from '@/lib/whatsapp-commands';
import { dedupChannelEvent } from '@/lib/channels/dedup';
import crypto from 'crypto';
import { checkRateLimit, webhookLimiter } from '@/lib/rate-limit';

/**
 * GET — Webhook verification (used by Meta Cloud API).
 * Twilio doesn't require this, but it's harmless to support both.
 */
export async function GET(request: NextRequest) {
  // Parse params from raw URL to avoid any framework issues with dotted keys
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  console.log('[whatsapp-webhook] GET verification:', {
    mode,
    hasToken: !!token,
    hasVerifyToken: !!verifyToken,
    tokenLength: token?.length,
    verifyTokenLength: verifyToken?.length,
    match: token === verifyToken,
    hasChallenge: !!challenge,
    rawUrl: request.url.substring(0, 200),
  });

  // Verify token must match — no fallback
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  if (mode === 'subscribe' && !verifyToken) {
    console.error('[whatsapp-webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN not set — rejecting verification');
  } else if (mode === 'subscribe') {
    console.warn('[whatsapp-webhook] Token mismatch — rejecting');
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST — Receive incoming WhatsApp messages (shared number routing).
 *
 * One QFlow WhatsApp number serves ALL businesses. Routing is done by
 * parsing a business code from the message (e.g. "JOIN HADABI") or by
 * looking up an existing active session for STATUS / CANCEL commands.
 */
export async function POST(request: NextRequest) {
  const blocked = await checkRateLimit(request, webhookLimiter);
  if (blocked) return blocked;

  try {
    const contentType = request.headers.get('content-type') ?? '';

    let fromPhone: string;
    let toPhone: string;
    let messageBody: string;
    let profileName: string | undefined;
    let bsuid: string | undefined; // Business-Scoped User ID (Meta BSUID)
    // Dedup key: Meta message.id (guaranteed unique per delivery); Twilio uses
    // a composite derived from phone+timestamp as a best-effort fallback.
    let messageId: string | null = null;
    // Location share (paperclip → Location → Send / Live Location). Captured
    // from Meta's `message.location` or Twilio's Latitude/Longitude form fields,
    // then forwarded to the message handler so the in-WhatsApp ordering flow
    // can drop it straight into delivery_address without asking for text.
    let locationData: { latitude: number; longitude: number; name?: string; address?: string } | null = null;

    // For Meta Cloud API (JSON), verify x-hub-signature-256 if app secret is set
    if (contentType.includes('application/json')) {
      const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() || process.env.MESSENGER_APP_SECRET?.trim();
      const signature = request.headers.get('x-hub-signature-256') ?? '';
      if (appSecret) {
        if (!signature) {
          console.warn('[whatsapp-webhook] Missing x-hub-signature-256 header');
          return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
        }
        const rawBody = await request.text();
        const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
        if (signature !== expectedSig) {
          console.warn('[whatsapp-webhook] Invalid Meta signature');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }
        // Parse from verified body
        const json = JSON.parse(rawBody);
        const entry = json?.entry?.[0];
        const change = entry?.changes?.[0];
        const message = change?.value?.messages?.[0];
        if (!message) {
          return NextResponse.json({ ok: true });
        }
        fromPhone = message.from ?? '';
        toPhone = change?.value?.metadata?.display_phone_number ?? '';
        messageBody = message.text?.body ?? '';
        profileName = change?.value?.contacts?.[0]?.profile?.name || undefined;
        bsuid = message.user_id || change?.value?.contacts?.[0]?.user_id || undefined;
        // Meta provides a stable per-delivery message ID — primary dedup key.
        messageId = (message.id as string) || null;
        // Location-share message: Meta delivers it as message.type === 'location'
        // with latitude/longitude (always) and optional name/address (the latter
        // only when the customer picked a labelled place from the WA picker
        // rather than raw GPS). We synthesize a placeholder body so downstream
        // dedup + empty-body checks don't bail.
        if (message.type === 'location' && message.location) {
          const loc = message.location as { latitude?: number; longitude?: number; name?: string; address?: string };
          if (typeof loc.latitude === 'number' && typeof loc.longitude === 'number') {
            locationData = {
              latitude: loc.latitude,
              longitude: loc.longitude,
              name: typeof loc.name === 'string' ? loc.name : undefined,
              address: typeof loc.address === 'string' ? loc.address : undefined,
            };
            if (!messageBody) messageBody = '[location]';
          }
        }
      } else {
        // No app secret configured — fail closed (reject unverified payloads)
        console.error('[whatsapp-webhook] WHATSAPP_APP_SECRET/MESSENGER_APP_SECRET not set — rejecting unverified webhook. Set the env var to enable webhook processing.');
        return NextResponse.json({ error: 'Webhook signature verification not configured' }, { status: 403 });
      }
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      // Twilio sends form-encoded data
      const formData = await request.formData();
      fromPhone = (formData.get('From') as string) ?? '';
      toPhone = (formData.get('To') as string) ?? '';
      messageBody = (formData.get('Body') as string) ?? '';
      // Twilio SID is a stable message identifier
      const twilioSid = formData.get('MessageSid') as string | null;
      messageId = twilioSid || null;
      // Twilio location-share messages arrive as Latitude/Longitude form
      // fields plus an optional Address/Label. Same handling as the Meta
      // path so the order flow can pick up the pin and skip text-address.
      const twLat = formData.get('Latitude');
      const twLng = formData.get('Longitude');
      if (typeof twLat === 'string' && typeof twLng === 'string') {
        const lat = Number(twLat);
        const lng = Number(twLng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          const twAddr = formData.get('Address');
          const twLabel = formData.get('Label');
          locationData = {
            latitude: lat,
            longitude: lng,
            name: typeof twLabel === 'string' ? twLabel : undefined,
            address: typeof twAddr === 'string' ? twAddr : undefined,
          };
          if (!messageBody) messageBody = '[location]';
        }
      }

      // Validate Twilio signature if auth token is available
      const twilioSignature = request.headers.get('x-twilio-signature');
      const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
      if (authToken && twilioSignature) {
        const isValid = validateTwilioSignature(
          request.url,
          Object.fromEntries(formData.entries()) as Record<string, string>,
          twilioSignature,
          authToken
        );
        if (!isValid) {
          console.warn('[whatsapp-webhook] Invalid Twilio signature');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }
      }
    } else {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
    }

    // Normalize phones to canonical E.164 (no leading +). Handles Algerian
    // local format (0XXXXXXXXX → 213XXXXXXXXX), US (+1...), Twilio prefix,
    // and any country code already present. See lib/messaging-commands.ts.
    {
      const { normalizePhone } = await import('@/lib/messaging-commands');
      fromPhone = normalizePhone(fromPhone);
      toPhone = normalizePhone(toPhone);
    }

    if ((!fromPhone && !bsuid) || !messageBody) {
      return NextResponse.json({ ok: true });
    }

    // ── Idempotency guard (Meta delivers webhooks multiple times) ──────
    // Dedup by message_id. We derive a fallback key from phone + truncated body
    // when no stable ID is available (shouldn't happen in production, but
    // better than skipping dedup entirely).
    const dedupKey =
      messageId ||
      `wa:${fromPhone || bsuid}:${Buffer.from(messageBody.slice(0, 64)).toString('base64')}`;

    const dedupResult = await dedupChannelEvent('whatsapp', dedupKey, {
      from: fromPhone || bsuid,
      body: messageBody.slice(0, 64),
    });

    if (dedupResult === 'duplicate') {
      console.log(`[whatsapp-webhook] Duplicate delivery suppressed (key=${dedupKey.slice(0, 30)}…)`);
      return NextResponse.json({ ok: true });
    }
    // 'error' → dedup infra failed; process anyway (best-effort, avoids silent drops)

    // Log with PII redaction (show last 4 digits of phone, truncate message)
    const redactedPhone = fromPhone ? `***${fromPhone.slice(-4)}` : bsuid ? `bsuid:***${bsuid.slice(-4)}` : 'unknown';
    console.log(`[whatsapp-webhook] Message from ${redactedPhone}: "${messageBody.substring(0, 30)}${messageBody.length > 30 ? '...' : ''}"`);

    // Handle the message with shared-number routing
    // Phone is primary identifier; BSUID is passed alongside for storage/fallback
    // locationData is forwarded for the in-WhatsApp ordering flow's address step.
    await handleWhatsAppMessage(fromPhone, messageBody, profileName, bsuid, locationData ?? undefined);

    console.log(`[whatsapp-webhook] Handled successfully`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err);
    return NextResponse.json({ ok: true }); // Always 200 to prevent retries
  }
}

/**
 * Validate Twilio webhook signature.
 */
function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  // Sort params by key, concatenate key+value
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], '');

  const expected = crypto
    .createHmac('sha1', authToken)
    .update(data, 'utf-8')
    .digest('base64');

  return signature === expected;
}

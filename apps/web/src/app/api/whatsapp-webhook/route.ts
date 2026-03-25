import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleWhatsAppMessage } from '@/lib/whatsapp-commands';
import crypto from 'crypto';

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

  // Primary check: verify token matches
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  // Fallback: if env var not set, accept verification to allow initial setup
  if (mode === 'subscribe' && challenge && !verifyToken) {
    console.warn('[whatsapp-webhook] No WHATSAPP_WEBHOOK_VERIFY_TOKEN set, accepting');
    return new NextResponse(challenge, { status: 200 });
  }

  // Last resort: accept if mode is subscribe with challenge (for setup only)
  if (mode === 'subscribe' && challenge) {
    console.warn('[whatsapp-webhook] Token mismatch but accepting for setup');
    return new NextResponse(challenge, { status: 200 });
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
  try {
    const contentType = request.headers.get('content-type') ?? '';

    let fromPhone: string;
    let toPhone: string;
    let messageBody: string;
    let profileName: string | undefined;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Twilio sends form-encoded data
      const formData = await request.formData();
      fromPhone = (formData.get('From') as string) ?? '';
      toPhone = (formData.get('To') as string) ?? '';
      messageBody = (formData.get('Body') as string) ?? '';

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
    } else if (contentType.includes('application/json')) {
      // Meta Cloud API sends JSON
      const json = await request.json();
      const entry = json?.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];
      if (!message) {
        return NextResponse.json({ ok: true });
      }
      fromPhone = message.from ?? '';
      toPhone = change?.value?.metadata?.display_phone_number ?? '';
      messageBody = message.text?.body ?? '';
      // Extract WhatsApp profile name (Meta provides it in contacts array)
      profileName = change?.value?.contacts?.[0]?.profile?.name || undefined;
    } else {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 400 });
    }

    // Strip whatsapp: prefix from Twilio numbers
    fromPhone = fromPhone.replace(/^whatsapp:/, '');
    toPhone = toPhone.replace(/^whatsapp:/, '');

    if (!fromPhone || !messageBody) {
      return NextResponse.json({ ok: true });
    }

    console.log(`[whatsapp-webhook] Message from ${fromPhone}: "${messageBody}"`);

    // Handle the message with shared-number routing
    await handleWhatsAppMessage(fromPhone, messageBody, profileName);

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

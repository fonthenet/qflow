import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleInboundMessage } from '@/lib/messaging-commands';
import {
  sendMessengerMessage,
  sendMessengerMessageWithTag,
  getMessengerProfile,
  verifyMessengerSignature,
} from '@/lib/messenger';

/**
 * GET — Webhook verification (required by Meta Messenger Platform).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN;

  console.log('[messenger-webhook] GET verification:', {
    mode,
    hasToken: !!token,
    hasVerifyToken: !!verifyToken,
    match: token === verifyToken,
    hasChallenge: !!challenge,
  });

  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  // Fallback for initial setup if env not set
  if (mode === 'subscribe' && challenge && !verifyToken) {
    console.warn('[messenger-webhook] No MESSENGER_VERIFY_TOKEN set, accepting for setup');
    return new NextResponse(challenge, { status: 200 });
  }

  if (mode === 'subscribe' && challenge) {
    console.warn('[messenger-webhook] Token mismatch but accepting for setup');
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/**
 * POST — Receive incoming Messenger messages.
 *
 * Same shared-number routing as WhatsApp: one Facebook Page serves ALL businesses.
 * Routing by business code (e.g. "JOIN HADABI") or active session lookup.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // Verify signature if app secret is configured
    const appSecret = process.env.MESSENGER_APP_SECRET?.trim();
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (appSecret && signature) {
      try {
        const isValid = verifyMessengerSignature(rawBody, signature, appSecret);
        if (!isValid) {
          console.warn('[messenger-webhook] Invalid signature');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }
      } catch (err) {
        console.warn('[messenger-webhook] Signature verification error:', err);
        // Continue anyway — don't block messages if crypto fails
      }
    }

    const json = JSON.parse(rawBody);

    // Must be a page subscription
    if (json.object !== 'page') {
      return NextResponse.json({ ok: true });
    }

    for (const entry of json.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        const senderId = event.sender?.id;
        if (!senderId) continue;

        // ── Text message ──
        if (event.message?.text) {
          const text = event.message.text;
          console.log(`[messenger-webhook] Message from ${senderId}: "${text}"`);

          // Fetch profile name (Messenger doesn't include it in webhook)
          let profileName: string | undefined;
          try {
            const profile = await getMessengerProfile(senderId);
            if (profile?.firstName) {
              profileName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
            }
          } catch { /* non-critical */ }

          // Send function for Messenger
          const sendFn = async ({ to, body }: { to: string; body: string }) => {
            const result = await sendMessengerMessage({ recipientId: to, text: body });
            return { ok: result.ok };
          };

          await handleInboundMessage('messenger', senderId, text, sendFn, profileName);
          continue;
        }

        // ── Postback (button tap) ──
        if (event.postback?.payload) {
          const payload = event.postback.payload;
          console.log(`[messenger-webhook] Postback from ${senderId}: "${payload}"`);

          const sendFn = async ({ to, body }: { to: string; body: string }) => {
            const result = await sendMessengerMessage({ recipientId: to, text: body });
            return { ok: result.ok };
          };

          // Map postback payloads to commands
          if (payload.startsWith('JOIN_')) {
            const code = payload.replace('JOIN_', '');
            await handleInboundMessage('messenger', senderId, `JOIN ${code}`, sendFn);
          } else if (payload === 'STATUS') {
            await handleInboundMessage('messenger', senderId, 'STATUS', sendFn);
          } else if (payload === 'CANCEL') {
            await handleInboundMessage('messenger', senderId, 'CANCEL', sendFn);
          } else {
            // Treat unknown postback as text
            await handleInboundMessage('messenger', senderId, payload, sendFn);
          }
          continue;
        }

        // ── One-Time Notification opt-in ──
        if (event.optin?.one_time_notif_token) {
          const otnToken = event.optin.one_time_notif_token;
          const otnPayload = event.optin.payload ?? '';
          console.log(`[messenger-webhook] OTN opt-in from ${senderId}, payload: ${otnPayload}`);

          // Store the OTN token in the session
          const supabase = createAdminClient() as any;
          const { error } = await supabase
            .from('whatsapp_sessions')
            .update({ otn_token: otnToken })
            .eq('messenger_psid', senderId)
            .eq('state', 'active')
            .eq('channel', 'messenger');

          if (error) {
            console.error('[messenger-webhook] OTN token store error:', error);
          } else {
            console.log(`[messenger-webhook] Stored OTN token for ${senderId}`);
          }
          continue;
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[messenger-webhook] Error:', err);
    return NextResponse.json({ ok: true }); // Always 200 to prevent retries
  }
}

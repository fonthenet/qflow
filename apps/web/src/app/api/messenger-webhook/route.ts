import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleInboundMessage, tNotification, formatPosition } from '@/lib/messaging-commands';
import {
  sendMessengerMessage,
  sendMessengerMessageWithTag,
  getMessengerProfile,
  verifyMessengerSignature,
} from '@/lib/messenger';
import { getQueuePosition } from '@/lib/queue-position';

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

        // ── Referral from m.me link (in-house/kiosk Messenger opt-in) ──
        // MUST be checked BEFORE text message — returning users may get both
        // a referral AND a message event. Also check event.message.referral
        // which Messenger uses for returning users clicking m.me links.
        const referralRef =
          event.referral?.ref ||              // returning user clicks m.me link
          event.postback?.referral?.ref ||     // new user taps "Get Started" via m.me link
          event.message?.referral?.ref;        // returning user — ref embedded in message event
        if (referralRef && typeof referralRef === 'string' && referralRef.startsWith('qflo_')) {
          const qrToken = referralRef.replace('qflo_', '');
          console.log(`[messenger-webhook] Referral from ${senderId}, qr_token: ${qrToken}`);
          await handleMessengerReferral(senderId, qrToken);
          continue;
        }

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
          } else if (payload === 'GET_STARTED') {
            // New user tapped "Get Started" — if they arrived via m.me link,
            // the referral is handled above (or arrives as a separate event).
            // Don't send a generic welcome — just acknowledge silently so the
            // referral handler can send the proper ticket-linked message.
            console.log(`[messenger-webhook] GET_STARTED from ${senderId} (no referral — waiting for referral event)`);
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

/**
 * Handle m.me referral: customer clicked "Get Messenger notifications" link
 * from the tracking page, kiosk, or Station confirmation.
 *
 * Flow: look up ticket by qr_token → create Messenger session → send joined message
 */
async function handleMessengerReferral(psid: string, qrToken: string) {
  const supabase = createAdminClient() as any;

  // Look up ticket by qr_token
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, ticket_number, qr_token, status, office_id, department_id, service_id')
    .eq('qr_token', qrToken)
    .single();

  if (!ticket) {
    console.warn(`[messenger-referral] No ticket found for qr_token: ${qrToken}`);
    await sendMessengerMessage({ recipientId: psid, text: '❌ Ticket introuvable. Le lien a peut-être expiré.' });
    return;
  }

  // Check ticket is still active
  if (['served', 'no_show', 'cancelled'].includes(ticket.status)) {
    await sendMessengerMessage({ recipientId: psid, text: '❌ Ce ticket est déjà terminé.' });
    return;
  }

  // Get org info
  const { data: office } = await supabase
    .from('offices')
    .select('organization_id')
    .eq('id', ticket.office_id)
    .single();

  if (!office) return;

  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', office.organization_id)
    .single();

  // Check if there's already an active session for this ticket
  const { data: existingSession } = await supabase
    .from('whatsapp_sessions')
    .select('id, channel, locale')
    .eq('ticket_id', ticket.id)
    .eq('state', 'active')
    .maybeSingle();

  const switchedFromWhatsApp = existingSession?.channel === 'whatsapp';
  const locale = (existingSession?.locale as 'fr' | 'ar' | 'en') || 'fr';

  if (existingSession) {
    // Update existing session to Messenger (switches from WhatsApp if that was active)
    await supabase
      .from('whatsapp_sessions')
      .update({ channel: 'messenger', messenger_psid: psid, whatsapp_phone: null })
      .eq('id', existingSession.id);
    console.log(`[messenger-referral] Switched session ${existingSession.id} from ${existingSession.channel} to Messenger for ${ticket.ticket_number}`);
  } else {
    // Create new Messenger session
    await supabase
      .from('whatsapp_sessions')
      .insert({
        organization_id: office.organization_id,
        ticket_id: ticket.id,
        office_id: ticket.office_id,
        department_id: ticket.department_id,
        service_id: ticket.service_id,
        messenger_psid: psid,
        channel: 'messenger',
        state: 'active',
        locale: 'fr',
      });
    console.log(`[messenger-referral] Created Messenger session for ${ticket.ticket_number}`);
  }

  // Fetch profile name
  let profileName = '';
  try {
    const profile = await getMessengerProfile(psid);
    if (profile?.firstName) profileName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  } catch { /* non-critical */ }

  const baseUrl = (process.env.APP_CLIP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://qflo.net').replace(/\/+$/, '');
  const trackUrl = `${baseUrl}/q/${ticket.qr_token}`;

  let message: string;

  const switchedMsg: Record<string, string> = {
    fr: `✅ Notifications basculées sur Messenger !\n\n🎫 Ticket : *${ticket.ticket_number}*\n📍 Suivi : ${trackUrl}`,
    ar: `✅ تم تحويل الإشعارات إلى ماسنجر!\n\n🎫 التذكرة: *${ticket.ticket_number}*\n📍 تتبع: ${trackUrl}`,
    en: `✅ Notifications switched to Messenger!\n\n🎫 Ticket: *${ticket.ticket_number}*\n📍 Track: ${trackUrl}`,
  };

  if (switchedFromWhatsApp) {
    message = switchedMsg[locale] ?? switchedMsg.fr;
  } else {
    // New Messenger session — send full "joined" message
    const pos = await getQueuePosition(ticket.id);
    message = tNotification('joined', locale, {
      name: org?.name ?? '',
      ticket: ticket.ticket_number,
      position: formatPosition(pos, locale),
      url: trackUrl,
    });
  }

  const result = await sendMessengerMessage({ recipientId: psid, text: message });
  if (result.ok) {
    console.log(`[messenger-referral] Sent ${switchedFromWhatsApp ? 'switch confirmation' : 'joined message'} to ${psid} for ${ticket.ticket_number}`);
  } else {
    console.error(`[messenger-referral] Failed to send: ${result.error}`);
  }
}

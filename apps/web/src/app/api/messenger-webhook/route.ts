import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { handleInboundMessage, tNotification, formatPosition } from '@/lib/messaging-commands';
import { checkRateLimit, webhookLimiter } from '@/lib/rate-limit';
import {
  sendMessengerMessage,
  sendMessengerMessageWithTag,
  getMessengerProfile,
  verifyMessengerSignature,
} from '@/lib/messenger';
import { getQueuePosition } from '@/lib/queue-position';
import { APP_BASE_URL } from '@/lib/config';

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

  // Verify token must match — no fallback
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  if (mode === 'subscribe' && !verifyToken) {
    console.error('[messenger-webhook] MESSENGER_VERIFY_TOKEN not set — rejecting verification');
  } else if (mode === 'subscribe') {
    console.warn('[messenger-webhook] Token mismatch — rejecting');
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
  const blocked = await checkRateLimit(request, webhookLimiter);
  if (blocked) return blocked;

  try {
    const rawBody = await request.text();

    // Verify signature — fail closed (reject if verification fails or errors)
    const appSecret = process.env.MESSENGER_APP_SECRET?.trim();
    const signature = request.headers.get('x-hub-signature-256') ?? '';
    if (appSecret) {
      if (!signature) {
        console.warn('[messenger-webhook] Missing signature header');
        return NextResponse.json({ error: 'Missing signature' }, { status: 403 });
      }
      try {
        const isValid = verifyMessengerSignature(rawBody, signature, appSecret);
        if (!isValid) {
          console.warn('[messenger-webhook] Invalid signature');
          return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
        }
      } catch (err) {
        console.error('[messenger-webhook] Signature verification error:', err);
        return NextResponse.json({ error: 'Signature verification failed' }, { status: 403 });
      }
    } else {
      // No app secret configured — fail closed (reject unverified payloads)
      console.error('[messenger-webhook] MESSENGER_APP_SECRET not set — rejecting unverified webhook. Set the env var to enable webhook processing.');
      return NextResponse.json({ error: 'Webhook signature verification not configured' }, { status: 403 });
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
        const redactedSender = "***" + senderId.slice(-4);

        if (referralRef && typeof referralRef === 'string') {
          if (referralRef.startsWith('qflo_')) {
            const qrToken = referralRef.replace('qflo_', '');
            console.log(`[messenger-webhook] Referral from ${redactedSender}, qr_token: ${qrToken}`);
            await handleMessengerReferral(senderId, qrToken);
            continue;
          }
          if (referralRef.startsWith('JOIN_')) {
            const code = referralRef.replace('JOIN_', '');
            console.log(`[messenger-webhook] JOIN referral from ${redactedSender}, code: ${code}`);
            let profileName: string | undefined;
            try {
              const profile = await getMessengerProfile(senderId);
              if (profile?.firstName) {
                profileName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
              }
            } catch { /* non-critical */ }
            const sendFn = async ({ to, body }: { to: string; body: string }) => {
              const result = await sendMessengerMessage({ recipientId: to, text: body });
              return { ok: result.ok };
            };
            await handleInboundMessage('messenger', senderId, `JOIN ${code}`, sendFn, profileName);
            continue;
          }
        }

        // ── Text message ──
        if (event.message?.text) {
          const text = event.message.text;
          console.log(`[messenger-webhook] Message from ${redactedSender}: "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`);

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
          console.log(`[messenger-webhook] Postback from ${redactedSender}: "${payload}" referral=${JSON.stringify(event.postback?.referral ?? null)}`);

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
            // New user tapped "Get Started".
            // Route through handleInboundMessage which will:
            // - send monolingual welcome if user has a previous session locale
            // - trigger the language picker flow if user is brand new
            console.log(`[messenger-webhook] GET_STARTED from ${redactedSender}`);
            await handleInboundMessage('messenger', senderId, 'GET_STARTED', sendFn);
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
          console.log(`[messenger-webhook] OTN opt-in from ${redactedSender}, payload: ${otnPayload}`);

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
            console.log(`[messenger-webhook] Stored OTN token for ${redactedSender}`);
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

  const trackUrl = `${APP_BASE_URL}/q/${ticket.qr_token}`;
  const orgName = org?.name ?? '';
  const pos = await getQueuePosition(ticket.id);
  const positionText = formatPosition(pos, locale);

  let message: string;

  if (switchedFromWhatsApp) {
    // Switched from WhatsApp — show full details with business name, position, tracking
    const switchedMsg: Record<string, string> = {
      fr: `✅ Notifications basculées sur Messenger chez *${orgName}* !\n\n🎫 Ticket : *${ticket.ticket_number}*\n${positionText}\n\n📍 Suivi : ${trackUrl}\n\nRépondez *STATUT* pour les mises à jour ou *ANNULER* pour quitter.`,
      ar: `✅ تم تحويل الإشعارات إلى ماسنجر في *${orgName}*!\n\n🎫 التذكرة: *${ticket.ticket_number}*\n${positionText}\n\n📍 تتبع: ${trackUrl}\n\nأرسل *حالة* للتحديثات أو *إلغاء* للمغادرة.`,
      en: `✅ Notifications switched to Messenger at *${orgName}*!\n\n🎫 Ticket: *${ticket.ticket_number}*\n${positionText}\n\n📍 Track: ${trackUrl}\n\nReply *STATUS* for updates or *CANCEL* to leave.`,
    };
    message = switchedMsg[locale] ?? switchedMsg.fr;
  } else {
    // New Messenger session — send full "joined" message
    message = tNotification('joined', locale, {
      name: orgName,
      ticket: ticket.ticket_number,
      position: positionText,
      url: trackUrl,
    });
  }

  const result = await sendMessengerMessage({ recipientId: psid, text: message });
  if (result.ok) {
    console.log(`[messenger-referral] Sent ${switchedFromWhatsApp ? 'switch confirmation' : 'joined message'} to ***${psid.slice(-4)} for ${ticket.ticket_number}`);
  } else {
    console.error(`[messenger-referral] Failed to send: ${result.error}`);
  }
}

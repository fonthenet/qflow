import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { sendMessengerMessageWithTag } from '@/lib/messenger';
import { timingSafeEqual } from 'crypto';

/** Constant-time string comparison to prevent timing attacks */
function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Maximum messages per broadcast to avoid API rate limits */
const MAX_BROADCAST_BATCH = 50;

/** Format a professional broadcast message with business header */
function formatBroadcastMessage(
  body: string,
  orgName: string,
  locale: 'fr' | 'ar' | 'en',
): string {
  if (!orgName) return body;

  if (locale === 'ar') {
    return `📢 *${orgName}*\n\n${body}\n\nشكراً لكم`;
  }
  // French / default
  return `📢 *${orgName}*\n\n${body}\n\nMerci`;
}

/** Delay between individual sends (ms) to avoid throttling */
const SEND_DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** CORS headers for cross-origin requests (Electron desktop app) */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-org-id, x-user-id',
};

/** JSON response with CORS headers */
function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

/** Handle CORS preflight */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/broadcast
 *
 * Sends a custom message to all currently waiting customers via WhatsApp and Messenger.
 *
 * JSON body: { organizationId, officeId?, message, locale?, templateId? }
 *
 * Auth options:
 *   - Bearer token (service role key or webhook secret) via Authorization header
 *   - Internal call via x-org-id + x-user-id headers (from server actions)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createAdminClient();

    // ── Auth ──────────────────────────────────────────────────────
    const authHeader = request.headers.get('authorization') ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';

    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const isServiceKey = serviceKey && safeCompare(bearerToken, serviceKey);
    const isWebhookSecret = webhookSecret && safeCompare(bearerToken, webhookSecret);

    // Try Supabase JWT auth (from desktop app)
    let isJwtAuth = false;
    let jwtUserId = '';
    let jwtOrgId = '';
    if (!isServiceKey && !isWebhookSecret && bearerToken) {
      try {
        const { data: { user } } = await supabase.auth.getUser(bearerToken);
        if (user) {
          jwtUserId = user.id;
          const { data: staff } = await supabase
            .from('staff')
            .select('id, organization_id')
            .eq('auth_user_id', user.id)
            .limit(1)
            .maybeSingle();
          if (staff) {
            isJwtAuth = true;
            jwtOrgId = (staff as any).organization_id ?? '';
          }
        }
      } catch {
        // Invalid JWT, continue to other auth methods
      }
    }

    // Internal call from server action: validate x-org-id + x-user-id
    const internalOrgId = request.headers.get('x-org-id') ?? '';
    const internalUserId = request.headers.get('x-user-id') ?? '';
    let isInternalCall = false;

    if (!isServiceKey && !isWebhookSecret && !isJwtAuth && internalOrgId && internalUserId) {
      // Verify the user is a staff member of this organization
      const { data: staff } = await supabase
        .from('staff')
        .select('id, role')
        .eq('auth_user_id', internalUserId)
        .eq('organization_id', internalOrgId)
        .limit(1)
        .maybeSingle();

      if (staff) {
        isInternalCall = true;
      } else {
        console.warn('[broadcast] Internal auth failed: no staff found for user', internalUserId, 'org', internalOrgId);
      }
    }

    if (!isServiceKey && !isWebhookSecret && !isJwtAuth && !isInternalCall) {
      console.warn('[broadcast] Auth failed. Headers present: org=', !!internalOrgId, 'user=', !!internalUserId, 'bearer=', !!bearerToken);
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    console.log('[broadcast] Auth passed via:', isServiceKey ? 'serviceKey' : isWebhookSecret ? 'webhookSecret' : isJwtAuth ? 'jwt' : isInternalCall ? 'internal' : 'unknown');

    // ── Parse body ───────────────────────────────────────────────
    const body = await request.json();
    // Fall back to org ID from auth if not in body (Electron CORS may strip body)
    const organizationId = body.organizationId || jwtOrgId || internalOrgId;
    const { officeId, message, locale, templateId } = body as {
      officeId?: string;
      message?: string;
      locale?: 'fr' | 'ar' | 'en';
      templateId?: string;
    };

    console.log('[broadcast] orgId:', organizationId, 'bodyOrgId:', body.organizationId, 'jwtOrgId:', jwtOrgId, 'hasMessage:', !!message);

    if (!organizationId) {
      return jsonResponse({ error: 'Missing organizationId' }, 400);
    }
    if (!message && !templateId) {
      return jsonResponse({ error: 'Missing message or templateId' }, 400);
    }

    // ── Resolve template if provided ─────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let template: any = null;

    if (templateId) {
      const { data: tmpl } = await (supabase as any)
        .from('broadcast_templates')
        .select('id, title, body_fr, body_ar, body_en')
        .eq('id', templateId)
        .eq('organization_id', organizationId)
        .single();
      template = tmpl;
      if (!template) {
        return jsonResponse({ error: 'Template not found' }, 404);
      }
    }

    // ── Fetch organization name for professional message header ─
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .single();
    const orgName = (org as any)?.name ?? '';

    // ── Find active sessions for waiting/called tickets ──────────
    // Tickets don't have organization_id — find offices for this org first
    const { data: orgOffices } = await supabase
      .from('offices')
      .select('id, name')
      .eq('organization_id', organizationId);

    if (!orgOffices || orgOffices.length === 0) {
      return jsonResponse({ sent: 0, reason: 'no offices for organization' });
    }

    const officeIds = officeId ? [officeId] : orgOffices.map((o) => o.id);

    const { data: tickets, error: ticketError } = await supabase
      .from('tickets')
      .select('id, office_id')
      .in('office_id', officeIds)
      .in('status', ['waiting', 'called']);
    if (ticketError) {
      console.error('[broadcast] Error fetching tickets:', ticketError.message);
      return jsonResponse({ error: 'Failed to fetch tickets' }, 500);
    }

    if (!tickets || tickets.length === 0) {
      return jsonResponse({ sent: 0, reason: 'no waiting tickets' });
    }

    const ticketIds = tickets.map((t) => t.id);

    // Find active sessions linked to these tickets
    const { data: sessions, error: sessionError } = await (supabase as any)
      .from('whatsapp_sessions')
      .select('id, ticket_id, whatsapp_phone, messenger_psid, locale, channel, organization_id')
      .eq('organization_id', organizationId)
      .eq('state', 'active')
      .in('ticket_id', ticketIds);

    if (sessionError) {
      console.error('[broadcast] Error fetching sessions:', sessionError.message);
      return jsonResponse({ error: 'Failed to fetch sessions' }, 500);
    }

    if (!sessions || sessions.length === 0) {
      return jsonResponse({ sent: 0, reason: 'no active messaging sessions' });
    }

    // ── Rate limit: cap to MAX_BROADCAST_BATCH ───────────────────
    const targetSessions = sessions.slice(0, MAX_BROADCAST_BATCH);
    const skipped = sessions.length - targetSessions.length;

    console.log(`[broadcast] Sending to ${targetSessions.length} sessions (${skipped} skipped due to batch limit)`);

    // ── Send messages ────────────────────────────────────────────
    let sentCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const session of targetSessions) {
      const channel = session.channel ?? 'whatsapp';
      const sessionLocale = (session.locale as 'fr' | 'ar' | 'en') || locale || 'fr';

      // Determine message body
      let messageBody: string;
      if (template) {
        // Use locale-appropriate body from template
        const localeBody =
          (template as any)[`body_${sessionLocale}`] ||
          template.body_fr ||
          template.body_ar ||
          template.body_en ||
          '';
        messageBody = localeBody;
      } else {
        messageBody = message!;
      }

      if (!messageBody) {
        failCount++;
        errors.push(`Empty message for session ${session.id}`);
        continue;
      }

      // Wrap with professional header/footer
      messageBody = formatBroadcastMessage(messageBody, orgName, sessionLocale);

      try {
        let sent = false;

        if (channel === 'messenger' && session.messenger_psid) {
          // Send via Messenger with message tag (broadcast is outside normal conversation)
          const result = await sendMessengerMessageWithTag({
            recipientId: session.messenger_psid,
            text: messageBody,
            tag: 'CONFIRMED_EVENT_UPDATE',
          });
          sent = result.ok;
          if (!result.ok) {
            errors.push(`Messenger ${session.messenger_psid}: ${result.error}`);
          }
        } else if (channel === 'whatsapp' && session.whatsapp_phone) {
          // Send via WhatsApp
          const result = await sendWhatsAppMessage({
            to: session.whatsapp_phone,
            body: messageBody,
          });
          sent = result.ok;
          if (!result.ok) {
            errors.push(`WhatsApp ${session.whatsapp_phone}: ${result.error}`);
          }
        } else {
          errors.push(`Session ${session.id}: no valid contact info for channel ${channel}`);
          failCount++;
          continue;
        }

        if (sent) {
          sentCount++;
        } else {
          failCount++;
        }
      } catch (err: any) {
        failCount++;
        errors.push(`Session ${session.id}: ${err?.message ?? 'Unknown error'}`);
      }

      // Small delay between sends to avoid API throttling
      if (targetSessions.indexOf(session) < targetSessions.length - 1) {
        await sleep(SEND_DELAY_MS);
      }
    }

    // ── Log the broadcast ────────────────────────────────────────
    try {
      await (supabase as any).from('broadcast_logs').insert({
        organization_id: organizationId,
        office_id: officeId || null,
        template_id: templateId || null,
        message: template ? template.title : (message ?? '').slice(0, 500),
        recipients_count: sentCount,
        channel: 'all',
        sent_by: isJwtAuth ? jwtUserId : isInternalCall ? internalUserId : null,
      });
    } catch {
      // Non-critical: log table might not exist yet
      console.warn('[broadcast] Could not log to broadcast_logs (table may not exist)');
    }

    console.log(`[broadcast] Complete: sent=${sentCount}, failed=${failCount}, skipped=${skipped}`);

    return jsonResponse({
      sent: sentCount,
      failed: failCount,
      skipped,
      total: sessions.length,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (err: any) {
    console.error('[broadcast] Error:', err?.message ?? err);
    return jsonResponse({ sent: 0, error: err?.message }, 500);
  }
}

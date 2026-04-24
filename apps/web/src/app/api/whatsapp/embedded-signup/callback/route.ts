import { NextRequest, NextResponse } from 'next/server';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { encrypt } from '@/lib/crypto';
import { logAuditEvent } from '@/lib/audit';
import {
  readEmbeddedSignupEnv,
  exchangeAuthCode,
  subscribeAppToWaba,
  registerPhoneNumber,
  provisionTemplates,
  generateRegistrationPin,
} from '@/lib/whatsapp/embedded-signup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/embedded-signup/callback
 *
 * Called by the portal client once Meta's Embedded Signup popup returns
 * `{ code, waba_id, phone_number_id }`. We:
 *   1. Authorize the caller as an org admin.
 *   2. Exchange the code for a long-lived access token.
 *   3. Subscribe the Qflo app to that WABA's webhook.
 *   4. Register the phone number on Cloud API.
 *   5. Provision Qflo's template catalog on the WABA (FR/AR/EN).
 *   6. Persist credentials via upsert_org_whatsapp_credentials RPC.
 *   7. Mirror template statuses into organizations.settings (best-effort).
 *
 * Errors at any Meta step are returned as HTTP 502 with a safe message.
 * Partial success (templates mostly submitted, one failed) is still 200.
 */
export async function POST(req: NextRequest) {
  const env = readEmbeddedSignupEnv();
  if (!env) {
    return NextResponse.json(
      { error: 'Embedded Signup is not enabled on this Qflo instance.' },
      { status: 503 },
    );
  }

  let context;
  try {
    context = await getStaffContext();
    await requireOrganizationAdmin(context);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { code?: string; waba_id?: string; phone_number_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = body.code?.trim();
  const wabaId = body.waba_id?.trim();
  const phoneNumberId = body.phone_number_id?.trim();
  if (!code || !wabaId || !phoneNumberId) {
    return NextResponse.json(
      { error: 'code, waba_id, and phone_number_id are required' },
      { status: 400 },
    );
  }

  // 1. Exchange code for token
  let accessToken: string;
  try {
    const t = await exchangeAuthCode(code, env);
    accessToken = t.access_token;
  } catch (err) {
    console.error('[es:callback] token exchange failed', err);
    return NextResponse.json(
      { error: 'Failed to exchange authorization code with Meta.' },
      { status: 502 },
    );
  }

  // 2. Subscribe app to WABA
  try {
    await subscribeAppToWaba(wabaId, accessToken);
  } catch (err) {
    console.error('[es:callback] subscribed_apps failed', err);
    return NextResponse.json(
      { error: 'Could not subscribe Qflo to your WhatsApp Business Account.' },
      { status: 502 },
    );
  }

  // 3. Register phone number
  const pin = generateRegistrationPin();
  try {
    await registerPhoneNumber(phoneNumberId, pin, accessToken);
  } catch (err) {
    console.error('[es:callback] phone register failed', err);
    return NextResponse.json(
      {
        error:
          'Phone number registration failed. It may still be active on the WhatsApp consumer app — remove it there and retry.',
      },
      { status: 502 },
    );
  }

  // 4. Provision templates (best-effort: partial failures don't block save)
  let templateStatuses: Record<string, unknown> = {};
  let templatesSubmitted = 0;
  let templatesAttempted = 0;
  try {
    const result = await provisionTemplates(wabaId, accessToken);
    templateStatuses = result.statuses;
    templatesSubmitted = result.submitted;
    templatesAttempted = result.attempted;
  } catch (err) {
    console.error('[es:callback] provisionTemplates threw', err);
    // keep going — credentials still save
  }

  // 5. Persist credentials
  let encryptedToken: string;
  try {
    encryptedToken = await encrypt(accessToken);
  } catch {
    return NextResponse.json(
      { error: 'Failed to secure access token. Check server configuration.' },
      { status: 500 },
    );
  }

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || '';

  const orgId = context.staff.organization_id;
  const { error: rpcError } = await context.supabase.rpc(
    'upsert_org_whatsapp_credentials',
    {
      p_org_id: orgId,
      p_phone_number_id: phoneNumberId,
      p_access_token_encrypted: encryptedToken,
      p_business_account_id: wabaId,
      p_verify_token: verifyToken,
    },
  );
  if (rpcError) {
    console.error('[es:callback] rpc failed', rpcError.code, rpcError.message);
    return NextResponse.json(
      { error: 'Failed to save credentials. Please try again.' },
      { status: 500 },
    );
  }

  // 6. Mirror template statuses + metadata into settings JSONB (best-effort)
  try {
    const { data: orgRow } = await context.supabase
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .single();
    const current = (orgRow as any)?.settings ?? {};
    const nextSettings = {
      ...current,
      whatsapp_template_statuses: templateStatuses,
      whatsapp_registration_pin: pin,
      whatsapp_embedded_signup_at: new Date().toISOString(),
    };
    await context.supabase
      .from('organizations')
      .update({ settings: nextSettings })
      .eq('id', orgId);
  } catch (err) {
    console.error('[es:callback] settings mirror failed', err);
  }

  try {
    await logAuditEvent(context, {
      actionType: 'whatsapp_embedded_signup',
      entityType: 'organization',
      entityId: orgId,
      summary: 'WhatsApp connected via Embedded Signup',
      metadata: {
        phone_number_id: phoneNumberId,
        business_account_id: wabaId,
        templates_submitted: templatesSubmitted,
        templates_attempted: templatesAttempted,
      },
    });
  } catch {
    // non-fatal
  }

  return NextResponse.json({
    ok: true,
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    templates: {
      attempted: templatesAttempted,
      submitted: templatesSubmitted,
      statuses: templateStatuses,
    },
  });
}

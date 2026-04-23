'use server';

import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { encrypt } from '@/lib/crypto';
import { logAuditEvent } from '@/lib/audit';
import { createClient as createServerClient } from '@/lib/supabase/server';

export interface WhatsAppCredentialsPayload {
  phone_number_id: string;
  access_token: string; // plaintext — encrypted here before DB write
  business_account_id: string;
  verify_token: string;
}

export interface WhatsAppSaveResult {
  ok: boolean;
  error?: string;
}

export async function saveWhatsAppCredentials(
  payload: WhatsAppCredentialsPayload,
): Promise<WhatsAppSaveResult> {
  let context;
  try {
    context = await getStaffContext();
    await requireOrganizationAdmin(context);
  } catch {
    return { ok: false, error: 'Unauthorized' };
  }

  const { phone_number_id, access_token, business_account_id, verify_token } = payload;

  if (!phone_number_id.trim() || !access_token.trim() || !business_account_id.trim() || !verify_token.trim()) {
    return { ok: false, error: 'All fields are required.' };
  }

  let encryptedToken: string;
  try {
    encryptedToken = await encrypt(access_token);
  } catch {
    // Do not surface encryption internals
    return { ok: false, error: 'Failed to secure access token. Check server configuration.' };
  }

  const orgId = context.staff.organization_id;

  // Call the SECURITY DEFINER function (avoids direct column write via RLS).
  const { error: rpcError } = await context.supabase.rpc('upsert_org_whatsapp_credentials', {
    p_org_id: orgId,
    p_phone_number_id: phone_number_id.trim(),
    p_access_token_encrypted: encryptedToken,
    p_business_account_id: business_account_id.trim(),
    p_verify_token: verify_token.trim(),
  });

  if (rpcError) {
    // Never log token; only log the error code/message
    console.error('[whatsapp-actions] upsert_org_whatsapp_credentials failed:', rpcError.code, rpcError.message);
    return { ok: false, error: 'Failed to save credentials. Please try again.' };
  }

  // Audit log — never include the token value
  try {
    await logAuditEvent(context, {
      actionType: 'whatsapp_credentials_updated',
      entityType: 'organization',
      entityId: orgId,
      summary: 'WhatsApp Business API credentials updated',
      metadata: {
        phone_number_id: phone_number_id.trim(),
        business_account_id: business_account_id.trim(),
      },
    });
  } catch {
    // Audit failure is non-fatal
  }

  return { ok: true };
}

export interface WhatsAppCredentialsStatus {
  phone_number_id: string | null;
  business_account_id: string | null;
  verify_token: string | null;
  has_token: boolean;
}

export async function loadWhatsAppCredentials(): Promise<WhatsAppCredentialsStatus | { error: string }> {
  let context;
  try {
    context = await getStaffContext();
    await requireOrganizationAdmin(context);
  } catch {
    return { error: 'Unauthorized' };
  }

  // Use a fresh server client (service-level read of the org row).
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('organizations')
    .select('whatsapp_phone_number_id, whatsapp_access_token_encrypted, whatsapp_business_account_id, whatsapp_verify_token')
    .eq('id', context.staff.organization_id)
    .single();

  if (error || !data) {
    return { error: 'Failed to load credentials.' };
  }

  return {
    phone_number_id: data.whatsapp_phone_number_id ?? null,
    business_account_id: data.whatsapp_business_account_id ?? null,
    verify_token: data.whatsapp_verify_token ?? null,
    // Never return the decrypted token — only signal its presence
    has_token: !!data.whatsapp_access_token_encrypted,
  };
}

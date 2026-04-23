import { NextResponse } from 'next/server';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import { decrypt } from '@/lib/crypto';
import { checkRateLimit, authLimiter } from '@/lib/rate-limit';
import { createClient as createServerClient } from '@/lib/supabase/server';

export async function POST(request: Request): Promise<NextResponse> {
  // Rate-limit: 10 req/60s per IP (re-uses authLimiter tier)
  const limited = await checkRateLimit(request, authLimiter);
  if (limited) return limited;

  let context;
  try {
    context = await getStaffContext();
    await requireOrganizationAdmin(context);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { phone_number_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const phoneNumberId = body.phone_number_id?.trim();
  if (!phoneNumberId) {
    return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 });
  }

  // Fetch encrypted token server-side — never returned to the client
  const supabase = await createServerClient();
  const { data, error: fetchError } = await supabase
    .from('organizations')
    .select('whatsapp_access_token_encrypted, whatsapp_phone_number_id')
    .eq('id', context.staff.organization_id)
    .single();

  if (fetchError || !data?.whatsapp_access_token_encrypted) {
    return NextResponse.json(
      { error: 'No WhatsApp token configured. Save credentials first.' },
      { status: 400 },
    );
  }

  // Confirm the phone_number_id matches what's stored (prevents probing other orgs)
  if (data.whatsapp_phone_number_id !== phoneNumberId) {
    return NextResponse.json(
      { error: 'Phone number ID does not match saved credentials.' },
      { status: 400 },
    );
  }

  let accessToken: string;
  try {
    accessToken = await decrypt(data.whatsapp_access_token_encrypted);
  } catch {
    // Do not surface decrypt errors — could indicate key mismatch
    return NextResponse.json({ error: 'Failed to read stored credentials.' }, { status: 500 });
  }

  // Test against Meta Graph API
  let graphRes: Response;
  try {
    graphRes = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        // Abort after 8 seconds to avoid holding the serverless function
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : 'Network error';
    return NextResponse.json({ error: `Meta API unreachable: ${msg}` }, { status: 502 });
  } finally {
    // Ensure the token reference is cleared from this scope
    accessToken = '';
  }

  if (!graphRes.ok) {
    const errBody = await graphRes.json().catch(() => ({})) as { error?: { message?: string } };
    // Never log the token, only the error message
    return NextResponse.json(
      { error: errBody?.error?.message ?? `Meta returned HTTP ${graphRes.status}` },
      { status: 400 },
    );
  }

  const result = await graphRes.json() as { display_phone_number?: string; verified_name?: string; id?: string };
  return NextResponse.json({
    ok: true,
    name: result.verified_name ?? result.display_phone_number ?? result.id ?? 'Connected',
  });
}

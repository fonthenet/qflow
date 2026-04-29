import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { normalizePhone } from '@qflo/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Riders directory — lightweight in-house delivery roster.
 *
 *   GET  /api/riders?organization_id=…    List active riders.
 *   POST /api/riders                      Create a new rider.
 *                                         body: { name, phone, organization_id, country? }
 *
 * Auth: Authorization: Bearer <token>. Three accepted token shapes:
 *   - Supabase staff JWT (validated via auth.getUser)
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - INTERNAL_WEBHOOK_SECRET
 *
 * Org scope is verified server-side: callers must pass an
 * organization_id that matches their staff row's org. Service-role
 * callers can pass any org (used by internal cron / setup tasks).
 */

async function resolveOrgId(request: NextRequest, providedOrgId: string | null): Promise<string | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return providedOrgId;
  if (webhookSecret && safeCompare(token, webhookSecret)) return providedOrgId;

  // Staff JWT path — validate the token against Supabase, look up
  // the user's org via the staff table, and verify it matches the
  // caller-claimed orgId (if any).
  const supabase = createAdminClient() as any;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const myOrg = staff?.organization_id ?? null;
  if (!myOrg) return null;
  // If the caller passed an explicit org id, it must match theirs —
  // prevents an admin from one business mutating another's riders by
  // guessing IDs.
  if (providedOrgId && providedOrgId !== myOrg) return null;
  return myOrg;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const claimedOrg = url.searchParams.get('organization_id');
  const orgId = await resolveOrgId(request, claimedOrg);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient() as any;
  const { data, error } = await supabase
    .from('riders')
    .select('id, name, phone, is_active, last_seen_at, created_at')
    .eq('organization_id', orgId)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, riders: data ?? [] });
}

export async function POST(request: NextRequest) {
  let body: { name?: string; phone?: string; country?: string; organization_id?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const orgId = await resolveOrgId(request, body.organization_id ?? null);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const name = body.name?.trim();
  const rawPhone = body.phone?.trim();
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 });
  if (!rawPhone) return NextResponse.json({ ok: false, error: 'phone required' }, { status: 400 });

  // Normalise to E.164 (no leading +) so it matches what the WA
  // webhook gives us as `from`. normalizePhone handles country guess
  // from the org's timezone if no country prefix is supplied.
  const supabase = createAdminClient() as any;
  // Resolve country from the org's timezone for phone normalisation
  // when the caller didn't supply one.
  let country: string | undefined = body.country;
  if (!country) {
    const { data: org } = await supabase
      .from('organizations').select('timezone').eq('id', orgId).maybeSingle();
    country = org?.timezone ?? undefined;
  }
  const phone = normalizePhone(rawPhone, country) ?? rawPhone;

  // INSERT with ON CONFLICT (organization_id, phone) → reactivate +
  // update name. Treats "add an existing inactive rider again" as a
  // re-activation rather than an error.
  const { data, error } = await supabase
    .from('riders')
    .upsert(
      {
        organization_id: orgId,
        name,
        phone,
        is_active: true,
      },
      { onConflict: 'organization_id,phone' },
    )
    .select('id, name, phone, is_active, last_seen_at, created_at')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rider: data });
}

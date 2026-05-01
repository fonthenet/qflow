import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { resolveRestaurantServiceType } from '@qflo/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/organization/restaurant-tables
 *
 * Atomic master switch for the dine-in / table-seating flow on a
 * restaurant or cafe. Flips the org-level setting AND propagates the
 * effect to the dine-in service so every consumer that filters by
 * `services.is_active = true` (WhatsApp ordering, kiosk menu, web
 * menu, Station Order Pad) automatically excludes/includes it.
 *
 *   body: { organization_id: string, enabled: boolean }
 *
 *   - settings.restaurant_tables_enabled = enabled
 *   - For every service classified as 'dine_in' (via resolveRestaurantServiceType):
 *       services.is_active = enabled
 *
 * Auth: Authorization: Bearer <staff JWT | service-role | webhook secret>.
 * Org scope verified — staff can only flip their own org.
 */

async function resolveOrgId(request: NextRequest, providedOrgId: string | null): Promise<string | null> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return providedOrgId;
  if (webhookSecret && safeCompare(token, webhookSecret)) return providedOrgId;

  const supabase = createAdminClient() as any;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: staff } = await supabase
    .from('staff').select('organization_id, role')
    .eq('auth_user_id', user.id).maybeSingle();
  const myOrg = staff?.organization_id ?? null;
  if (!myOrg) return null;
  if (providedOrgId && providedOrgId !== myOrg) return null;
  // Only admin/manager can flip an org-wide setting; rank-and-file
  // staff don't get to disable dine-in.
  if (!['admin', 'owner', 'manager'].includes((staff?.role ?? '').toLowerCase())) {
    return null;
  }
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
  const { data: org } = await supabase
    .from('organizations').select('settings').eq('id', orgId).maybeSingle();
  // Default to true when unset — restaurants created before this feature
  // existed should behave as if dine-in is enabled.
  const enabled = (org?.settings?.restaurant_tables_enabled as boolean | undefined) ?? true;
  return NextResponse.json({ ok: true, enabled });
}

export async function POST(request: NextRequest) {
  let body: { organization_id?: string; enabled?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const orgId = await resolveOrgId(request, body.organization_id ?? null);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'enabled (boolean) required' }, { status: 400 });
  }

  const supabase = createAdminClient() as any;

  // 1. Merge the new value into org.settings (preserving everything else).
  const { data: orgRow, error: orgErr } = await supabase
    .from('organizations').select('settings').eq('id', orgId).maybeSingle();
  if (orgErr || !orgRow) {
    return NextResponse.json({ ok: false, error: 'Organization not found' }, { status: 404 });
  }
  const nextSettings = {
    ...(orgRow.settings as Record<string, unknown>),
    restaurant_tables_enabled: body.enabled,
  };
  const { error: updErr } = await supabase
    .from('organizations').update({ settings: nextSettings }).eq('id', orgId);
  if (updErr) {
    return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
  }

  // 2. Find every dine-in service across all of this org's offices and
  //    flip is_active. We classify by name (resolveRestaurantServiceType)
  //    rather than a stored "type" column — operators rename services
  //    freely, but the regex catches "Dine-in", "Sur place", "Surplace",
  //    "تناول في المطعم", etc.
  const { data: offices } = await supabase
    .from('offices').select('id').eq('organization_id', orgId);
  const officeIds = (offices ?? []).map((o: any) => o.id);
  if (officeIds.length > 0) {
    const { data: depts } = await supabase
      .from('departments').select('id').in('office_id', officeIds);
    const deptIds = (depts ?? []).map((d: any) => d.id);
    if (deptIds.length > 0) {
      const { data: services } = await supabase
        .from('services').select('id, name').in('department_id', deptIds);
      const dineInIds = (services ?? [])
        .filter((s: any) => resolveRestaurantServiceType(s.name) === 'dine_in')
        .map((s: any) => s.id);
      if (dineInIds.length > 0) {
        await supabase
          .from('services')
          .update({ is_active: body.enabled })
          .in('id', dineInIds);
      }
    }
  }

  return NextResponse.json({ ok: true, enabled: body.enabled });
}

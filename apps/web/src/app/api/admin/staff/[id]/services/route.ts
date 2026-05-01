import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET  /api/admin/staff/:id/services      List service ids this staff can perform.
 * POST /api/admin/staff/:id/services      Replace the set with the supplied service_ids.
 *                                          body: { service_ids: string[] }
 *
 * "Empty set" semantics: when no rows exist for a stylist we treat
 * them as able to do every service. This is the single-chair-shop
 * default — operator only adds rows when they want to specialize.
 *
 * Auth: staff JWT scoped to the same org as the target staff row,
 * with role admin/owner/manager. Service-role + webhook-secret bypass
 * for cron / setup tasks.
 */

async function authorize(request: NextRequest, targetStaffId: string): Promise<{ ok: boolean; isService?: boolean }> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return { ok: true, isService: true };
  if (webhookSecret && safeCompare(token, webhookSecret)) return { ok: true, isService: true };

  const supabase = createAdminClient() as any;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { ok: false };
  const { data: caller } = await supabase
    .from('staff').select('organization_id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!caller) return { ok: false };
  if (!['admin', 'owner', 'manager'].includes((caller.role ?? '').toLowerCase())) {
    return { ok: false };
  }
  // Verify the target belongs to the caller's org — admin in org A
  // must not edit staff in org B.
  const { data: target } = await supabase
    .from('staff').select('organization_id').eq('id', targetStaffId).maybeSingle();
  if (!target || target.organization_id !== caller.organization_id) return { ok: false };
  return { ok: true };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const z = await authorize(request, id);
  if (!z.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const supabase = createAdminClient() as any;
  const { data, error } = await supabase
    .from('staff_services')
    .select('service_id, is_active')
    .eq('staff_id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const serviceIds = (data ?? [])
    .filter((r: any) => r.is_active !== false)
    .map((r: any) => r.service_id);
  return NextResponse.json({ ok: true, service_ids: serviceIds });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const z = await authorize(request, id);
  if (!z.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body: { service_ids?: string[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const incoming = Array.isArray(body.service_ids)
    ? body.service_ids.filter((s) => typeof s === 'string') as string[]
    : [];

  const supabase = createAdminClient() as any;

  // Replace-set strategy: delete all rows for this staff that aren't in
  // the new set, upsert the new ones. Cleaner than diff-and-patch and
  // perfectly fine at the typical scale (a salon has <30 services).
  if (incoming.length === 0) {
    // Empty set = "can do everything" fallback. Wipe the rows.
    const { error: delErr } = await supabase
      .from('staff_services').delete().eq('staff_id', id);
    if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, service_ids: [] });
  }

  // Drop rows that are no longer selected.
  const { error: delErr } = await supabase
    .from('staff_services')
    .delete()
    .eq('staff_id', id)
    .not('service_id', 'in', `(${incoming.map((s) => `"${s}"`).join(',')})`);
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });

  // Upsert the (now-correct) set. ON CONFLICT (staff_id, service_id) → no-op.
  const { error: upErr } = await supabase
    .from('staff_services')
    .upsert(
      incoming.map((sid) => ({ staff_id: id, service_id: sid, is_active: true })),
      { onConflict: 'staff_id,service_id', ignoreDuplicates: false },
    );
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, service_ids: incoming });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';
import { normalizePhone } from '@qflo/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Per-rider mutations.
 *
 *   PATCH  /api/riders/:id   Edit name/phone, toggle active.
 *                            body: { name?, phone?, is_active?, country? }
 *   DELETE /api/riders/:id   Soft-delete (sets is_active=false).
 *
 * Auth: Authorization: Bearer <token> — staff JWT, service-role,
 * or webhook-secret. Org scope verified by comparing caller's org
 * to the existing rider's organization_id.
 */

async function resolveOrgId(request: NextRequest): Promise<{ orgId: string | null; isServiceRole: boolean }> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { orgId: null, isServiceRole: false };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return { orgId: null, isServiceRole: true };
  if (webhookSecret && safeCompare(token, webhookSecret)) return { orgId: null, isServiceRole: true };

  const supabase = createAdminClient() as any;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { orgId: null, isServiceRole: false };
  // Staff table links to auth.users via auth_user_id (NOT user_id).
  const { data: staff } = await supabase
    .from('staff').select('organization_id').eq('auth_user_id', user.id).maybeSingle();
  return { orgId: staff?.organization_id ?? null, isServiceRole: false };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, isServiceRole } = await resolveOrgId(request);
  if (!orgId && !isServiceRole) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: string; phone?: string; is_active?: boolean; country?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const supabase = createAdminClient() as any;

  // Fetch existing rider to verify org scope.
  const { data: existing } = await supabase
    .from('riders')
    .select('id, organization_id, phone')
    .eq('id', id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'Rider not found' }, { status: 404 });
  }
  if (!isServiceRole && existing.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const patch: Record<string, any> = {};
  if (typeof body.name === 'string') {
    const n = body.name.trim();
    if (!n) return NextResponse.json({ ok: false, error: 'name cannot be empty' }, { status: 400 });
    patch.name = n;
  }
  if (typeof body.phone === 'string') {
    const p = body.phone.trim();
    if (!p) return NextResponse.json({ ok: false, error: 'phone cannot be empty' }, { status: 400 });
    // Derive country from the org (same as POST /api/riders).
    const { data: org } = await supabase
      .from('organizations').select('country, timezone').eq('id', existing.organization_id).maybeSingle();
    patch.phone = normalizePhone(p, org?.timezone ?? null, org?.country ?? null) ?? p;
  }
  if (typeof body.is_active === 'boolean') {
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'no fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('riders')
    .update(patch)
    .eq('id', id)
    .select('id, name, phone, is_active, last_seen_at, created_at, updated_at')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rider: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { orgId, isServiceRole } = await resolveOrgId(request);
  if (!orgId && !isServiceRole) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient() as any;
  const { data: existing } = await supabase
    .from('riders').select('id, organization_id').eq('id', id).maybeSingle();
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'Rider not found' }, { status: 404 });
  }
  if (!isServiceRole && existing.organization_id !== orgId) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  // Soft-delete only. Historical assignments keep referencing this row.
  const { error } = await supabase
    .from('riders')
    .update({ is_active: false })
    .eq('id', id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

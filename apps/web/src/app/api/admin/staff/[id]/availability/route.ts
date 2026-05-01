import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/staff/:id/availability
 *   body: { status: 'available' | 'on_break' | 'off',
 *           until?: ISO string | null,
 *           note?: string | null }
 *
 * Updates the operational on-floor status. Distinct from is_active,
 * which is the HR-level "can sign in" gate.
 *
 * Auth scoping is more permissive than the matrix endpoint:
 *   - Admin/owner/manager can flip ANY stylist in their org
 *   - A stylist can flip THEIR OWN status (so they can pause from
 *     their own Station session without bothering an admin)
 * Service-role + webhook-secret bypass for cron / setup tasks.
 */

async function authorize(request: NextRequest, targetStaffId: string): Promise<{ ok: boolean }> {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { ok: false };
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const webhookSecret = process.env.INTERNAL_WEBHOOK_SECRET ?? '';
  if (serviceKey && safeCompare(token, serviceKey)) return { ok: true };
  if (webhookSecret && safeCompare(token, webhookSecret)) return { ok: true };

  const supabase = createAdminClient() as any;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return { ok: false };
  const { data: caller } = await supabase
    .from('staff').select('id, organization_id, role').eq('auth_user_id', user.id).maybeSingle();
  if (!caller) return { ok: false };

  // Self-flip path — any active staff member can pause themselves.
  if (caller.id === targetStaffId) return { ok: true };

  // Admin path — must be admin/owner/manager AND in the same org as
  // the target stylist.
  if (!['admin', 'owner', 'manager'].includes((caller.role ?? '').toLowerCase())) {
    return { ok: false };
  }
  const { data: target } = await supabase
    .from('staff').select('organization_id').eq('id', targetStaffId).maybeSingle();
  if (!target || target.organization_id !== caller.organization_id) return { ok: false };
  return { ok: true };
}

const VALID_STATUSES = new Set(['available', 'on_break', 'off']);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const z = await authorize(request, id);
  if (!z.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body: { status?: string; until?: string | null; note?: string | null };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const status = (body.status ?? '').trim();
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ ok: false, error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
  }

  // Validate until — must be a parseable ISO string in the future
  // when status is 'on_break' (typical use case). For 'available' and
  // 'off' we ignore any until value entirely.
  let until: string | null = null;
  if (status === 'on_break' && typeof body.until === 'string') {
    const t = Date.parse(body.until);
    if (Number.isFinite(t)) until = new Date(t).toISOString();
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) || null : null;

  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from('staff')
    .update({
      availability_status: status,
      availability_until: until,
      availability_note: note,
    })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status, until, note });
}

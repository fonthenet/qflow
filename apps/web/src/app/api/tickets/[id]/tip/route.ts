import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { safeCompare } from '@/lib/crypto-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/tickets/:id/tip
 *   body: { amount_cents: number, tipped_staff_id?: string | null }
 *
 * Records a salon tip on a ticket. Idempotent — calling it again with
 * the same values is a no-op; calling with a different amount overwrites.
 *
 * Auth: staff JWT scoped to the ticket's office's organization, or
 * service-role / webhook-secret bypass.
 */

async function authorize(request: NextRequest, ticketId: string): Promise<{ ok: boolean; orgId?: string | null }> {
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
    .from('staff').select('organization_id').eq('auth_user_id', user.id).maybeSingle();
  if (!caller) return { ok: false };

  // Cross-check the ticket belongs to the caller's org via offices.
  const { data: ticket } = await supabase
    .from('tickets').select('office_id').eq('id', ticketId).maybeSingle();
  if (!ticket?.office_id) return { ok: false };
  const { data: office } = await supabase
    .from('offices').select('organization_id').eq('id', ticket.office_id).maybeSingle();
  if (!office || office.organization_id !== caller.organization_id) return { ok: false };
  return { ok: true, orgId: caller.organization_id };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const z = await authorize(request, id);
  if (!z.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });

  let body: { amount_cents?: unknown; tipped_staff_id?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  const amount = Number(body.amount_cents);
  // Sanity bounds — anything > 1,000,000 minor units (10,000 DA) is
  // almost certainly a mistake, anything < 0 is nonsense.
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    return NextResponse.json({ ok: false, error: 'amount_cents must be a non-negative integer ≤ 1,000,000' }, { status: 400 });
  }
  const tippedStaffId = typeof body.tipped_staff_id === 'string' && body.tipped_staff_id
    ? body.tipped_staff_id
    : null;

  const supabase = createAdminClient() as any;
  const { error } = await supabase
    .from('tickets')
    .update({
      tip_amount_cents: Math.round(amount),
      tipped_staff_id: tippedStaffId,
    })
    .eq('id', id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Audit event for analytics + commission roll-ups.
  await supabase.from('ticket_events').insert({
    ticket_id: id,
    event_type: 'tipped',
    metadata: {
      amount_cents: Math.round(amount),
      tipped_staff_id: tippedStaffId,
    },
    source: 'tip_endpoint',
  }).then(() => {}, () => {});

  return NextResponse.json({ ok: true, amount_cents: Math.round(amount), tipped_staff_id: tippedStaffId });
}

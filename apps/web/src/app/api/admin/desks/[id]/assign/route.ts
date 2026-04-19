import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

/**
 * Assign (or unassign) staff to a desk.
 * Body: { caller_user_id, organization_id, staff_id | null, allow_office_change? }
 * Mirrors the semantics of `assignStaffToDesk` in admin-actions.ts:
 *  - enforces 1-staff-per-desk invariant
 *  - cross-office guard (returns 409 + { crossOffice, targetOfficeId }) unless allow_office_change
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: deskId } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    caller_user_id,
    organization_id,
    staff_id,
    allow_office_change,
  } = body ?? {};

  const supabase = createAdminClient();

  let caller;
  try {
    caller = await resolveAdminCaller(supabase, caller_user_id, organization_id);
  } catch (e) {
    if (e instanceof AdminApiAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  // Load desk
  const { data: desk } = await supabase
    .from('desks')
    .select('id, name, is_active, office_id, current_staff_id, office:offices(id, is_active, organization_id)')
    .eq('id', deskId)
    .maybeSingle();
  const deskOffice = Array.isArray((desk as any)?.office)
    ? (desk as any).office[0]
    : (desk as any)?.office;
  if (!desk || !deskOffice || deskOffice.organization_id !== caller.organization_id) {
    return NextResponse.json({ error: 'Desk not found in this organization' }, { status: 404 });
  }

  // Unassign path
  if (!staff_id) {
    if (!desk.current_staff_id) {
      return NextResponse.json({ success: true });
    }
    const prevStaffId = desk.current_staff_id;
    const { error } = await supabase
      .from('desks')
      .update({ current_staff_id: null } as any)
      .eq('id', deskId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await logApiAudit(supabase, caller, {
      action_type: 'desk_staff_unassigned',
      entity_type: 'desk',
      entity_id: deskId,
      office_id: desk.office_id,
      summary: `Unassigned staff from desk ${desk.name}`,
      metadata: { staff_id: prevStaffId },
    });
    return NextResponse.json({ success: true });
  }

  // Assign path — validate staff
  const { data: staff } = await supabase
    .from('staff')
    .select('id, full_name, organization_id, office_id, is_active')
    .eq('id', staff_id)
    .maybeSingle();
  if (!staff || staff.organization_id !== caller.organization_id) {
    return NextResponse.json({ error: 'Team member not found in your organization' }, { status: 404 });
  }
  if (!staff.is_active) {
    return NextResponse.json(
      { error: 'This team member is inactive. Reactivate them before assigning a desk.' },
      { status: 400 }
    );
  }
  if (desk.is_active === false) {
    return NextResponse.json(
      { error: 'This desk is inactive. Reactivate it before assigning someone.' },
      { status: 400 }
    );
  }
  if (deskOffice.is_active === false) {
    return NextResponse.json(
      { error: 'Cannot assign to a desk in a closed office.' },
      { status: 400 }
    );
  }

  // No-op
  if (desk.current_staff_id === staff_id) {
    return NextResponse.json({ success: true });
  }

  const crossOffice = !!staff.office_id && staff.office_id !== desk.office_id;
  if (crossOffice && !allow_office_change) {
    return NextResponse.json(
      {
        error: 'CROSS_OFFICE',
        crossOffice: true,
        targetOfficeId: desk.office_id,
      },
      { status: 409 }
    );
  }

  // Free whichever desk this staff currently holds
  await supabase
    .from('desks')
    .update({ current_staff_id: null } as any)
    .eq('current_staff_id', staff_id);

  // Free the target desk if someone else is on it
  if (desk.current_staff_id && desk.current_staff_id !== staff_id) {
    await supabase
      .from('desks')
      .update({ current_staff_id: null } as any)
      .eq('id', deskId);
  }

  const { error: assignErr } = await supabase
    .from('desks')
    .update({ current_staff_id: staff_id } as any)
    .eq('id', deskId);
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  if (crossOffice && allow_office_change) {
    await supabase
      .from('staff')
      .update({ office_id: desk.office_id } as any)
      .eq('id', staff_id);
  }

  await logApiAudit(supabase, caller, {
    action_type: 'desk_staff_assigned',
    entity_type: 'desk',
    entity_id: deskId,
    office_id: desk.office_id,
    summary: `Assigned ${staff.full_name} to desk ${desk.name}`,
    metadata: {
      staff_id,
      cross_office: crossOffice,
      previous_office_id: staff.office_id,
      previous_occupant_id: desk.current_staff_id ?? null,
    },
  });

  return NextResponse.json({ success: true });
}

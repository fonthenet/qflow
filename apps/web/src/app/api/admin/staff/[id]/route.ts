import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

async function loadStaffInOrg(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  organizationId: string
) {
  const { data: staff } = await supabase
    .from('staff')
    .select('id, auth_user_id, organization_id, office_id, department_id, full_name, role, email, is_active')
    .eq('id', id)
    .maybeSingle();
  if (!staff || staff.organization_id !== organizationId) return null;
  return staff;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    caller_user_id,
    organization_id,
    full_name,
    role,
    office_id,
    department_id,
    is_active,
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

  const existing = await loadStaffInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Staff not found in this organization' }, { status: 404 });
  }

  // Validate office if provided (and department via office)
  if (office_id) {
    const { data: office } = await supabase
      .from('offices')
      .select('id, organization_id')
      .eq('id', office_id)
      .maybeSingle();
    if (!office || office.organization_id !== caller.organization_id) {
      return NextResponse.json({ error: 'Invalid office' }, { status: 400 });
    }
  }
  if (department_id) {
    const { data: dept } = await supabase
      .from('departments')
      .select('id, office_id, office:offices(id, organization_id)')
      .eq('id', department_id)
      .maybeSingle();
    const deptOffice = Array.isArray((dept as any)?.office)
      ? (dept as any).office[0]
      : (dept as any)?.office;
    if (!dept || !deptOffice || deptOffice.organization_id !== caller.organization_id) {
      return NextResponse.json({ error: 'Invalid department' }, { status: 400 });
    }
    if (office_id && dept.office_id && dept.office_id !== office_id) {
      return NextResponse.json(
        { error: 'Department does not belong to the selected office' },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (full_name !== undefined) update.full_name = full_name;
  if (role !== undefined) update.role = role;
  if (office_id !== undefined) update.office_id = office_id || null;
  if (department_id !== undefined) update.department_id = department_id || null;
  if (is_active !== undefined) update.is_active = is_active;

  const { data: staffMember, error } = await supabase
    .from('staff')
    .update(update as any)
    .eq('id', id)
    .select('id, full_name, office_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'staff_updated',
    entity_type: 'staff',
    entity_id: staffMember.id,
    office_id: staffMember.office_id,
    summary: `Updated staff member ${staffMember.full_name}`,
    metadata: {
      previous_office_id: existing.office_id,
      next_office_id: staffMember.office_id,
      previous_role: existing.role,
      next_role: role,
    },
  });

  return NextResponse.json({ success: true, data: staffMember });
}

/**
 * Deactivate (NOT hard-delete) the staff row. Auth user is preserved so the
 * admin can reactivate later without re-creating the login.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { caller_user_id, organization_id } = body ?? {};

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

  const existing = await loadStaffInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Staff not found in this organization' }, { status: 404 });
  }

  // Self-guard: don't let an admin deactivate themselves via this endpoint.
  if (existing.id === caller.id) {
    return NextResponse.json(
      { error: 'You cannot deactivate your own account.' },
      { status: 400 }
    );
  }

  // Free any desk this staff holds, so nothing references them.
  await supabase
    .from('desks')
    .update({ current_staff_id: null } as any)
    .eq('current_staff_id', id);

  const { error } = await supabase
    .from('staff')
    .update({ is_active: false } as any)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'staff_deactivated',
    entity_type: 'staff',
    entity_id: id,
    office_id: existing.office_id,
    summary: `Deactivated staff member ${existing.full_name}`,
    metadata: { email: existing.email, role: existing.role },
  });

  return NextResponse.json({ success: true });
}

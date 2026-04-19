import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

async function loadDeskInOrg(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  organizationId: string
) {
  const { data: desk } = await supabase
    .from('desks')
    .select('id, name, office_id, department_id, office:offices(id, organization_id)')
    .eq('id', id)
    .maybeSingle();
  const office = Array.isArray((desk as any)?.office)
    ? (desk as any).office[0]
    : (desk as any)?.office;
  if (!desk || !office || office.organization_id !== organizationId) return null;
  return desk;
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
    name,
    display_name,
    office_id,
    department_id,
    current_staff_id,
    status,
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

  const existing = await loadDeskInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Desk not found in this organization' }, { status: 404 });
  }

  const effectiveOfficeId = (office_id ?? existing.office_id) as string;
  const effectiveDeptId = (department_id ?? existing.department_id) as string;

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

  if (department_id || office_id) {
    const { data: dept } = await supabase
      .from('departments')
      .select('id, office_id')
      .eq('id', effectiveDeptId)
      .maybeSingle();
    if (!dept || dept.office_id !== effectiveOfficeId) {
      return NextResponse.json(
        { error: 'Department does not belong to the selected office' },
        { status: 400 }
      );
    }
  }

  if (current_staff_id) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id, organization_id, office_id')
      .eq('id', current_staff_id)
      .maybeSingle();
    if (!staff || staff.organization_id !== caller.organization_id) {
      return NextResponse.json({ error: 'Assigned staff not found in this organization' }, { status: 400 });
    }
    if (staff.office_id && staff.office_id !== effectiveOfficeId) {
      return NextResponse.json(
        { error: 'Assigned staff must belong to the same office' },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (display_name !== undefined) update.display_name = display_name || null;
  if (office_id !== undefined) update.office_id = office_id;
  if (department_id !== undefined) update.department_id = department_id;
  if (current_staff_id !== undefined) update.current_staff_id = current_staff_id || null;
  if (status !== undefined) update.status = status;
  if (is_active !== undefined) update.is_active = is_active;

  const { data: desk, error } = await supabase
    .from('desks')
    .update(update as any)
    .eq('id', id)
    .select('id, name, office_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'desk_updated',
    entity_type: 'desk',
    entity_id: desk.id,
    office_id: desk.office_id,
    summary: `Updated desk ${desk.name}`,
    metadata: {
      previous_office_id: existing.office_id,
      next_office_id: desk.office_id,
      previous_department_id: existing.department_id,
    },
  });

  return NextResponse.json({ success: true, data: desk });
}

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

  const existing = await loadDeskInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Desk not found in this organization' }, { status: 404 });
  }

  const { error } = await supabase.from('desks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'desk_deleted',
    entity_type: 'desk',
    entity_id: id,
    office_id: existing.office_id,
    summary: `Deleted desk ${existing.name}`,
  });

  return NextResponse.json({ success: true });
}

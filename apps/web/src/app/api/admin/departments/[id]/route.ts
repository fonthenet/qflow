import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

async function loadDepartmentInOrg(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  organizationId: string
) {
  const { data: dept } = await supabase
    .from('departments')
    .select('id, name, office_id, office:offices(id, organization_id)')
    .eq('id', id)
    .maybeSingle();
  const deptOffice = Array.isArray((dept as any)?.office)
    ? (dept as any).office[0]
    : (dept as any)?.office;
  if (!dept || !deptOffice || deptOffice.organization_id !== organizationId) {
    return null;
  }
  return dept;
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
    code,
    description,
    office_id,
    is_active,
    sort_order,
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

  const existing = await loadDepartmentInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Department not found in this organization' }, { status: 404 });
  }

  // Validate new office_id if supplied
  if (office_id) {
    const { data: office } = await supabase
      .from('offices')
      .select('id, organization_id')
      .eq('id', office_id)
      .maybeSingle();
    if (!office || office.organization_id !== caller.organization_id) {
      return NextResponse.json(
        { error: 'Invalid office: not found in this organization' },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (code !== undefined) update.code = code;
  if (description !== undefined) update.description = description || null;
  if (office_id !== undefined) update.office_id = office_id;
  if (is_active !== undefined) update.is_active = is_active;
  if (sort_order !== undefined) update.sort_order = typeof sort_order === 'number' ? sort_order : null;

  const { data: department, error } = await supabase
    .from('departments')
    .update(update as any)
    .eq('id', id)
    .select('id, name, office_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'department_updated',
    entity_type: 'department',
    entity_id: department.id,
    office_id: department.office_id,
    summary: `Updated department ${department.name}`,
    metadata: { previous_office_id: existing.office_id, next_office_id: office_id },
  });

  return NextResponse.json({ success: true, data: department });
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

  const existing = await loadDepartmentInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Department not found in this organization' }, { status: 404 });
  }

  const { error } = await supabase.from('departments').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'department_deleted',
    entity_type: 'department',
    entity_id: id,
    office_id: existing.office_id,
    summary: `Deleted department ${existing.name}`,
  });

  return NextResponse.json({ success: true });
}

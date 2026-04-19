import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

async function loadServiceInOrg(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
  organizationId: string
) {
  const { data: svc } = await supabase
    .from('services')
    .select(
      'id, name, department_id, department:departments(id, office_id, office:offices(id, organization_id))'
    )
    .eq('id', id)
    .maybeSingle();
  const dept = Array.isArray((svc as any)?.department)
    ? (svc as any).department[0]
    : (svc as any)?.department;
  const office = Array.isArray(dept?.office) ? dept?.office[0] : dept?.office;
  if (!svc || !dept || !office || office.organization_id !== organizationId) {
    return null;
  }
  return { ...svc, office_id: dept.office_id as string | null };
}

async function validateDepartmentInOrg(
  supabase: ReturnType<typeof createAdminClient>,
  departmentId: string,
  organizationId: string
) {
  const { data: dept } = await supabase
    .from('departments')
    .select('id, office_id, office:offices(id, organization_id)')
    .eq('id', departmentId)
    .maybeSingle();
  const deptOffice = Array.isArray((dept as any)?.office)
    ? (dept as any).office[0]
    : (dept as any)?.office;
  if (!dept || !deptOffice || deptOffice.organization_id !== organizationId) return null;
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
    department_id,
    estimated_service_time,
    priority,
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

  const existing = await loadServiceInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Service not found in this organization' }, { status: 404 });
  }

  if (department_id) {
    const ok = await validateDepartmentInOrg(supabase, department_id, caller.organization_id);
    if (!ok) {
      return NextResponse.json(
        { error: 'Invalid department: not found in this organization' },
        { status: 400 }
      );
    }
  }

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (code !== undefined) update.code = code;
  if (description !== undefined) update.description = description || null;
  if (department_id !== undefined) update.department_id = department_id;
  if (estimated_service_time !== undefined)
    update.estimated_service_time =
      typeof estimated_service_time === 'number' ? estimated_service_time : null;
  if (priority !== undefined) update.priority = typeof priority === 'number' ? priority : null;
  if (is_active !== undefined) update.is_active = is_active;
  if (sort_order !== undefined)
    update.sort_order = typeof sort_order === 'number' ? sort_order : null;

  const { data: service, error } = await supabase
    .from('services')
    .update(update as any)
    .eq('id', id)
    .select('id, name, department_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'service_updated',
    entity_type: 'service',
    entity_id: service.id,
    office_id: existing.office_id,
    summary: `Updated service ${service.name}`,
    metadata: {
      previous_department_id: existing.department_id,
      next_department_id: service.department_id,
    },
  });

  return NextResponse.json({ success: true, data: service });
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

  const existing = await loadServiceInOrg(supabase, id, caller.organization_id);
  if (!existing) {
    return NextResponse.json({ error: 'Service not found in this organization' }, { status: 404 });
  }

  const { error } = await supabase.from('services').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'service_deleted',
    entity_type: 'service',
    entity_id: id,
    office_id: existing.office_id,
    summary: `Deleted service ${existing.name}`,
  });

  return NextResponse.json({ success: true });
}

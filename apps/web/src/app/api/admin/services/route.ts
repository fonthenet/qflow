import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminCaller, logApiAudit, AdminApiAuthError } from '@/lib/admin/api-auth';

export async function POST(request: NextRequest) {
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

  if (!name || !code || !department_id) {
    return NextResponse.json(
      { error: 'Missing required fields: name, code, department_id' },
      { status: 400 }
    );
  }

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

  // Validate department via its office -> org
  const { data: dept } = await supabase
    .from('departments')
    .select('id, office_id, office:offices(id, organization_id)')
    .eq('id', department_id)
    .maybeSingle();
  const deptOffice = Array.isArray((dept as any)?.office)
    ? (dept as any).office[0]
    : (dept as any)?.office;
  if (!dept || !deptOffice || deptOffice.organization_id !== caller.organization_id) {
    return NextResponse.json(
      { error: 'Invalid department: not found in this organization' },
      { status: 400 }
    );
  }

  const { data: service, error } = await supabase
    .from('services')
    .insert({
      name,
      code,
      description: description ?? null,
      department_id,
      estimated_service_time:
        typeof estimated_service_time === 'number' ? estimated_service_time : null,
      priority: typeof priority === 'number' ? priority : null,
      is_active: is_active !== false,
      sort_order: typeof sort_order === 'number' ? sort_order : null,
    } as any)
    .select('id, name, department_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'service_created',
    entity_type: 'service',
    entity_id: service.id,
    office_id: dept.office_id,
    summary: `Created service ${service.name}`,
    metadata: { code, department_id, estimated_service_time },
  });

  return NextResponse.json({ success: true, data: service });
}

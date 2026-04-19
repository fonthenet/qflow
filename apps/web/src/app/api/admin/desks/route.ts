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
    display_name,
    office_id,
    department_id,
    current_staff_id,
    status,
    is_active,
  } = body ?? {};

  if (!name || !office_id || !department_id) {
    return NextResponse.json(
      { error: 'Missing required fields: name, office_id, department_id' },
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

  // Office must belong to org
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

  // Department must belong to the same office
  const { data: dept } = await supabase
    .from('departments')
    .select('id, office_id')
    .eq('id', department_id)
    .maybeSingle();
  if (!dept || dept.office_id !== office_id) {
    return NextResponse.json(
      { error: 'Department does not belong to the selected office' },
      { status: 400 }
    );
  }

  // Staff (if provided) must be in the same org and either same office or unassigned
  if (current_staff_id) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id, organization_id, office_id')
      .eq('id', current_staff_id)
      .maybeSingle();
    if (!staff || staff.organization_id !== caller.organization_id) {
      return NextResponse.json({ error: 'Assigned staff not found in this organization' }, { status: 400 });
    }
    if (staff.office_id && staff.office_id !== office_id) {
      return NextResponse.json(
        { error: 'Assigned staff must belong to the same office' },
        { status: 400 }
      );
    }
  }

  const { data: desk, error } = await supabase
    .from('desks')
    .insert({
      name,
      display_name: display_name ?? null,
      office_id,
      department_id,
      current_staff_id: current_staff_id ?? null,
      status: status ?? 'closed',
      is_active: is_active !== false,
    } as any)
    .select('id, name, office_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'desk_created',
    entity_type: 'desk',
    entity_id: desk.id,
    office_id: desk.office_id,
    summary: `Created desk ${desk.name}`,
    metadata: { department_id, current_staff_id: current_staff_id ?? null },
  });

  return NextResponse.json({ success: true, data: desk });
}

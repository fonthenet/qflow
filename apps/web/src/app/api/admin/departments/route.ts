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
    office_id,
    is_active,
    sort_order,
  } = body ?? {};

  if (!name || !code || !office_id) {
    return NextResponse.json(
      { error: 'Missing required fields: name, code, office_id' },
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

  // Validate office belongs to org
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

  const { data: department, error } = await supabase
    .from('departments')
    .insert({
      name,
      code,
      description: description ?? null,
      office_id,
      is_active: is_active !== false,
      sort_order: typeof sort_order === 'number' ? sort_order : null,
    } as any)
    .select('id, name, office_id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logApiAudit(supabase, caller, {
    action_type: 'department_created',
    entity_type: 'department',
    entity_id: department.id,
    office_id: department.office_id,
    summary: `Created department ${department.name}`,
    metadata: { code, sort_order },
  });

  return NextResponse.json({ success: true, data: department });
}

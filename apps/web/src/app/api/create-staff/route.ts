import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    email,
    password,
    full_name,
    role,
    organization_id,
    office_id,
    department_id,
    caller_user_id,
  } = body as Record<string, string | undefined>;

  if (!email || !full_name || !role || !organization_id || !caller_user_id) {
    return NextResponse.json(
      { error: 'Missing required fields: email, full_name, role, organization_id, caller_user_id' },
      { status: 400 }
    );
  }

  if (!password || password.length < 6) {
    return NextResponse.json(
      { error: 'Password is required and must be at least 6 characters' },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Verify caller is an admin/manager in this org
  const { data: callerStaff } = await supabase
    .from('staff')
    .select('role')
    .eq('auth_user_id', caller_user_id)
    .eq('organization_id', organization_id)
    .eq('is_active', true)
    .maybeSingle();

  if (!callerStaff || !['admin', 'manager', 'branch_admin'].includes(callerStaff.role)) {
    return NextResponse.json({ error: 'Unauthorized: only admins can create staff' }, { status: 403 });
  }

  // Validate office_id, if provided: must belong to the same org AND be active.
  // Protects against stale/malicious clients that send a closed office id.
  if (office_id) {
    const { data: office } = await supabase
      .from('offices')
      .select('id, is_active, organization_id')
      .eq('id', office_id)
      .maybeSingle();
    if (!office || office.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Invalid office: not found in this organization' }, { status: 400 });
    }
    if (office.is_active === false) {
      return NextResponse.json({ error: 'Cannot assign staff to a closed office. Reopen it or pick another location.' }, { status: 400 });
    }
  }

  // Validate department_id, if provided: its office must belong to this org,
  // and (if a specific office is also being assigned) they must match.
  if (department_id) {
    const { data: dept } = await supabase
      .from('departments')
      .select('id, office_id, office:offices(organization_id, is_active)')
      .eq('id', department_id)
      .maybeSingle();
    const deptOffice = (dept as any)?.office as { organization_id?: string; is_active?: boolean } | null;
    if (!dept || !deptOffice || deptOffice.organization_id !== organization_id) {
      return NextResponse.json({ error: 'Invalid department: not found in this organization' }, { status: 400 });
    }
    if (office_id && dept.office_id && dept.office_id !== office_id) {
      return NextResponse.json({ error: 'Department does not belong to the selected office' }, { status: 400 });
    }
  }

  // Create auth user with service role
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authErr) {
    // If user already exists, try to find them
    if (authErr.message?.includes('already been registered') || authErr.message?.includes('already exists')) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find((u) => u.email === email);
      if (existing) {
        // Check if staff record already exists
        const { data: existingStaff } = await supabase
          .from('staff')
          .select('id')
          .eq('email', email)
          .eq('organization_id', organization_id)
          .maybeSingle();

        if (existingStaff) {
          return NextResponse.json({ error: 'Staff member with this email already exists in this organization' }, { status: 409 });
        }

        // Create staff record linked to existing auth user
        const { error: insertErr } = await supabase.from('staff').insert({
          email,
          full_name,
          role,
          organization_id,
          office_id: office_id || null,
          department_id: department_id || null,
          is_active: true,
          auth_user_id: existing.id,
        });

        if (insertErr) {
          return NextResponse.json({ error: insertErr.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, linkedExisting: true });
      }
    }
    return NextResponse.json({ error: `Auth error: ${authErr.message}` }, { status: 500 });
  }

  // Create staff record
  const { error: insertErr } = await supabase.from('staff').insert({
    email,
    full_name,
    role,
    organization_id,
    office_id: office_id || null,
    department_id: department_id || null,
    is_active: true,
    auth_user_id: authData.user.id,
  });

  if (insertErr) {
    // Clean up auth user if staff insert fails
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

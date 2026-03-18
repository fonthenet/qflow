import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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

  const supabase = getSupabase();

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

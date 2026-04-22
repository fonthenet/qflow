import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getStarterTemplate,
  DEFAULT_OFFICE_HOURS,
  DEFAULT_TIMEZONE,
} from '@qflo/shared';

// ── POST /api/onboarding/create-business ───────────────────────────
// Single unified onboarding endpoint shared by the web signup page,
// the Station desktop app, and (future) mobile. Performs the full
// end-to-end setup in one call using the Supabase service-role key:
//
//   1. Create the auth user
//   2. Call create_organization_with_admin RPC (minimal intake_fields,
//      minimal VQC defaults — matches the fixes we shipped earlier)
//   3. Seed the chosen starter template (office with operating hours,
//      departments, services, desks)
//   4. Create the default virtual queue code (office + first dept,
//      service_id=null so customers still see a service picker)
//   5. Write org channel + booking defaults into settings
//   6. Assign the admin to the first office/department/desk
//
// Returns the caller-facing summary + a session so the client can sign
// the admin straight in without a second round-trip.

interface CreateBusinessBody {
  email?: string;
  password?: string;
  fullName?: string;
  businessName?: string;
  templateId?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function POST(request: NextRequest) {
  let body: CreateBusinessBody;
  try {
    body = (await request.json()) as CreateBusinessBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = body.email?.trim();
  const password = body.password;
  const fullName = body.fullName?.trim();
  const businessName = body.businessName?.trim();
  const templateId = body.templateId;

  if (!email || !password || !fullName || !businessName || !templateId) {
    return NextResponse.json(
      { error: 'Missing required fields: email, password, fullName, businessName, templateId' },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const template = getStarterTemplate(templateId);
  if (!template) {
    return NextResponse.json({ error: `Unknown templateId: ${templateId}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Create the auth user (auto-confirmed so the flow can finish in
  // one HTTP call — matches the web onboarding UX).
  const { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message ?? 'Failed to create auth user' }, { status: 400 });
  }
  const authUserId = created.user.id;

  try {
    // 2. Org + admin staff row
    const slug = slugify(businessName) || 'business-' + Date.now().toString(36);
    const { data: orgId, error: rpcErr } = await supabase.rpc('create_organization_with_admin', {
      p_org_name: businessName,
      p_org_slug: slug,
      p_admin_name: fullName,
      p_admin_email: email,
      p_auth_user_id: authUserId,
    });
    if (rpcErr || !orgId) throw rpcErr ?? new Error('RPC returned no org id');
    const organizationId = orgId as string;

    // 3. Office with reasonable operating hours + timezone
    const { data: office, error: officeErr } = await supabase
      .from('offices')
      .insert({
        organization_id: organizationId,
        name: template.officeName,
        is_active: true,
        timezone: DEFAULT_TIMEZONE,
        operating_hours: DEFAULT_OFFICE_HOURS,
      })
      .select('id, name')
      .single();
    if (officeErr || !office) throw new Error(`office: ${officeErr?.message ?? 'no row'}`);

    // 4. Departments + services
    const deptIdByCode = new Map<string, string>();
    for (const dept of template.departments) {
      const { data: deptRow, error: deptErr } = await supabase
        .from('departments')
        .insert({ office_id: office.id, code: dept.code, name: dept.name, is_active: true })
        .select('id')
        .single();
      if (deptErr || !deptRow) throw new Error(`department: ${deptErr?.message ?? 'no row'}`);
      deptIdByCode.set(dept.code, deptRow.id);

      for (const svc of dept.services) {
        const { error: svcErr } = await supabase
          .from('services')
          .insert({
            department_id: deptRow.id,
            code: svc.code,
            name: svc.name,
            estimated_service_time: svc.duration,
            is_active: true,
          });
        if (svcErr) throw new Error(`service: ${svcErr.message}`);
      }
    }

    // 5. Locate the admin staff row so we can claim desk #1
    const { data: staff } = await supabase
      .from('staff')
      .select('id, role')
      .eq('auth_user_id', authUserId)
      .single();

    // 6. Desks — first one opens and is claimed by the admin
    const firstDeptCode = template.departments[0]?.code;
    const firstDeptId = firstDeptCode ? deptIdByCode.get(firstDeptCode) ?? null : null;
    let firstDeskId: string | null = null;
    const firstDeskName = template.desks[0] ?? 'Desk 1';

    for (let i = 0; i < template.desks.length; i++) {
      const name = template.desks[i];
      const { data: desk, error: deskErr } = await supabase
        .from('desks')
        .insert({
          office_id: office.id,
          department_id: firstDeptId ?? (undefined as any),
          name,
          is_active: true,
          current_staff_id: i === 0 ? staff?.id ?? null : null,
          status: i === 0 ? 'open' : 'closed',
        })
        .select('id')
        .single();
      if (deskErr) throw new Error(`desk: ${deskErr.message}`);
      if (i === 0 && desk) firstDeskId = desk.id;
    }

    // Assign admin to the new office + first dept
    if (staff) {
      await supabase
        .from('staff')
        .update({ office_id: office.id, department_id: firstDeptId })
        .eq('id', staff.id);
    }

    // 7. Default virtual queue code (office + first dept only, no service lock)
    let createdVqcId: string | null = null;
    if (firstDeptId) {
      const vqcToken =
        'vqc_' + (globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24)
          ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      const { data: vqc } = await supabase
        .from('virtual_queue_codes')
        .insert({
          organization_id: organizationId,
          office_id: office.id,
          department_id: firstDeptId,
          service_id: null,
          qr_token: vqcToken,
          is_active: true,
        })
        .select('id')
        .single();
      createdVqcId = vqc?.id ?? null;
    }

    // 8. Org-level channel + booking defaults — merge so we don't
    // clobber what create_organization_with_admin already stamped.
    const autoCode =
      businessName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'QUEUE';
    const channelDefaults: Record<string, unknown> = {
      whatsapp_enabled: true,
      messenger_enabled: true,
      whatsapp_code: autoCode,
      booking_mode: 'simple',
      booking_horizon_days: 90,
      slot_duration_minutes: 30,
      slots_per_interval: 1,
      allow_cancellation: true,
      min_booking_lead_hours: 1,
      default_check_in_mode: 'hybrid',
    };
    if (createdVqcId) {
      channelDefaults.whatsapp_default_virtual_code_id = createdVqcId;
      channelDefaults.messenger_default_virtual_code_id = createdVqcId;
    }
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .single();
    const currentSettings = (orgRow?.settings ?? {}) as Record<string, unknown>;
    await supabase
      .from('organizations')
      .update({ settings: { ...currentSettings, ...channelDefaults } as any })
      .eq('id', organizationId);

    // 9. Build a session so the client can sign straight in.
    const { data: sessionData, error: sessionErr } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (sessionErr) {
      // Signup succeeded but password sign-in failed. Return what we
      // created so the client can surface a useful error.
      return NextResponse.json({
        organization_id: organizationId,
        office_id: office.id,
        staff_id: staff?.id ?? null,
        session: null,
        warning: 'Business created. Please sign in with your email and password.',
      });
    }

    return NextResponse.json({
      organization_id: organizationId,
      office_id: office.id,
      office_name: office.name,
      department_id: firstDeptId,
      desk_id: firstDeskId,
      desk_name: firstDeskName,
      staff_id: staff?.id ?? null,
      role: staff?.role ?? 'admin',
      session: {
        access_token: sessionData.session?.access_token ?? null,
        refresh_token: sessionData.session?.refresh_token ?? null,
      },
    });
  } catch (err: any) {
    // Rollback: delete the orphaned auth user so the operator can
    // retry with the same email. Ignore any delete error.
    try {
      await supabase.auth.admin.deleteUser(authUserId);
    } catch {}
    return NextResponse.json({ error: err?.message ?? 'Onboarding failed' }, { status: 500 });
  }
}

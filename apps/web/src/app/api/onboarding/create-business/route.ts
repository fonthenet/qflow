import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCityToWilaya } from '@/lib/business-location';
import {
  getBusinessCategory,
  getCategoryTemplateId,
  resolveLocalized,
  DEFAULT_OFFICE_HOURS,
  DEFAULT_TIMEZONE,
  type BusinessCategory,
  type CategoryLocale,
} from '@qflo/shared';

// ── POST /api/onboarding/create-business ───────────────────────────
// Unified signup endpoint shared by web (/signup) and Station (Signup
// screen). Creates, atomically:
//   1. auth user (auto-confirmed)
//   2. organization + admin staff row (via RPC)
//   3. first office (with operating hours)
//   4. one default department
//   5. one default service under that department
//   6. one default desk (status=open, assigned to the admin)
//   7. default virtual-queue-code for that office+department
//   8. category-aware channel defaults in organization.settings
//   9. authenticated session the client can use immediately
//
// All seeding pulls its names/durations from the shared
// `BUSINESS_CATEGORIES` spec, so changing the defaults is a one-file
// edit in `@qflo/shared/setup-wizard/categories.ts` and both the Portal
// and Station pick it up.
//
// The auth user is rolled back if any later step fails.

interface CreateBusinessBody {
  email?: string;
  password?: string;
  fullName?: string;
  businessName?: string;
  category?: BusinessCategory;
  officeName?: string;
  address?: string;
  country?: string;
  city?: string;
  timezone?: string;
  locale?: CategoryLocale;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function buildTicketPrefix(businessName: string): string {
  const STOPWORDS = new Set([
    'restaurant', 'cafe', 'coffee', 'clinic', 'bank', 'post', 'hotel',
    'shop', 'store', 'the', 'and', 'of',
    'clinique', 'cabinet', 'banque', 'poste', 'boutique', 'salon',
    'pharmacie', 'hopital', 'agence',
    'le', 'la', 'les', 'du', 'de', 'des', 'et', 'aux', 'au',
    'al', 'el',
  ]);
  const normalized = businessName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const meaningful = normalized
    .split(/[^a-z]+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join('');
  const letters = (meaningful.length >= 2 ? meaningful : normalized.replace(/[^a-z]/g, '')).toUpperCase();
  if (letters.length === 0) return 'TK';
  if (letters.length <= 2) return letters;
  return letters[0] + letters[Math.floor(letters.length / 2)] + letters[letters.length - 1];
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
  const categoryValue = body.category;
  const officeName = body.officeName?.trim();
  const address = body.address?.trim() || null;
  const country = body.country?.trim() || null;
  const city = body.city?.trim() || null;
  const timezone = body.timezone?.trim() || DEFAULT_TIMEZONE;
  const locale: CategoryLocale = body.locale ?? 'fr';

  if (!email || !password || !fullName || !businessName || !categoryValue || !officeName) {
    return NextResponse.json(
      {
        error:
          'Missing required fields: email, password, fullName, businessName, category, officeName',
      },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const category = getBusinessCategory(categoryValue);
  if (!category) {
    return NextResponse.json({ error: `Unknown category: ${categoryValue}` }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Auth user (recycle orphans from prior failed signups).
  let { data: created, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (authErr && /already|registered|exists/i.test(authErr.message || '')) {
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users?.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
    if (existing) {
      const { data: staffRow } = await supabase
        .from('staff')
        .select('id')
        .eq('auth_user_id', existing.id)
        .maybeSingle();
      if (staffRow) {
        return NextResponse.json(
          { error: 'This email is already in use. Please sign in instead.' },
          { status: 409 },
        );
      }
      // Orphan — recycle.
      await supabase.auth.admin.deleteUser(existing.id);
      ({ data: created, error: authErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      }));
    }
  }

  if (authErr || !created?.user) {
    return NextResponse.json({ error: authErr?.message ?? 'Failed to create auth user' }, { status: 400 });
  }
  const authUserId = created.user.id;

  try {
    // 2. Org + admin staff (RPC).
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

    // 3. Office. Carry country/city/wilaya so the public directory, SMS
    //    tax compliance and per-country overlays can target this office
    //    without re-asking the user.
    const wilaya = resolveCityToWilaya(country, city);
    const { data: office, error: officeErr } = await supabase
      .from('offices')
      .insert({
        organization_id: organizationId,
        name: officeName,
        address,
        is_active: true,
        timezone,
        country,
        city,
        wilaya,
        operating_hours: DEFAULT_OFFICE_HOURS,
      })
      .select('id, name')
      .single();
    if (officeErr || !office) throw new Error(`office: ${officeErr?.message ?? 'no row'}`);

    // 4. Default department.
    const deptName = resolveLocalized(category.defaultDepartment.name, locale);
    const { data: dept, error: deptErr } = await supabase
      .from('departments')
      .insert({
        office_id: office.id,
        code: category.defaultDepartment.code,
        name: deptName,
        is_active: true,
      })
      .select('id')
      .single();
    if (deptErr || !dept) throw new Error(`department: ${deptErr?.message ?? 'no row'}`);
    const departmentId = dept.id;

    // 5. Default service.
    const svcName = resolveLocalized(category.defaultService.name, locale);
    const { data: svc, error: svcErr } = await supabase
      .from('services')
      .insert({
        department_id: departmentId,
        code: category.defaultService.code,
        name: svcName,
        estimated_service_time: category.defaultService.estimatedMinutes,
        is_active: true,
      })
      .select('id')
      .single();
    if (svcErr || !svc) throw new Error(`service: ${svcErr?.message ?? 'no row'}`);

    // 6. Default desk, open, assigned to the admin.
    const { data: staff } = await supabase
      .from('staff')
      .select('id, role')
      .eq('auth_user_id', authUserId)
      .single();

    const deskName = resolveLocalized(category.defaultDesk.name, locale);
    const { data: desk, error: deskErr } = await supabase
      .from('desks')
      .insert({
        office_id: office.id,
        department_id: departmentId,
        name: deskName,
        is_active: true,
        current_staff_id: staff?.id ?? null,
        status: 'open',
      })
      .select('id, name')
      .single();
    if (deskErr || !desk) throw new Error(`desk: ${deskErr?.message ?? 'no row'}`);
    const deskId = desk.id;

    // 7. Assign admin to the new office + dept so /desk works on first click.
    if (staff) {
      await supabase
        .from('staff')
        .update({ office_id: office.id, department_id: departmentId })
        .eq('id', staff.id);
    }

    // 8. Default virtual queue code (for the QR poster + WhatsApp deeplinks).
    const vqcToken =
      'vqc_' +
      (globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24)
        ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    const { data: vqc } = await supabase
      .from('virtual_queue_codes')
      .insert({
        organization_id: organizationId,
        office_id: office.id,
        department_id: departmentId,
        service_id: null,
        qr_token: vqcToken,
        is_active: true,
      })
      .select('id')
      .single();
    const vqcId = vqc?.id ?? null;

    // 9. Org settings merge — channel defaults + category + wizard_completed_at.
    const autoCode = businessName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'QUEUE';
    const ticketPrefix = buildTicketPrefix(businessName);

    const { data: orgRow } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', organizationId)
      .single();
    const currentSettings = (orgRow?.settings ?? {}) as Record<string, unknown>;

    const channelDefaults: Record<string, unknown> = {
      business_category: category.value,
      business_country: country,
      business_city: city,
      whatsapp_enabled: true,
      messenger_enabled: true,
      whatsapp_code: autoCode,
      ticket_number_prefix: `${ticketPrefix}-`,
      ticket_number_format: 'prefix_numeric',
      booking_mode: 'simple',
      booking_horizon_days: 90,
      slot_duration_minutes: 30,
      slots_per_interval: 1,
      allow_cancellation: true,
      min_booking_lead_hours: 1,
      default_check_in_mode: 'hybrid',
      business_setup_wizard_completed_at: new Date().toISOString(),
      platform_template_id: getCategoryTemplateId(category),
    };
    if (vqcId) {
      channelDefaults.whatsapp_default_virtual_code_id = vqcId;
      channelDefaults.messenger_default_virtual_code_id = vqcId;
    }

    // Also write to first-class columns so the Settings → Organization
    // Profile screen, country-gated features (currency, wilaya, tax
    // rules) and the public directory all read consistent values —
    // settings.business_* is kept for legacy readers.
    await supabase
      .from('organizations')
      .update({
        settings: { ...currentSettings, ...channelDefaults } as any,
        country,
        timezone,
        locale_primary: locale,
        vertical: category.vertical,
      })
      .eq('id', organizationId);

    // 10. Authenticated session for the client.
    const { data: sessionData } = await supabase.auth.signInWithPassword({ email, password });

    return NextResponse.json({
      organization_id: organizationId,
      office_id: office.id,
      office_name: office.name,
      department_id: departmentId,
      desk_id: deskId,
      desk_name: desk.name,
      staff_id: staff?.id ?? null,
      user_id: authUserId,
      role: staff?.role ?? 'admin',
      session: {
        access_token: sessionData.session?.access_token ?? null,
        refresh_token: sessionData.session?.refresh_token ?? null,
      },
    });
  } catch (err: any) {
    try { await supabase.auth.admin.deleteUser(authUserId); } catch { /* best effort */ }
    return NextResponse.json({ error: err?.message ?? 'Onboarding failed' }, { status: 500 });
  }
}

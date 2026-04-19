import { NextRequest, NextResponse } from 'next/server';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Find office by slug – query all active offices then match slug
  const { data: offices, error: officesError } = await supabase
    .from('offices')
    .select('id, name, address, organization_id, settings, timezone')
    .eq('is_active', true);

  if (officesError) {
    return NextResponse.json({ error: officesError.message }, { status: 500 });
  }

  const office = offices?.find((entry: any) => matchesOfficePublicSlug(entry, slug));

  if (!office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  // Fetch organization, departments with services, and priority categories in parallel
  const [orgResult, departmentsResult, priorityCategoriesResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, logo_url, settings')
      .eq('id', office.organization_id)
      .single(),
    supabase
      .from('departments')
      .select('id, name, code, sort_order, services(id, name, description, department_id, estimated_service_time, sort_order)')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('priority_categories')
      .select('id, name, icon, color, weight')
      .eq('organization_id', office.organization_id)
      .eq('is_active', true)
      .order('weight', { ascending: false }),
  ]);

  const org = orgResult.data;

  // Build kiosk settings from office and organization settings
  const orgSettings = (org?.settings as Record<string, any> | null) ?? {};
  if (orgSettings.kiosk_enabled === false) {
    return NextResponse.json({ error: 'Kiosk is disabled' }, { status: 403 });
  }
  const officeSettings = (office.settings as Record<string, any> | null) ?? {};
  const platformConfig = resolvePlatformConfig({
    organizationSettings: orgSettings,
    officeSettings,
  });
  const profile = platformConfig.experienceProfile.kiosk;

  // Return the full raw organization settings so the mobile booking and
  // kiosk flows read the same source of truth as every other platform
  // (web booking form, WhatsApp/Messenger, desktop station). Computed
  // kiosk defaults below then override/augment the raw values.
  const settings = {
    ...orgSettings,
    ...officeSettings,
    kiosk_welcome_message: orgSettings.kiosk_welcome_message ?? null,
    kiosk_header_text: orgSettings.kiosk_header_text ?? null,
    kiosk_theme_color: orgSettings.kiosk_theme_color ?? null,
    priorities_enabled: orgSettings.priorities_enabled !== false,
    kiosk_show_priorities:
      orgSettings.priorities_enabled === false
        ? false
        : (orgSettings.kiosk_show_priorities ??
          (platformConfig.queuePolicy.priorityMode !== 'none' && profile.showPriorities)),
    kiosk_show_estimated_time: orgSettings.kiosk_show_estimated_time ?? profile.showEstimatedTime,
    kiosk_locked_department_id:
      orgSettings.kiosk_locked_department_id ?? officeSettings.kiosk_locked_department_id ?? null,
    kiosk_hidden_departments:
      orgSettings.kiosk_hidden_departments ?? officeSettings.kiosk_hidden_departments ?? [],
    kiosk_hidden_services:
      orgSettings.kiosk_hidden_services ?? officeSettings.kiosk_hidden_services ?? [],
    default_check_in_mode: orgSettings.default_check_in_mode ?? 'hybrid',
    booking_mode: orgSettings.booking_mode ?? 'simple',
    booking_horizon_days: Number(orgSettings.booking_horizon_days ?? 90),
    visit_intake_override_mode:
      orgSettings.visit_intake_override_mode ??
      officeSettings.visit_intake_override_mode ??
      'business_hours',
  };

  // Filter out hidden departments and services, flatten services
  const rawDepts = (departmentsResult.data || [])
    .filter((d: any) => !settings.kiosk_hidden_departments.includes(d.id));

  const departments = rawDepts.map((d: any) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    sort_order: d.sort_order,
  }));

  const services = rawDepts.flatMap((d: any) =>
    (d.services || [])
      .filter((s: any) => !settings.kiosk_hidden_services.includes(s.id))
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        department_id: s.department_id ?? d.id,
        estimated_service_time: s.estimated_service_time,
        sort_order: s.sort_order,
      }))
  );

  return NextResponse.json({
    office: {
      id: office.id,
      name: office.name,
      address: office.address ?? null,
      organization_id: office.organization_id,
      timezone: (office as any).timezone ?? null,
    },
    organization: org
      ? {
          id: org.id,
          name: org.name,
          logo_url: org.logo_url ?? null,
        }
      : null,
    departments,
    services,
    priorityCategories: orgSettings.priorities_enabled === false ? [] : (priorityCategoriesResult.data || []),
    settings,
  });
}

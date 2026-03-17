import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

function slugifyOfficeName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function matchesOfficePublicSlug(
  office: { name: string; settings?: unknown },
  slug: string
) {
  const settings =
    office.settings && typeof office.settings === 'object' && !Array.isArray(office.settings)
      ? (office.settings as Record<string, unknown>)
      : {};
  const configuredSlug = settings.platform_office_slug;
  const effectiveSlug =
    typeof configuredSlug === 'string' && configuredSlug.trim().length > 0
      ? configuredSlug
      : slugifyOfficeName(office.name);
  return effectiveSlug === slug;
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Find office by slug – query all active offices then match slug
  const { data: offices, error: officesError } = await supabase
    .from('offices')
    .select('id, name, address, organization_id, settings')
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
  const officeSettings = (office.settings as Record<string, any> | null) ?? {};

  const settings = {
    kiosk_welcome_message: orgSettings.kiosk_welcome_message ?? null,
    kiosk_header_text: orgSettings.kiosk_header_text ?? null,
    kiosk_theme_color: orgSettings.kiosk_theme_color ?? null,
    kiosk_show_priorities: orgSettings.kiosk_show_priorities ?? true,
    kiosk_show_estimated_time: orgSettings.kiosk_show_estimated_time ?? true,
    kiosk_locked_department_id:
      orgSettings.kiosk_locked_department_id ?? officeSettings.kiosk_locked_department_id ?? null,
    kiosk_hidden_departments:
      orgSettings.kiosk_hidden_departments ?? officeSettings.kiosk_hidden_departments ?? [],
    kiosk_hidden_services:
      orgSettings.kiosk_hidden_services ?? officeSettings.kiosk_hidden_services ?? [],
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
    priorityCategories: priorityCategoriesResult.data || [],
    settings,
  });
}

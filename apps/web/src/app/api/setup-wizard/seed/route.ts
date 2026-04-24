import { NextRequest, NextResponse } from 'next/server';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
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

// ── POST /api/setup-wizard/seed ───────────────────────────────────
// Post-register seed endpoint used by the Portal's /admin/setup-wizard.
// Assumes the caller is an authenticated admin of an existing org that
// has no office yet (or is happy to add another). Creates exactly:
//   - office (with timezone + operating hours)
//   - 1 department
//   - 1 service
//   - 1 desk (assigned + open)
//   - 1 virtual queue code
//   - merges channel defaults + marks the wizard complete
//
// Keeps the /api/onboarding/create-business endpoint for brand-new
// signups (Station + /signup page) — this endpoint is the authenticated
// companion that re-uses the same shared category defaults.

interface SeedBody {
  category?: BusinessCategory;
  officeName?: string;
  address?: string;
  country?: string;
  city?: string;
  timezone?: string;
  locale?: CategoryLocale;
  /** Operator overrides from the wizard preview. When absent, fall back to
   *  the category defaults — this keeps the endpoint backward-compatible
   *  with older clients that don't yet send the customized seed. */
  departmentName?: string;
  services?: Array<{ name: string; estimatedMinutes: number }>;
  desks?: string[];
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
  const context = await getStaffContext();
  try {
    await requireOrganizationAdmin(context);
  } catch {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  let body: SeedBody;
  try {
    body = (await request.json()) as SeedBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const categoryValue = body.category;
  const officeName = body.officeName?.trim();
  const address = body.address?.trim() || null;
  const country = body.country?.trim() || null;
  const city = body.city?.trim() || null;
  const timezone = body.timezone?.trim() || DEFAULT_TIMEZONE;
  const locale: CategoryLocale = body.locale ?? 'fr';

  if (!categoryValue || !officeName) {
    return NextResponse.json(
      { error: 'Missing required fields: category, officeName' },
      { status: 400 },
    );
  }
  const category = getBusinessCategory(categoryValue);
  if (!category) {
    return NextResponse.json({ error: `Unknown category: ${categoryValue}` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const organizationId = context.staff.organization_id;

  // Fetch org once for the business name (for ticket prefix) + existing settings.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('name, settings')
    .eq('id', organizationId)
    .single();
  const businessName: string = orgRow?.name ?? 'Business';
  const currentSettings = (orgRow?.settings ?? {}) as Record<string, unknown>;

  try {
    // 1. Office — carry country/city/wilaya for directory + overlays.
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

    // 2. Department — operator-named, falls back to category default.
    const deptName = body.departmentName?.trim() || resolveLocalized(category.defaultDepartment.name, locale);
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

    // 3. Services — operator-customized list, or the single category default.
    //    Auto-generate service codes from the department code + index so the
    //    queue number format stays deterministic.
    const servicesToSeed = (body.services && body.services.length > 0)
      ? body.services.map((s, idx) => ({
          name: s.name.trim() || resolveLocalized(category.defaultService.name, locale),
          estimatedMinutes: Math.max(1, Math.min(480, Number(s.estimatedMinutes) || category.defaultService.estimatedMinutes)),
          code: idx === 0
            ? category.defaultService.code
            : `${category.defaultDepartment.code}${String(idx + 1).padStart(2, '0')}`,
        }))
      : [{
          name: resolveLocalized(category.defaultService.name, locale),
          estimatedMinutes: category.defaultService.estimatedMinutes,
          code: category.defaultService.code,
        }];

    const { error: svcErr } = await supabase
      .from('services')
      .insert(servicesToSeed.map((s) => ({
        department_id: dept.id,
        code: s.code,
        name: s.name,
        estimated_service_time: s.estimatedMinutes,
        is_active: true,
      })));
    if (svcErr) throw new Error(`service: ${svcErr.message}`);

    // 4. Desks — first one gets the admin assigned + open; the rest go
    //    unassigned/closed so the admin can staff them later.
    const desksToSeed = (body.desks && body.desks.length > 0)
      ? body.desks.map((d) => d.trim() || resolveLocalized(category.defaultDesk.name, locale))
      : [resolveLocalized(category.defaultDesk.name, locale)];

    const { data: deskRows, error: deskErr } = await supabase
      .from('desks')
      .insert(desksToSeed.map((name, idx) => ({
        office_id: office.id,
        department_id: dept.id,
        name,
        is_active: true,
        current_staff_id: idx === 0 ? context.staff.id : null,
        status: idx === 0 ? 'open' : 'closed',
      })))
      .select('id, name');
    if (deskErr || !deskRows || deskRows.length === 0) throw new Error(`desk: ${deskErr?.message ?? 'no row'}`);
    const desk = deskRows[0];

    // 5. Admin lands on this office+dept by default.
    await supabase
      .from('staff')
      .update({ office_id: office.id, department_id: dept.id })
      .eq('id', context.staff.id);

    // 6. Virtual queue code.
    const vqcToken =
      'vqc_' +
      (globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24)
        ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
    const { data: vqc } = await supabase
      .from('virtual_queue_codes')
      .insert({
        organization_id: organizationId,
        office_id: office.id,
        department_id: dept.id,
        service_id: null,
        qr_token: vqcToken,
        is_active: true,
      })
      .select('id')
      .single();
    const vqcId = vqc?.id ?? null;

    // 7. Channel defaults + mark wizard complete.
    const autoCode = businessName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'QUEUE';
    const ticketPrefix = buildTicketPrefix(businessName);

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

    // First-class org columns — keeps Settings → Organization Profile,
    // country-gated currency/wilaya UI and the public directory in sync.
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

    return NextResponse.json({
      office_id: office.id,
      office_name: office.name,
      department_id: dept.id,
      desk_id: desk.id,
      desk_name: desk.name,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Setup failed' }, { status: 500 });
  }
}

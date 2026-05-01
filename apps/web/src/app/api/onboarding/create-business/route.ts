import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCityToWilaya } from '@/lib/business-location';
import {
  getBusinessCategory,
  getCategoryTemplateId,
  resolveLocalized,
  DEFAULT_OFFICE_HOURS,
  DEFAULT_TIMEZONE,
  RESTAURANT_DEFAULT_SERVICES,
  RESTAURANT_DEFAULT_SETTINGS,
  isRestaurantCategory,
  getSalonTemplateForCategory,
  SALON_DEFAULT_SETTINGS,
  isSalonCategory,
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
  /** Operator overrides from the wizard preview. When absent, fall back to
   *  the category defaults so older clients stay supported. */
  departmentName?: string;
  services?: Array<{ name: string; estimatedMinutes: number }>;
  desks?: string[];
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

  if (!email || !password || !fullName || !businessName) {
    return NextResponse.json(
      {
        error:
          'Missing required fields: email, password, fullName, businessName',
      },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  // Category + officeName are optional. When both are present we do the
  // full Station-style seeding (office + department + service + desk +
  // VQC). When either is missing we create an "org shell" and let the
  // admin finish configuration in the setup wizard — this lets the web
  // /register page and the Station signup hit the exact same endpoint.
  const fullSeed = Boolean(categoryValue && officeName);
  const category = categoryValue ? getBusinessCategory(categoryValue) : null;
  if (categoryValue && !category) {
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

    // 3-8. Optional full seeding — only when the caller passed
    // category + officeName (Station signup). When missing, we skip
    // office/dept/service/desk and let the setup wizard create them.
    let office: { id: string; name: string } | null = null;
    let departmentId: string | null = null;
    let deskId: string | null = null;
    let deskName: string | null = null;
    let vqcId: string | null = null;
    let staff: { id: string; role: string | null } | null = null;

    if (fullSeed && category && officeName) {
    // 3. Office. Carry country/city/wilaya so the public directory, SMS
    //    tax compliance and per-country overlays can target this office
    //    without re-asking the user.
    const wilaya = resolveCityToWilaya(country, city);
    const { data: officeRow, error: officeErr } = await supabase
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
    if (officeErr || !officeRow) throw new Error(`office: ${officeErr?.message ?? 'no row'}`);
    office = officeRow;

    // 4. Department — operator-named, falls back to category default.
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
    departmentId = dept.id;
    const deptIdLocal: string = dept.id;
    const officeLocal = officeRow;

    // 5. Services.
    //
    //  - Restaurant / cafe categories get the universal restaurant
    //    template: dine-in + takeout + delivery seeded by default. The
    //    three names match the RESTAURANT_SERVICE_VISUALS regexes, so the
    //    WhatsApp ordering flow, kitchen-prep classifier, rider system,
    //    and customer tracking page all classify them correctly out of
    //    the box. tables-enabled is on by default (operator can flip it
    //    off in Business Admin → Restaurant tab; that just deactivates
    //    the dine-in service, takeout/delivery keep working — useful for
    //    ghost kitchens). The body can still override with `services`
    //    if the operator wants a different shape from a future UI.
    //
    //  - All other verticals get the historical single-default-service
    //    behaviour or the operator-customized list.
    const useRestaurantTemplate = isRestaurantCategory(category.value)
      && (!body.services || body.services.length === 0);
    // Salon / barber / beauty / spa — same pattern as restaurant.
    // We only seed the trio when the operator hasn't supplied a custom
    // list. The `controlledByExpertiseToggle` flag (color services) is
    // not yet wired to a kill switch — services start active.
    const useSalonTemplate = isSalonCategory(category.value)
      && (!body.services || body.services.length === 0);

    const servicesToSeed = useRestaurantTemplate
      ? RESTAURANT_DEFAULT_SERVICES.map((s) => ({
          name: resolveLocalized(s.name, locale),
          estimatedMinutes: s.estimatedMinutes,
          code: s.code,
          // Tables-toggle defaults to ON, so dine-in is seeded active.
          // The operator can disable tables later from Business Admin.
          isActive: true,
          // Keep the service-type tag in metadata so the UI's restaurant
          // settings tab can find dine-in by type, not by string-matching
          // its name (operators rename services freely).
          serviceType: s.type,
        }))
      : useSalonTemplate
      ? getSalonTemplateForCategory(category.value).map((s) => ({
          // Pick the sub-type-appropriate trio: barbershop gets cut /
          // beard / razor; nail_salon gets mani / pedi / gel; spa gets
          // massage / facial / hammam; the legacy 'beauty' catch-all
          // gets a representative mix.
          name: resolveLocalized(s.name, locale),
          estimatedMinutes: s.estimatedMinutes,
          code: s.code,
          isActive: true,
          serviceType: s.type,
        }))
      : (body.services && body.services.length > 0)
        ? body.services.map((s, idx) => ({
            name: s.name.trim() || resolveLocalized(category.defaultService.name, locale),
            estimatedMinutes: Math.max(1, Math.min(480, Number(s.estimatedMinutes) || category.defaultService.estimatedMinutes)),
            code: idx === 0
              ? category.defaultService.code
              : `${category.defaultDepartment.code}${String(idx + 1).padStart(2, '0')}`,
            isActive: true,
            serviceType: undefined,
          }))
        : [{
            name: resolveLocalized(category.defaultService.name, locale),
            estimatedMinutes: category.defaultService.estimatedMinutes,
            code: category.defaultService.code,
            isActive: true,
            serviceType: undefined,
          }];

    const { data: svcRows, error: svcErr } = await supabase
      .from('services')
      .insert(servicesToSeed.map((s) => ({
        department_id: deptIdLocal,
        code: s.code,
        name: s.name,
        estimated_service_time: s.estimatedMinutes,
        is_active: s.isActive,
      })))
      .select('id');
    if (svcErr || !svcRows || svcRows.length === 0) throw new Error(`service: ${svcErr?.message ?? 'no row'}`);

    // 6. Desks — first one open + assigned to the admin, the rest closed.
    //
    // Why only the first desk gets a staff binding: when two desks share
    // the same `current_staff_id`, two operator clicks racing on "Call next"
    // produce DESK_CONFLICT 409s on the cloud. Keeping a strict 1:1 mapping
    // (one desk → one operator at a time) eliminates that class of conflict.
    // Admins can reassign later via Team Settings, but the seed defaults to
    // a safe single-active-desk topology.
    const { data: staffRow } = await supabase
      .from('staff')
      .select('id, role')
      .eq('auth_user_id', authUserId)
      .single();
    staff = staffRow as { id: string; role: string | null } | null;

    const desksToSeed = (body.desks && body.desks.length > 0)
      ? body.desks.map((d) => d.trim() || resolveLocalized(category.defaultDesk.name, locale))
      : [resolveLocalized(category.defaultDesk.name, locale)];

    const { data: deskRows, error: deskErr } = await supabase
      .from('desks')
      .insert(desksToSeed.map((name, idx) => ({
        office_id: officeLocal.id,
        department_id: deptIdLocal,
        name,
        is_active: true,
        current_staff_id: idx === 0 ? (staff?.id ?? null) : null,
        status: idx === 0 ? 'open' : 'closed',
      })))
      .select('id, name');
    if (deskErr || !deskRows || deskRows.length === 0) throw new Error(`desk: ${deskErr?.message ?? 'no row'}`);
    const desk = deskRows[0];
    deskId = desk.id;
    deskName = desk.name;

    // 7. Assign admin to the new office + dept so /desk works on first click.
    if (staff) {
      await supabase
        .from('staff')
        .update({ office_id: officeLocal.id, department_id: deptIdLocal })
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
        office_id: officeLocal.id,
        department_id: deptIdLocal,
        service_id: null,
        qr_token: vqcToken,
        is_active: true,
      })
      .select('id')
      .single();
    vqcId = vqc?.id ?? null;
    } // end if (fullSeed)

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
      listed_in_directory: true,

      // ── Concurrency / sync hardening defaults ───────────────────
      // These four settings are written explicitly at onboarding so the
      // admin UI surfaces them on day one (rather than relying on `??`
      // fallbacks scattered through the codebase). Together they minimize
      // DESK_CONFLICT noise and keep the offline-first sync queue clean
      // for new businesses.

      // Approval gate: ON by default. Bookings stay 'pending' until staff
      // act on them. With the new per-customer auto_approve_reservations
      // flag, VIP customers still skip the gate. Better default: a brand-
      // new business hasn't yet decided who they trust, so require approval.
      require_appointment_approval: true,

      // Walk-in tickets bypass approval by default — they're already in
      // the building. Public-service / bank verticals can flip this on.
      require_ticket_approval: false,

      // Documents the fact that the DB enforces "one active call per desk"
      // (see queue_resilience.sql trigger). The Station UI reads this to
      // show a friendly "Already called by Jan" toast instead of letting
      // two operators race-click "Call next" and discover the conflict
      // only via the diagnostic panel.
      single_active_call_per_desk: true,

      // Tells the Station to require a healthy realtime websocket before
      // enabling "Call next". If realtime is down the operator's view of
      // who-called-what is stale and stale calls produce 409s. When false
      // (default in tests) the Station falls back to polling every 3s.
      realtime_required_for_calls: true,

      // Caps how many minutes a queued cloud mutation can sit before the
      // Station auto-discards it as a ghost. Matches the CONFLICT_MAX × tick
      // window in sync.ts. Surfacing it in settings lets ops tune it per
      // business (e.g. spotty rural Wi-Fi → bump to 5).
      sync_ghost_timeout_minutes: 1,
    };
    if (category) {
      // Only stamp category-derived fields when we actually have a
      // category picked. The portal signup defers these to the setup
      // wizard so the admin can pick a template there.
      channelDefaults.business_category = category.value;
      channelDefaults.business_setup_wizard_completed_at = new Date().toISOString();
      channelDefaults.platform_template_id = getCategoryTemplateId(category);

      // Restaurant overlay — stamp the universal-restaurant defaults so
      // /api/moderate-ticket, /api/orders/*, the Order Pad, the WA
      // ordering flow, and the rider system all read consistent values
      // from day one. Includes the tables-enabled toggle (operator can
      // flip later) and forces require_ticket_approval=true so online
      // orders go through pending_approval — overriding the generic
      // default just above which is false.
      if (isRestaurantCategory(category.value)) {
        Object.assign(channelDefaults, RESTAURANT_DEFAULT_SETTINGS);
      }
      // Salon / barber / beauty / spa overlay — stamps:
      //   - chairs / stylist-choice / walk-ins toggles (all ON)
      //   - require_appointment_approval (ON — same anti-spam gate)
      //   - allow_cancellation (ON — server still blocks 'serving')
      // The booking flow reads salon_stylist_choice_enabled to decide
      // whether to show the "Pick your stylist" step.
      if (isSalonCategory(category.value)) {
        Object.assign(channelDefaults, SALON_DEFAULT_SETTINGS);
      }
    }
    if (vqcId) {
      channelDefaults.whatsapp_default_virtual_code_id = vqcId;
      channelDefaults.messenger_default_virtual_code_id = vqcId;
    }

    // Also write to first-class columns so the Settings → Organization
    // Profile screen, country-gated features (currency, wilaya, tax
    // rules) and the public directory all read consistent values —
    // settings.business_* is kept for legacy readers.
    const orgUpdate: Record<string, unknown> = {
      settings: { ...currentSettings, ...channelDefaults },
      country,
      timezone,
      locale_primary: locale,
    };
    if (category) orgUpdate.vertical = category.vertical;
    // Surfaced errors only — previously the failure was swallowed which
    // produced "fax"-style orgs: auth + RPC succeeded, office/dept/service
    // got seeded, but business_category + channelDefaults never landed
    // because the update silently bailed. The customer got a happy
    // signup but a half-configured business.
    const { error: orgUpdateErr } = await supabase
      .from('organizations')
      .update(orgUpdate as any)
      .eq('id', organizationId);
    if (orgUpdateErr) {
      console.error('[onboarding] org settings merge failed', {
        organizationId,
        error: orgUpdateErr.message,
        stamped_keys: Object.keys(channelDefaults),
      });
      // Don't 500 — the org/office/staff are usable, the operator can
      // fix settings later via Business Admin. But surface in logs so
      // we catch it instead of debugging by examining "why is my org
      // half-configured?".
    }

    // Pull the staff row even in shell mode so the client gets a proper
    // role back (the RPC created this row). In full-seed mode we already
    // loaded it above.
    if (!staff) {
      const { data: staffRow } = await supabase
        .from('staff')
        .select('id, role')
        .eq('auth_user_id', authUserId)
        .single();
      staff = staffRow as { id: string; role: string | null } | null;
    }

    // 10. Authenticated session for the client.
    const { data: sessionData } = await supabase.auth.signInWithPassword({ email, password });

    return NextResponse.json({
      organization_id: organizationId,
      office_id: office?.id ?? null,
      office_name: office?.name ?? null,
      department_id: departmentId,
      desk_id: deskId,
      desk_name: deskName,
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

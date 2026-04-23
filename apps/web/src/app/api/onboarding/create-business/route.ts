import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  getStarterSubtype,
  getDefaultOptions,
  DEFAULT_OFFICE_HOURS,
  DEFAULT_TIMEZONE,
} from '@qflo/shared';

// ── POST /api/onboarding/create-business ───────────────────────────
// Unified onboarding endpoint shared by web, Station desktop, and
// mobile. Creates the auth user, org, office (with operating hours),
// departments, services, desks, restaurant_tables (if applicable),
// the default virtual queue code, and channel/booking settings — all
// in one call. Auth user is rolled back on failure.

interface CreateBusinessBody {
  email?: string;
  password?: string;
  fullName?: string;
  businessName?: string;
  templateId?: string;
  subtypeId?: string;
  options?: Record<string, number>;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function num(opts: Record<string, number> | undefined, key: string, fallback: number): number {
  const v = opts?.[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  return fallback;
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
  const subtypeId = body.subtypeId;

  if (!email || !password || !fullName || !businessName || !templateId) {
    return NextResponse.json(
      { error: 'Missing required fields: email, password, fullName, businessName, templateId' },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const subtype = getStarterSubtype(templateId, subtypeId);
  if (!subtype) {
    return NextResponse.json({ error: `Unknown templateId/subtypeId: ${templateId}/${subtypeId}` }, { status: 400 });
  }

  const options = { ...getDefaultOptions(subtype), ...(body.options ?? {}) };

  const supabase = createAdminClient();

  // 1. Create the auth user (auto-confirmed so the flow finishes in one call).
  // If the email is already taken, check whether it's an orphan from a
  // prior failed signup (auth user exists but no staff row). Orphans
  // are recycled transparently so the operator can retry with the same
  // email. Real existing users get a clear 409.
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
      // Orphan — recycle and retry
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
    // 2. Org + admin staff row (same RPC the web uses — minimal intake_fields)
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

    // 3. Office
    const { data: office, error: officeErr } = await supabase
      .from('offices')
      .insert({
        organization_id: organizationId,
        name: subtype.officeName,
        is_active: true,
        timezone: DEFAULT_TIMEZONE,
        operating_hours: DEFAULT_OFFICE_HOURS,
      })
      .select('id, name')
      .single();
    if (officeErr || !office) throw new Error(`office: ${officeErr?.message ?? 'no row'}`);

    // 4. Departments + services
    const deptIdByCode = new Map<string, string>();
    for (const dept of subtype.departments) {
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

    // 5. Admin staff row
    const { data: staff } = await supabase
      .from('staff')
      .select('id, role')
      .eq('auth_user_id', authUserId)
      .single();

    // 6. Desks — expand per subtype options (cashiers / tellers / chairs /
    // counters / doctors). Falls back to the template's desk name list.
    const firstDeptCode = subtype.departments[0]?.code;
    const firstDeptId = firstDeptCode ? deptIdByCode.get(firstDeptCode) ?? null : null;
    const advisoryDeptId = deptIdByCode.get('ADV') ?? null;

    // Resolve how many desks of each kind to create.
    const plan: { name: string; deptId: string | null }[] = [];
    const pushN = (n: number, baseName: string, deptId: string | null) => {
      for (let i = 1; i <= n; i++) plan.push({ name: n === 1 ? baseName : `${baseName} ${i}`, deptId });
    };

    switch (subtype.id) {
      case 'restaurant-full':
      case 'restaurant-cafe':
        pushN(num(options, 'cashiers', subtype.desks.length), subtype.id === 'restaurant-cafe' ? 'Counter' : 'Caisse', firstDeptId);
        break;
      case 'medical-gp':
      case 'medical-dental':
        plan.push({ name: 'Reception', deptId: firstDeptId });
        pushN(num(options, 'doctors', 1), subtype.id === 'medical-dental' ? 'Dentist' : 'Doctor', firstDeptId);
        break;
      case 'medical-pharmacy':
        pushN(num(options, 'counters', 1), 'Counter', firstDeptId);
        break;
      case 'bank-full':
        pushN(num(options, 'tellers', 2), 'Teller', firstDeptId);
        pushN(num(options, 'advisors', 1), 'Advisor', advisoryDeptId ?? firstDeptId);
        break;
      case 'bank-small':
        pushN(num(options, 'tellers', 1), 'Teller', firstDeptId);
        break;
      case 'retail-store':
        pushN(num(options, 'counters', 1), 'Counter', firstDeptId);
        break;
      case 'retail-salon':
      case 'retail-barber':
        pushN(num(options, 'chairs', subtype.desks.length), 'Chair', firstDeptId);
        break;
      case 'public-docs':
      case 'public-municipal':
        pushN(num(options, 'counters', subtype.desks.length), 'Counter', firstDeptId);
        break;
      default:
        for (const name of subtype.desks) plan.push({ name, deptId: firstDeptId });
    }

    let firstDeskId: string | null = null;
    const firstDeskName = plan[0]?.name ?? subtype.desks[0] ?? 'Desk 1';
    for (let i = 0; i < plan.length; i++) {
      const { name, deptId } = plan[i];
      const { data: desk, error: deskErr } = await supabase
        .from('desks')
        .insert({
          office_id: office.id,
          department_id: (deptId ?? undefined) as any,
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

    // 7. Restaurant tables (only if the subtype opted in via `tables`)
    const tableCount = num(options, 'tables', 0);
    if (tableCount > 0) {
      const rows = [];
      for (let i = 1; i <= tableCount; i++) {
        rows.push({
          office_id: office.id,
          code: `T${i}`,
          label: `Table ${i}`,
          capacity: 4,
          status: 'available',
        });
      }
      const { error: tblErr } = await supabase.from('restaurant_tables').insert(rows);
      if (tblErr) throw new Error(`restaurant_tables: ${tblErr.message}`);
    }

    // 8. Assign admin to new office + first dept
    if (staff) {
      await supabase
        .from('staff')
        .update({ office_id: office.id, department_id: firstDeptId })
        .eq('id', staff.id);
    }

    // 9. Default virtual queue code (office + first dept only)
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

    // 10. Org settings merge — channel + booking defaults + category
    const autoCode =
      businessName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'QUEUE';

    // Ticket prefix = first + middle + last letter of the business name
    // AFTER stripping category/generic words (so "Restaurant Saphir" → SHR,
    // not RUT which every restaurant would share). Words are compared
    // case-insensitively and diacritics are normalized.
    const ticketPrefix = (() => {
      const STOPWORDS = new Set([
        // EN
        'restaurant', 'cafe', 'coffee', 'clinic', 'bank', 'post', 'hotel',
        'shop', 'store', 'the', 'and', 'of',
        // FR
        'restaurant', 'cafe', 'clinique', 'cabinet', 'banque', 'poste',
        'hotel', 'boutique', 'salon', 'pharmacie', 'hopital', 'agence',
        'le', 'la', 'les', 'du', 'de', 'des', 'et', 'aux', 'au',
        // AR (Latin-script transliterations commonly used in business names)
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
      // If everything was stripped, fall back to the raw name letters.
      const letters = (
        meaningful.length >= 2
          ? meaningful
          : normalized.replace(/[^a-z]/g, '')
      ).toUpperCase();
      if (letters.length === 0) return 'TK';
      if (letters.length === 1) return letters;
      if (letters.length === 2) return letters;
      return letters[0] + letters[Math.floor(letters.length / 2)] + letters[letters.length - 1];
    })();

    // Restaurant + cafe auto-enable the Party size intake preset so
    // the kiosk / WhatsApp / mobile flows collect it, which then
    // drives the smart-table suggestion on the desk panel.
    const isRestaurantish =
      subtype.businessCategory === 'restaurant' || subtype.businessCategory === 'cafe';

    const channelDefaults: Record<string, unknown> = {
      business_category: subtype.businessCategory,
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

    // For restaurant-ish subtypes, append party_size as an enabled
    // preset in the intake_fields array so the kiosk / WhatsApp /
    // mobile flows collect it during intake.
    const intakeFields = Array.isArray(currentSettings.intake_fields)
      ? (currentSettings.intake_fields as any[])
      : [];
    if (isRestaurantish && !intakeFields.some((f) => f?.key === 'party_size')) {
      intakeFields.push({ key: 'party_size', type: 'preset', enabled: true, required: false });
    }

    await supabase
      .from('organizations')
      .update({ settings: { ...currentSettings, ...channelDefaults, intake_fields: intakeFields } as any })
      .eq('id', organizationId);

    // 11. Sign the admin straight in so the client doesn't need a second round-trip.
    const { data: sessionData } = await supabase.auth.signInWithPassword({ email, password });

    return NextResponse.json({
      organization_id: organizationId,
      office_id: office.id,
      office_name: office.name,
      department_id: firstDeptId,
      desk_id: firstDeskId,
      desk_name: firstDeskName,
      staff_id: staff?.id ?? null,
      user_id: authUserId,
      role: staff?.role ?? 'admin',
      seeded: {
        desks: plan.length,
        departments: subtype.departments.length,
        services: subtype.departments.reduce((n, d) => n + d.services.length, 0),
        tables: tableCount,
      },
      session: {
        access_token: sessionData.session?.access_token ?? null,
        refresh_token: sessionData.session?.refresh_token ?? null,
      },
    });
  } catch (err: any) {
    try { await supabase.auth.admin.deleteUser(authUserId); } catch {}
    return NextResponse.json({ error: err?.message ?? 'Onboarding failed' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { matchesOfficePublicSlug } from '@/lib/office-links';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('slug')?.trim();

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Find office by slug
  const { data: offices, error: officesError } = await supabase
    .from('offices')
    .select('id, name, address, organization_id, settings, operating_hours, timezone')
    .eq('is_active', true);

  if (officesError) {
    return NextResponse.json({ error: officesError.message }, { status: 500 });
  }

  const office = offices?.find((entry: any) => matchesOfficePublicSlug(entry, slug));

  if (!office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
  }

  // Fetch org settings, departments, and active tickets in parallel
  const [orgResult, deptsResult, ticketsResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('settings')
      .eq('id', office.organization_id)
      .single(),
    supabase
      .from('departments')
      .select('id, name, code, sort_order')
      .eq('office_id', office.id)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('tickets')
      .select('id, department_id, status, priority, created_at, estimated_wait_minutes')
      .eq('office_id', office.id)
      .in('status', ['waiting', 'called', 'serving'])
      .limit(500),
  ]);

  if (deptsResult.error) {
    return NextResponse.json({ error: deptsResult.error.message }, { status: 500 });
  }

  const tickets = ticketsResult.data ?? [];
  const departments = deptsResult.data ?? [];
  const orgSettings = (orgResult.data?.settings as Record<string, any> | null) ?? {};
  const bookingMode = orgSettings.booking_mode ?? 'simple';

  // Build per-department stats
  const deptStats = departments.map((dept: any) => {
    const deptTickets = tickets.filter((t: any) => t.department_id === dept.id);
    const waiting = deptTickets.filter((t: any) => t.status === 'waiting').length;
    const called = deptTickets.filter((t: any) => t.status === 'called').length;
    const serving = deptTickets.filter((t: any) => t.status === 'serving').length;

    // Estimate wait: use average estimated_wait_minutes from waiting tickets, fallback to 5 min/ticket
    const waitingTickets = deptTickets.filter((t: any) => t.status === 'waiting');
    const estimatedWait =
      waitingTickets.length === 0
        ? 0
        : waitingTickets.reduce((sum: number, t: any) => sum + (t.estimated_wait_minutes ?? 5), 0);

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      sort_order: dept.sort_order,
      waiting,
      called,
      serving,
      estimatedWaitMinutes: estimatedWait,
    };
  });

  const totalWaiting = deptStats.reduce((sum, d) => sum + d.waiting, 0);
  const totalServing = deptStats.reduce((sum, d) => sum + d.serving, 0);

  // Work schedule: normalize operating_hours to a weekday map (mon..sun ->
  // { open, close } | null). Compute "open now" against the office's timezone.
  const rawHours = ((office as any).operating_hours ?? {}) as Record<
    string,
    { open: string; close: string } | null
  >;
  const timezone = ((office as any).timezone as string | null) ?? null;
  const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  const operatingHours: Record<string, { open: string; close: string } | null> = {};
  for (const d of weekdayKeys) operatingHours[d] = rawHours[d] ?? null;

  // 24/7 override — stored as `visit_intake_override_mode = 'always_open'` at
  // either the org or office level (the "Always open" switch in Settings).
  const officeSettings = ((office as any).settings as Record<string, any> | null) ?? {};
  const alwaysOpen =
    officeSettings.visit_intake_override_mode === 'always_open' ||
    orgSettings.visit_intake_override_mode === 'always_open';

  // Helper: treat times as minutes since midnight. Supports overnight ranges
  // (close < open → spans midnight) and the common "close === open" shorthand
  // that admins use to mean "open all day".
  const parseMin = (v: string) => {
    const [h = '0', m = '0'] = (v ?? '').split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
  };

  let openNow = false;
  let todayKey: string | null = null;
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || undefined,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase() ?? '';
    const map: Record<string, string> = { mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun' };
    todayKey = map[wd] ?? null;
    const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
    let h24 = parseInt(hh, 10);
    if (h24 === 24) h24 = 0; // some locales format midnight as 24
    const nowMin = h24 * 60 + parseInt(mm, 10);

    if (alwaysOpen) {
      openNow = true;
    } else {
      const today = todayKey ? operatingHours[todayKey] : null;
      if (today) {
        const o = parseMin(today.open);
        const c = parseMin(today.close);
        if (o === c) {
          // open == close → treat as 24h
          openNow = true;
        } else if (c > o) {
          openNow = nowMin >= o && nowMin < c;
        } else {
          // overnight: e.g. 18:00 → 02:00
          openNow = nowMin >= o || nowMin < c;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    office: {
      id: office.id,
      name: office.name,
      address: office.address ?? null,
    },
    departments: deptStats,
    totalWaiting,
    totalServing,
    bookingMode,
    operatingHours,
    timezone,
    openNow,
    todayKey,
    alwaysOpen,
  });
}

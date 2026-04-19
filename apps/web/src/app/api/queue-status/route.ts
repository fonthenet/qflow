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
    const nowMin = parseInt(hh, 10) * 60 + parseInt(mm, 10);
    const today = todayKey ? operatingHours[todayKey] : null;
    if (today) {
      const [oh, om] = today.open.split(':').map(Number);
      const [ch, cm] = today.close.split(':').map(Number);
      const o = oh * 60 + om;
      const c = ch * 60 + cm;
      openNow = nowMin >= o && nowMin < c;
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
  });
}

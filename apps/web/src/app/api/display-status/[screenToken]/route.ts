import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { mergeDisplayScreenRuntime } from '@/lib/display-runtime';
import { matchesOfficePublicToken } from '@/lib/office-links';
import { getOfficeDayStartIso } from '@/lib/office-day';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ screenToken: string }> }
) {
  const { screenToken } = await params;
  const supabase = createAdminClient();

  // 1) Try finding display screen by screen_token
  let screen: any = null;
  let office: any = null;

  const { data: screenByToken } = await supabase
    .from('display_screens')
    .select('*')
    .eq('screen_token', screenToken)
    .eq('is_active', true)
    .maybeSingle();

  if (screenByToken) {
    screen = screenByToken;
    const { data: screenOffice } = await supabase
      .from('offices')
      .select('*, organization:organizations(*)')
      .eq('id', screen.office_id)
      .maybeSingle();
    office = screenOffice;
  } else {
    // 2) Fallback: treat token as office public token
    const { data: offices } = await supabase
      .from('offices')
      .select('*, organization:organizations(*)')
      .eq('is_active', true);

    office = offices?.find((entry: any) => matchesOfficePublicToken(entry, screenToken));
    if (office) {
      const { data: defaultScreen } = await supabase
        .from('display_screens')
        .select('*')
        .eq('office_id', office.id)
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .maybeSingle();

      screen = defaultScreen ?? {
        id: `virtual-${office.id}`,
        office_id: office.id,
        name: 'Default',
        screen_token: screenToken,
        settings: {},
        is_active: true,
      };
    }
  }

  if (!screen || !office) {
    return NextResponse.json({ error: 'Display screen not found' }, { status: 404 });
  }

  const platformConfig = resolvePlatformConfig({
    organizationSettings: (office.organization as any)?.settings ?? {},
    officeSettings: office.settings ?? {},
  });
  const privacySafe = platformConfig.capabilityFlags.privacySafeDisplay;

  const [{ data: activeTickets }, { data: waitingTickets }] = await Promise.all([
    supabase
      .from('tickets')
      .select('*, desk:desks(name, display_name), service:services(name), department:departments(name, code)')
      .eq('office_id', screen.office_id)
      .in('status', ['called', 'serving'])
      .order('called_at', { ascending: false }),
    supabase
      .from('tickets')
      .select('id, department_id, ticket_number, created_at, priority, appointment_id, customer_data, department:departments(name, code)')
      .eq('office_id', screen.office_id)
      .eq('status', 'waiting')
      .order('created_at')
      .limit(200),
  ]);

  // Get total waiting count separately (may exceed the 200 limit above)
  const { count: totalWaitingCount } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('office_id', screen.office_id)
    .eq('status', 'waiting');

  const officeDayStartIso = getOfficeDayStartIso(office.timezone);
  const { count: servedTodayCount } = await supabase
    .from('tickets')
    .select('id', { count: 'exact' })
    .eq('office_id', screen.office_id)
    .eq('status', 'served')
    .gte('created_at', officeDayStartIso)
    .limit(0);

  const mergedScreen = mergeDisplayScreenRuntime(
    {
      ...screen,
      settings: (screen.settings as Record<string, unknown> | null) ?? {},
    },
    platformConfig.experienceProfile.display
  );

  // Inject org-level voice_announcements into screen settings
  const orgSettings = (office.organization as any)?.settings ?? {};
  if (orgSettings.voice_announcements === true) {
    (mergedScreen.settings as Record<string, unknown>).voice_announcements = true;
  }

  const sanitizedActiveTickets = privacySafe
    ? (activeTickets ?? []).map((ticket: any) => ({
        ...ticket,
        service: ticket.service ? { ...ticket.service, name: '' } : ticket.service,
      }))
    : activeTickets ?? [];

  return NextResponse.json(
    {
      screen: mergedScreen,
      activeTickets: sanitizedActiveTickets,
      waitingTickets: waitingTickets ?? [],
      totalWaitingCount: totalWaitingCount ?? (waitingTickets ?? []).length,
      servedTodayCount: servedTodayCount ?? 0,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

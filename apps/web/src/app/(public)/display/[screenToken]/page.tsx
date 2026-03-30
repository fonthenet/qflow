import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { DisplayBoard } from '@/components/display/display-board';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { CALL_WAIT_SECONDS } from '@/lib/queue/call-timing';
import { mergeDisplayScreenRuntime } from '@/lib/display-runtime';
import { matchesOfficePublicToken } from '@/lib/office-links';

interface DisplayPageProps {
  params: Promise<{ screenToken: string }>;
}

function getOfficeDayStartIso(timezone?: string | null) {
  const now = new Date();
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return `${localDate}T00:00:00`;
}

export default async function DisplayPage({ params }: DisplayPageProps) {
  const { screenToken } = await params;
  const supabase = createAdminClient();

  // 1) Try finding a display screen by its screen_token
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
    // 2) Fallback: treat token as office public token (same as kiosk uses)
    const { data: offices } = await supabase
      .from('offices')
      .select('*, organization:organizations(*)')
      .eq('is_active', true);

    office = offices?.find((entry: any) => matchesOfficePublicToken(entry, screenToken));

    if (office) {
      // Try to find default display screen for this office
      const { data: defaultScreen } = await supabase
        .from('display_screens')
        .select('*')
        .eq('office_id', office.id)
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .maybeSingle();

      // Use the screen if found, otherwise create a virtual default
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

  if (!screen || !office) notFound();
  const platformConfig = resolvePlatformConfig({
    organizationSettings: (office.organization as any)?.settings ?? {},
    officeSettings: office.settings ?? {},
  });
  const privacySafe = platformConfig.capabilityFlags.privacySafeDisplay;
  const screenSettings = (screen.settings as Record<string, unknown> | null) ?? {};

  // Get departments for this office
  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, code')
    .eq('office_id', screen.office_id)
    .eq('is_active', true)
    .order('sort_order');

  // Get currently active tickets (called + serving)
  const { data: activeTickets } = await supabase
    .from('tickets')
    .select('*, desk:desks(name, display_name), service:services(name)')
    .eq('office_id', screen.office_id)
    .in('status', ['called', 'serving'])
    .order('called_at', { ascending: false });

  // Get waiting count per department
  const { data: waitingTickets } = await supabase
    .from('tickets')
    .select('id, department_id, ticket_number, created_at, priority, appointment_id, customer_data, department:departments(name, code)')
    .eq('office_id', screen.office_id)
    .eq('status', 'waiting')
    .order('created_at');

  const officeDayStartIso = getOfficeDayStartIso(office.timezone);
  const { count: servedTodayCount } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('office_id', screen.office_id)
    .eq('status', 'served')
    .gte('created_at', officeDayStartIso);

  const mergedScreen = mergeDisplayScreenRuntime(
    {
      ...screen,
      settings: screenSettings,
    },
    platformConfig.experienceProfile.display
  );
  const sanitizedActiveTickets = privacySafe
    ? (activeTickets ?? []).map((ticket: any) => ({
        ...ticket,
        service: ticket.service ? { ...ticket.service, name: '' } : ticket.service,
      }))
    : activeTickets ?? [];

  return (
    <DisplayBoard
      screen={mergedScreen}
      office={office}
      departments={departments || []}
      initialActiveTickets={sanitizedActiveTickets}
      initialWaitingTickets={waitingTickets || []}
      initialServedTodayCount={servedTodayCount ?? 0}
      calledTicketCountdownSeconds={CALL_WAIT_SECONDS}
    />
  );
}

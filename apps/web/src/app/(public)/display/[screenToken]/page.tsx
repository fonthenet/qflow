import { createAdminClient } from '@/lib/supabase/admin';
import { notFound } from 'next/navigation';
import { DisplayBoard } from '@/components/display/display-board';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { CALL_WAIT_SECONDS } from '@/lib/queue/call-timing';

interface DisplayPageProps {
  params: Promise<{ screenToken: string }>;
}

export default async function DisplayPage({ params }: DisplayPageProps) {
  const { screenToken } = await params;
  const supabase = createAdminClient();

  // Find display screen by token
  const { data: screen } = await supabase
    .from('display_screens')
    .select('*')
    .eq('screen_token', screenToken)
    .eq('is_active', true)
    .single();

  if (!screen) notFound();
  const { data: office } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('id', screen.office_id)
    .maybeSingle();

  if (!office) notFound();
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
    .select('id, department_id, ticket_number, created_at')
    .eq('office_id', screen.office_id)
    .eq('status', 'waiting')
    .order('created_at');

  const mergedScreen = {
    ...screen,
    layout: screen.layout ?? platformConfig.experienceProfile.display.defaultLayout,
    settings: {
      theme: platformConfig.experienceProfile.display.theme,
      show_clock: platformConfig.experienceProfile.display.showClock,
      show_next_up: platformConfig.experienceProfile.display.showNextUp,
      show_department_breakdown: platformConfig.experienceProfile.display.showDepartmentBreakdown,
      announcement_sound: platformConfig.experienceProfile.display.announcementSound,
      ...screenSettings,
    },
  };
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
      calledTicketCountdownSeconds={CALL_WAIT_SECONDS}
    />
  );
}

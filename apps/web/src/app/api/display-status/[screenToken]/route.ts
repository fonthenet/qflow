import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePlatformConfig } from '@/lib/platform/config';
import { mergeDisplayScreenRuntime } from '@/lib/display-runtime';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ screenToken: string }> }
) {
  const { screenToken } = await params;
  const supabase = createAdminClient();

  const { data: screen } = await supabase
    .from('display_screens')
    .select('*')
    .eq('screen_token', screenToken)
    .eq('is_active', true)
    .maybeSingle();

  if (!screen) {
    return NextResponse.json({ error: 'Display screen not found' }, { status: 404 });
  }

  const { data: office } = await supabase
    .from('offices')
    .select('*, organization:organizations(*)')
    .eq('id', screen.office_id)
    .maybeSingle();

  if (!office) {
    return NextResponse.json({ error: 'Office not found' }, { status: 404 });
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
      .select('id, department_id, ticket_number, created_at')
      .eq('office_id', screen.office_id)
      .eq('status', 'waiting')
      .order('created_at'),
  ]);

  const mergedScreen = mergeDisplayScreenRuntime(
    {
      ...screen,
      settings: (screen.settings as Record<string, unknown> | null) ?? {},
    },
    platformConfig.experienceProfile.display
  );

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
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}

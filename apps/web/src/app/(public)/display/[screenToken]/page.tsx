import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { DisplayBoard } from '@/components/display/display-board';

interface DisplayPageProps {
  params: Promise<{ screenToken: string }>;
}

export default async function DisplayPage({ params }: DisplayPageProps) {
  const { screenToken } = await params;
  const supabase = await createClient();

  // Find display screen by token
  const { data: screen } = await supabase
    .from('display_screens')
    .select('*, office:offices(*, organization:organizations(name))')
    .eq('screen_token', screenToken)
    .eq('is_active', true)
    .single();

  if (!screen) notFound();

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

  return (
    <DisplayBoard
      screen={screen}
      office={screen.office}
      departments={departments || []}
      initialActiveTickets={activeTickets || []}
      initialWaitingTickets={waitingTickets || []}
    />
  );
}

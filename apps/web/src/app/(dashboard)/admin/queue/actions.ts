'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

async function getStaffOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id')
    .eq('auth_user_id', user.id)
    .single();
  if (!staff) redirect('/login');

  return { supabase, orgId: staff.organization_id };
}

async function verifyTicketOwnership(ticketId: string) {
  const { supabase, orgId } = await getStaffOrg();

  // Verify ticket belongs to this org via office
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, status, office_id, offices!inner(organization_id)')
    .eq('id', ticketId)
    .single();

  if (!ticket) throw new Error('Ticket not found');

  const orgCheck = (ticket as any).offices?.organization_id;
  if (orgCheck !== orgId) throw new Error('Unauthorized');

  return { supabase, ticket };
}

export async function cancelVisit(ticketId: string) {
  const { supabase, ticket } = await verifyTicketOwnership(ticketId);

  const activeStatuses = ['waiting', 'issued', 'called', 'serving'];
  if (!activeStatuses.includes(ticket.status)) {
    throw new Error('Can only cancel active visits');
  }

  await supabase
    .from('tickets')
    .update({
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    data: { from_status: ticket.status, to_status: 'cancelled', source: 'admin' },
  });
}

export async function deleteVisit(ticketId: string) {
  const { supabase, ticket } = await verifyTicketOwnership(ticketId);

  const terminalStatuses = ['served', 'completed', 'no_show', 'cancelled', 'transferred'];
  if (!terminalStatuses.includes(ticket.status)) {
    throw new Error('Can only delete completed visits');
  }

  // Delete events first (FK constraint)
  await supabase.from('ticket_events').delete().eq('ticket_id', ticketId);
  await supabase.from('tickets').delete().eq('id', ticketId);
}

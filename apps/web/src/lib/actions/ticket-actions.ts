'use server';

import { createClient } from '@/lib/supabase/server';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { sendPushToTicket } from '@/lib/send-push';

export async function createTicket(
  officeId: string,
  departmentId: string,
  serviceId: string,
  customerData?: Record<string, unknown> | null,
  status: 'issued' | 'waiting' = 'waiting'
) {
  const supabase = await createClient();

  // Generate daily ticket number via RPC
  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: departmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // Estimate wait time
  const { data: waitMinutes } = await supabase.rpc('estimate_wait_time', {
    p_department_id: departmentId,
    p_service_id: serviceId,
  });

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      office_id: officeId,
      department_id: departmentId,
      service_id: serviceId,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status,
      customer_data: customerData ?? null,
      estimated_wait_minutes: waitMinutes ?? null,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/desk');
  return { data: ticket };
}

export async function callNextTicket(deskId: string, staffId: string) {
  const supabase = await createClient();

  const { data: ticketId, error } = await supabase.rpc('call_next_ticket', {
    p_desk_id: deskId,
    p_staff_id: staffId,
  });

  if (error) {
    return { error: error.message };
  }

  if (!ticketId) {
    return { error: 'No tickets waiting in queue' };
  }

  // Fetch the full ticket data
  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*, department:departments(*), service:services(*)')
    .eq('id', ticketId)
    .single();

  if (fetchError) {
    return { error: fetchError.message };
  }

  // Send push notification directly (local Node.js stays alive, no serverless timeout)
  // Fetch desk name for the notification message
  const { data: deskData } = await supabase
    .from('desks')
    .select('name, display_name')
    .eq('id', ticket.desk_id)
    .single();
  const deskName = deskData?.display_name || deskData?.name || 'your desk';

  await sendPushToTicket(ticketId, {
    title: "It's Your Turn!",
    body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
    tag: `called-${ticketId}`,
    url: `/q/${ticket.qr_token}`,
  });

  revalidatePath('/desk');
  return { data: ticket };
}

export async function startServing(ticketId: string, staffId: string) {
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      status: 'serving',
      serving_started_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('status', 'called')
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'called',
    to_status: 'serving',
    staff_id: staffId,
  });

  revalidatePath('/desk');
  return { data: ticket };
}

export async function markServed(ticketId: string, staffId: string) {
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      status: 'served',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('status', 'serving')
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'serving',
    to_status: 'served',
    staff_id: staffId,
  });

  revalidatePath('/desk');
  return { data: ticket };
}

export async function markNoShow(ticketId: string, staffId: string) {
  const supabase = await createClient();

  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      status: 'no_show',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .eq('status', 'called')
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'called',
    to_status: 'no_show',
    staff_id: staffId,
  });

  revalidatePath('/desk');
  return { data: ticket };
}

export async function transferTicket(
  ticketId: string,
  targetDepartmentId: string,
  targetServiceId: string
) {
  const supabase = await createClient();

  // Fetch the original ticket
  const { data: originalTicket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchError || !originalTicket) {
    return { error: fetchError?.message ?? 'Ticket not found' };
  }

  // Generate new ticket number for target department
  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: targetDepartmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

  // Create the new ticket in the target department
  const { data: newTicket, error: insertError } = await supabase
    .from('tickets')
    .insert({
      office_id: originalTicket.office_id,
      department_id: targetDepartmentId,
      service_id: targetServiceId,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status: 'waiting',
      customer_data: originalTicket.customer_data,
      customer_id: originalTicket.customer_id,
      transferred_from_ticket_id: ticketId,
      priority: originalTicket.priority,
      priority_category_id: originalTicket.priority_category_id,
    })
    .select()
    .single();

  if (insertError) {
    return { error: insertError.message };
  }

  // Mark the original ticket as transferred
  const { error: updateError } = await supabase
    .from('tickets')
    .update({
      status: 'transferred',
      completed_at: new Date().toISOString(),
    })
    .eq('id', ticketId);

  if (updateError) {
    return { error: updateError.message };
  }

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'transferred',
    from_status: originalTicket.status,
    to_status: 'transferred',
    metadata: {
      new_ticket_id: newTicket.id,
      target_department_id: targetDepartmentId,
      target_service_id: targetServiceId,
    },
  });

  revalidatePath('/desk');
  return { data: newTicket };
}

export async function recallTicket(ticketId: string) {
  const supabase = await createClient();

  // Verify ticket is in 'called' status
  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('status', 'called')
    .single();

  if (fetchError || !ticket) {
    return { error: 'Ticket is not in called status' };
  }

  // Reset called_at so the customer's countdown timer restarts + increment recall count
  const { error: updateError } = await supabase
    .from('tickets')
    .update({
      called_at: new Date().toISOString(),
      recall_count: (ticket.recall_count ?? 0) + 1,
    })
    .eq('id', ticketId);

  if (updateError) {
    return { error: 'Failed to reset timer' };
  }

  // Broadcast recall via Supabase Realtime REST API (server-side, no WebSocket)
  await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/realtime/v1/api/broadcast`,
    {
      method: 'POST',
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `recall-${ticket.office_id}`,
            event: 'ticket_recall',
            payload: {
              ticket_id: ticket.id,
              ticket_number: ticket.ticket_number,
              desk_id: ticket.desk_id,
            },
          },
        ],
      }),
    }
  );

  // Send push notification directly for recall
  const { data: deskData2 } = await supabase
    .from('desks')
    .select('name, display_name')
    .eq('id', ticket.desk_id)
    .single();
  const recallDeskName = deskData2?.display_name || deskData2?.name || 'your desk';

  await sendPushToTicket(ticketId, {
    title: 'Reminder: Your Turn!',
    body: `Ticket ${ticket.ticket_number} — Please go to ${recallDeskName}`,
    tag: `recall-${ticketId}`,
    url: `/q/${ticket.qr_token}`,
  });

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'recall',
    desk_id: ticket.desk_id,
  });

  // Also insert a notification record
  await supabase.from('notifications').insert({
    ticket_id: ticketId,
    type: 'recall',
    channel: 'realtime',
    payload: {
      ticket_number: ticket.ticket_number,
      desk_id: ticket.desk_id,
    },
    sent_at: new Date().toISOString(),
  });

  return { data: ticket };
}

export async function resetTicketToQueue(ticketId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from('tickets')
    .update({ status: 'waiting', desk_id: null, called_at: null })
    .eq('id', ticketId)
    .in('status', ['called', 'serving']);

  if (error) {
    return { error: 'Failed to reset ticket' };
  }

  return { data: true };
}

export async function assignDesk(deskId: string, staffId: string) {
  const supabase = await createClient();

  // Update desk with current staff
  const { data: desk, error } = await supabase
    .from('desks')
    .update({
      current_staff_id: staffId,
      status: 'open',
    })
    .eq('id', deskId)
    .select('*, department:departments(*)')
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/desk');
  return { data: desk };
}

export async function unassignDesk(deskId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from('desks')
    .update({
      current_staff_id: null,
      status: 'closed',
    })
    .eq('id', deskId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/desk');
  return { data: true };
}

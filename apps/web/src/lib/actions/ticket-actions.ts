'use server';

import { createClient } from '@/lib/supabase/server';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { notifyWaitingTickets } from '@/lib/send-push';
import { notifyWaitingAndroidTickets } from '@/lib/android-push';
import { getPlanLimits, type PlanId } from '@/lib/plan-limits';
import { sendTicketCalledEmail } from '@/lib/email';
import { dispatchWebhook, type WebhookEvent } from '@/lib/webhooks';
import {
  enqueueAlertJob,
  enqueueLiveActivitySyncJob,
  kickNotificationJobProcessor,
} from '@/lib/notification-jobs';

const LIVE_ACTIVITY_FOLLOWUP_DELAY_MS = 2500;

const STATUS_TO_WEBHOOK: Record<string, WebhookEvent> = {
  called: 'ticket.called',
  serving: 'ticket.serving',
  served: 'ticket.served',
  no_show: 'ticket.no_show',
  cancelled: 'ticket.cancelled',
  transferred: 'ticket.transferred',
};

function revalidateQueueSurfaces() {
  revalidatePath('/desk');
  revalidatePath('/admin/queue');
}

async function getOfficeContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  officeId: string
): Promise<{ organizationId: string | null; officeName: string }> {
  const { data } = await supabase
    .from('offices')
    .select('organization_id, name')
    .eq('id', officeId)
    .single();

  return {
    organizationId: data?.organization_id ?? null,
    officeName: data?.name ?? 'QueueFlow',
  };
}

async function dispatchTicketWebhook(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticket: { office_id: string; status: string; [key: string]: any }
) {
  const event = STATUS_TO_WEBHOOK[ticket.status];
  if (!event) return;

  const { organizationId } = await getOfficeContext(supabase, ticket.office_id);
  if (organizationId) {
    dispatchWebhook(organizationId, event, ticket).catch(() => {});
  }
}

async function getDeskName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  deskId: string | null
): Promise<string> {
  if (!deskId) return 'your desk';

  const { data } = await supabase
    .from('desks')
    .select('display_name, name')
    .eq('id', deskId)
    .single();

  return data?.display_name ?? data?.name ?? 'your desk';
}

export async function createTicket(
  officeId: string,
  departmentId: string,
  serviceId: string,
  customerData?: Record<string, unknown> | null,
  status: 'issued' | 'waiting' = 'waiting'
) {
  const supabase = await createClient();

  const { data: officeData } = await supabase
    .from('offices')
    .select('organization_id')
    .eq('id', officeId)
    .single();

  if (officeData?.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('plan_id, monthly_visit_count')
      .eq('id', officeData.organization_id)
      .single();

    if (org) {
      const limits = getPlanLimits(org.plan_id as PlanId);
      if (
        limits.customersPerMonth !== Infinity &&
        org.monthly_visit_count >= limits.customersPerMonth
      ) {
        return { error: 'Monthly visit limit reached. Please upgrade your plan.' };
      }
    }
  }

  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: departmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

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

  if (officeData?.organization_id && ticket) {
    dispatchWebhook(officeData.organization_id, 'ticket.created', ticket).catch(() => {});
  }

  revalidateQueueSurfaces();
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

  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*, department:departments(*), service:services(*)')
    .eq('id', ticketId)
    .single();

  if (fetchError) {
    return { error: fetchError.message };
  }

  if (ticket) {
    const deskName = await getDeskName(supabase, ticket.desk_id);

    await Promise.all([
      enqueueAlertJob({
        event: 'called',
        ticketId,
        ticketNumber: ticket.ticket_number,
        qrToken: ticket.qr_token,
        officeId: ticket.office_id,
        customerData: ticket.customer_data,
        deskName,
        status: ticket.status,
        recallCount: ticket.recall_count ?? 0,
        title: "It's Your Turn!",
        body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
        url: `/q/${ticket.qr_token}`,
        sendApns: true,
        sendAndroid: true,
        sendSms: true,
        sendWebPush: true,
      }),
      enqueueLiveActivitySyncJob({
        event: 'called',
        ticketId,
        delayMs: LIVE_ACTIVITY_FOLLOWUP_DELAY_MS,
      }),
    ]);
    kickNotificationJobProcessor();

    const customerEmail = ticket.customer_data?.email as string | undefined;
    const customerName = (ticket.customer_data?.name as string) || 'Customer';
    if (customerEmail) {
      const { officeName } = await getOfficeContext(supabase, ticket.office_id);
      sendTicketCalledEmail(customerEmail, {
        customerName,
        ticketNumber: ticket.ticket_number,
        deskName,
        officeName,
      }).catch((err) => console.error('[CallNext] Email notification error:', err));
    }

    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingAndroidTickets error:', err)
    );

    await dispatchTicketWebhook(supabase, ticket);
  }

  revalidateQueueSurfaces();
  return { data: ticket, smsSent: false, deliveryQueued: true };
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

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'called',
    to_status: 'serving',
    staff_id: staffId,
  });

  if (ticket) {
    const deskName = await getDeskName(supabase, ticket.desk_id);

    await Promise.all([
      enqueueAlertJob({
        event: 'serving',
        ticketId,
        ticketNumber: ticket.ticket_number,
        qrToken: ticket.qr_token,
        officeId: ticket.office_id,
        customerData: ticket.customer_data,
        deskName,
        status: ticket.status,
        recallCount: ticket.recall_count ?? 0,
        title: 'Being Served',
        body: `Ticket ${ticket.ticket_number} at ${deskName}`,
        url: `/q/${ticket.qr_token}`,
        sendApns: false,
        sendAndroid: true,
        sendSms: false,
        sendWebPush: true,
      }),
      enqueueLiveActivitySyncJob({
        event: 'serving',
        ticketId,
      }),
    ]);
    kickNotificationJobProcessor();

    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingAndroidTickets error:', err)
    );

    await dispatchTicketWebhook(supabase, ticket);
  }

  revalidateQueueSurfaces();
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

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'serving',
    to_status: 'served',
    staff_id: staffId,
  });

  if (ticket) {
    await Promise.all([
      enqueueAlertJob({
        event: 'served',
        ticketId,
        ticketNumber: ticket.ticket_number,
        qrToken: ticket.qr_token,
        officeId: ticket.office_id,
        customerData: ticket.customer_data,
        deskName: 'your desk',
        status: ticket.status,
        recallCount: ticket.recall_count ?? 0,
        title: 'Visit Complete',
        body: 'Thank you! Tap to leave feedback.',
        url: `/q/${ticket.qr_token}`,
        sendApns: false,
        sendAndroid: true,
        sendSms: false,
        sendWebPush: true,
      }),
      enqueueLiveActivitySyncJob({
        event: 'served',
        ticketId,
      }),
    ]);
    kickNotificationJobProcessor();

    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingAndroidTickets error:', err)
    );

    await dispatchTicketWebhook(supabase, ticket);
  }

  revalidateQueueSurfaces();
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

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'status_change',
    from_status: 'called',
    to_status: 'no_show',
    staff_id: staffId,
  });

  if (ticket) {
    await Promise.all([
      enqueueAlertJob({
        event: 'no_show',
        ticketId,
        ticketNumber: ticket.ticket_number,
        qrToken: ticket.qr_token,
        officeId: ticket.office_id,
        customerData: ticket.customer_data,
        deskName: 'your desk',
        status: ticket.status,
        recallCount: ticket.recall_count ?? 0,
        title: 'Missed Your Turn',
        body: `Ticket ${ticket.ticket_number} was marked as no-show.`,
        url: `/q/${ticket.qr_token}`,
        sendApns: false,
        sendAndroid: true,
        sendSms: false,
        sendWebPush: true,
      }),
      enqueueLiveActivitySyncJob({
        event: 'no_show',
        ticketId,
      }),
    ]);
    kickNotificationJobProcessor();

    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingAndroidTickets error:', err)
    );

    await dispatchTicketWebhook(supabase, ticket);
  }

  revalidateQueueSurfaces();
  return { data: ticket };
}

export async function transferTicket(
  ticketId: string,
  targetDepartmentId: string,
  targetServiceId: string
) {
  const supabase = await createClient();

  const { data: originalTicket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchError || !originalTicket) {
    return { error: fetchError?.message ?? 'Ticket not found' };
  }

  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: targetDepartmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);

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

  await enqueueLiveActivitySyncJob({
    event: 'transferred',
    ticketId,
  });
  kickNotificationJobProcessor();

  await dispatchTicketWebhook(supabase, {
    ...originalTicket,
    office_id: originalTicket.office_id,
    status: 'transferred',
  });

  revalidateQueueSurfaces();
  return { data: newTicket };
}

export async function recallTicket(ticketId: string) {
  const supabase = await createClient();

  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .eq('status', 'called')
    .single();

  if (fetchError || !ticket) {
    return { error: 'Ticket is not in called status' };
  }

  const newRecallCount = (ticket.recall_count ?? 0) + 1;
  const { error: updateError } = await supabase
    .from('tickets')
    .update({
      called_at: new Date().toISOString(),
      recall_count: newRecallCount,
    })
    .eq('id', ticketId);

  if (updateError) {
    return { error: 'Failed to reset timer' };
  }

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

  const deskName = await getDeskName(supabase, ticket.desk_id);

  await Promise.all([
    enqueueAlertJob({
      event: 'recall',
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      officeId: ticket.office_id,
      customerData: ticket.customer_data,
      deskName,
      status: ticket.status,
      recallCount: newRecallCount,
      title: 'Reminder: Your Turn!',
      body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
      url: `/q/${ticket.qr_token}`,
      sendApns: true,
      sendAndroid: true,
      sendSms: true,
      sendWebPush: true,
    }),
    enqueueLiveActivitySyncJob({
      event: 'recall',
      ticketId,
      delayMs: LIVE_ACTIVITY_FOLLOWUP_DELAY_MS,
    }),
  ]);
  kickNotificationJobProcessor();

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'recall',
    desk_id: ticket.desk_id,
  });

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

  revalidateQueueSurfaces();
  return { data: ticket, smsSent: false, deliveryQueued: true };
}

export async function buzzTicket(ticketId: string) {
  const supabase = await createClient();

  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .in('status', ['waiting', 'called', 'serving'])
    .single();

  if (fetchError || !ticket) {
    return { error: 'Ticket not found or already completed' };
  }

  const deskName = await getDeskName(supabase, ticket.desk_id);

  await Promise.all([
    enqueueAlertJob({
      event: 'buzz',
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      officeId: ticket.office_id,
      customerData: ticket.customer_data,
      deskName,
      status: ticket.status,
      recallCount: ticket.recall_count ?? 0,
      title: 'Buzz!',
      body: ticket.status === 'called'
        ? `Ticket ${ticket.ticket_number} — Please go to ${deskName} NOW!`
        : `Ticket ${ticket.ticket_number} — Attention needed`,
      url: `/q/${ticket.qr_token}`,
      sendApns: true,
      sendAndroid: true,
      sendSms: true,
      sendWebPush: true,
    }),
    enqueueLiveActivitySyncJob({
      event: 'buzz',
      ticketId,
      delayMs: LIVE_ACTIVITY_FOLLOWUP_DELAY_MS,
    }),
  ]);
  kickNotificationJobProcessor();

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
            topic: `buzz-${ticket.office_id}`,
            event: 'ticket_buzz',
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

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: 'buzz',
    desk_id: ticket.desk_id,
  });

  await supabase.from('notifications').insert({
    ticket_id: ticketId,
    type: 'buzz',
    channel: 'realtime',
    payload: {
      ticket_number: ticket.ticket_number,
      desk_id: ticket.desk_id,
    },
    sent_at: new Date().toISOString(),
  });

  revalidateQueueSurfaces();
  return { data: ticket, smsSent: false, deliveryQueued: true };
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

  await enqueueLiveActivitySyncJob({
    event: 'reset',
    ticketId,
  });
  kickNotificationJobProcessor();

  revalidateQueueSurfaces();
  return { data: true };
}

export async function assignDesk(deskId: string, staffId: string) {
  const supabase = await createClient();

  const { data: targetDesk, error: targetDeskError } = await supabase
    .from('desks')
    .select('id, office_id, is_active')
    .eq('id', deskId)
    .single();

  if (targetDeskError || !targetDesk) {
    return { error: 'Desk not found' };
  }

  if (!targetDesk.is_active) {
    return { error: 'Desk is inactive' };
  }

  const { data: staffRecord, error: staffError } = await supabase
    .from('staff')
    .select('id, office_id, is_active')
    .eq('id', staffId)
    .single();

  if (staffError || !staffRecord) {
    return { error: 'Staff member not found' };
  }

  if (!staffRecord.is_active) {
    return { error: 'Staff member is inactive' };
  }

  if (staffRecord.office_id && staffRecord.office_id !== targetDesk.office_id) {
    return { error: 'Staff member can only be assigned to a desk in their office.' };
  }

  await supabase
    .from('desks')
    .update({ current_staff_id: null, status: 'closed' })
    .eq('current_staff_id', staffId)
    .neq('id', deskId);

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

  revalidateQueueSurfaces();
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

  revalidateQueueSurfaces();
  return { data: true };
}

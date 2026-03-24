'use server';

import { TICKET_EVENT_TYPES } from '@queueflow/shared';
import { logAuditEvent } from '@/lib/audit';
import {
  getDeskById,
  getDepartmentById,
  getServiceById,
  getStaffContext,
  getTicketById,
  requireDeskOperatorForDesk,
  requireOfficeAccess,
  requireOfficeMembership,
} from '@/lib/authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { nanoid } from 'nanoid';
import { revalidatePath } from 'next/cache';
import { sendPushToTicket, notifyWaitingTickets } from '@/lib/send-push';
import { sendAPNsToTicket, sendLiveActivityUpdateForTicket } from '@/lib/apns';
import {
  notifyWaitingAndroidTickets,
  sendAndroidToTicket,
} from '@/lib/android-push';
import {
  extractTicketPhone,
  getPriorityAlertConfig,
  isPriorityAlertEventEnabled,
  type PriorityAlertEvent,
} from '@/lib/priority-alerts';
import { isSmsProviderConfigured, sendSmsMessage } from '@/lib/sms';

const LIVE_ACTIVITY_FOLLOWUP_DELAY_MS = 2500;

async function syncLiveActivity(ticketId: string, source: string): Promise<boolean> {
  const synced = await sendLiveActivityUpdateForTicket(ticketId).catch((err) => {
    console.error(`[${source}] Live Activity sync error:`, err);
    return false;
  });

  if (!synced) {
    console.warn(`[${source}] Live Activity update was not sent for ticket:`, ticketId);
  }

  return synced;
}

async function syncLiveActivityAfterAlert(ticketId: string, source: string): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, LIVE_ACTIVITY_FOLLOWUP_DELAY_MS));
  return syncLiveActivity(ticketId, source);
}

/** Helper to get desk display name */
async function getDeskName(supabase: Awaited<ReturnType<typeof createClient>>, deskId: string | null): Promise<string> {
  if (!deskId) return 'your desk';
  const { data } = await supabase
    .from('desks')
    .select('display_name, name')
    .eq('id', deskId)
    .single();
  return data?.display_name ?? data?.name ?? 'your desk';
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

function buildPriorityAlertMessage(params: {
  event: PriorityAlertEvent;
  ticketNumber: string;
  deskName: string;
  officeName: string;
  trackUrl: string;
  status: string;
}): string {
  const { event, ticketNumber, deskName, officeName, trackUrl, status } = params;

  switch (event) {
    case 'called':
      return `QueueFlow: Ticket ${ticketNumber} is now called at ${officeName}. Go to ${deskName}. Track: ${trackUrl}`;
    case 'recall':
      return `QueueFlow reminder: Ticket ${ticketNumber} is still waiting for you at ${deskName}. Track: ${trackUrl}`;
    case 'buzz':
      return status === 'called'
        ? `QueueFlow buzz: Ticket ${ticketNumber}, please go to ${deskName} now. Track: ${trackUrl}`
        : `QueueFlow buzz: Staff is trying to reach ticket ${ticketNumber}. Open your queue page: ${trackUrl}`;
    default:
      return `QueueFlow update for ticket ${ticketNumber}: ${trackUrl}`;
  }
}

function buildAbsoluteTicketUrl(qrToken: string): string {
  const baseUrl = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflow-sigma.vercel.app'
  ).replace(/\/+$/, '');

  return `${baseUrl}/q/${qrToken}`;
}

async function maybeSendPriorityAlertSms(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    ticket: {
      id: string;
      office_id: string;
      qr_token: string;
      ticket_number: string;
      status: string;
      desk_id: string | null;
      customer_data: unknown;
    };
    event: PriorityAlertEvent;
    deskName: string;
  }
): Promise<{ sent: boolean; reason?: string }> {
  const { ticket, event, deskName } = params;
  const customerPhone = extractTicketPhone(ticket.customer_data);

  if (!customerPhone) {
    return { sent: false, reason: 'no phone on ticket' };
  }

  const { organizationId, officeName } = await getOfficeContext(supabase, ticket.office_id);
  if (!organizationId) {
    return { sent: false, reason: 'office has no organization' };
  }

  const { data: organization } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .single();

  const config = getPriorityAlertConfig(
    (organization?.settings as Record<string, any> | null) ?? null,
    isSmsProviderConfigured()
  );

  if (!config.enabled) {
    return { sent: false, reason: 'priority alerts disabled' };
  }

  if (!config.providerReady) {
    return { sent: false, reason: 'sms provider not configured' };
  }

  if (!isPriorityAlertEventEnabled(config, event)) {
    return { sent: false, reason: `${event} sms disabled` };
  }

  const message = buildPriorityAlertMessage({
    event,
    ticketNumber: ticket.ticket_number,
    deskName,
    officeName,
    trackUrl: buildAbsoluteTicketUrl(ticket.qr_token),
    status: ticket.status,
  });

  const result = await sendSmsMessage({
    to: customerPhone,
    body: message,
  });

  if (!result.ok) {
    console.warn(`[${event}] SMS alert was not sent for ticket ${ticket.id}:`, result.error);
    return { sent: false, reason: result.error };
  }

  await supabase.from('notifications').insert({
    ticket_id: ticket.id,
    type: `sms_${event}`,
    channel: 'sms',
    payload: {
      to: result.to,
      sid: result.sid,
      provider: result.provider,
    },
    sent_at: new Date().toISOString(),
  });

  return { sent: true };
}

async function getDeskOperationContext(deskId: string) {
  const context = await getStaffContext();
  const desk = await requireDeskOperatorForDesk(context, deskId);
  return { context, desk };
}

async function releaseRestaurantTablesForTicket(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string
) {
  await supabase
    .from('restaurant_tables')
    .update({
      status: 'available',
      current_ticket_id: null,
      assigned_at: null,
    })
    .eq('current_ticket_id', ticketId);
}

async function getTicketOperationContext(ticketId: string) {
  const context = await getStaffContext();
  const ticket = await getTicketById(context, ticketId);

  if (!ticket.desk_id) {
    throw new Error('Ticket is not assigned to an active desk');
  }

  const desk = await requireDeskOperatorForDesk(context, ticket.desk_id);
  return { context, ticket, desk };
}

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

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: TICKET_EVENT_TYPES.JOINED,
      to_status: ticket.status,
      metadata: {
        source: status === 'issued' ? 'issued' : 'queue_join',
      },
    });
  }

  revalidatePath('/desk');
  return { data: ticket };
}

interface CreatePublicTicketInput {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerData?: Record<string, unknown> | null;
  status?: 'issued' | 'waiting';
  checkedInAt?: string;
  estimatedWaitMinutes?: number | null;
  isRemote?: boolean;
  priority?: number | null;
  priorityCategoryId?: string | null;
  groupId?: string | null;
}

export async function getPublicIntakeFields(serviceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('intake_form_fields')
    .select('*')
    .eq('service_id', serviceId)
    .order('sort_order', { ascending: true });

  if (error) {
    return { error: error.message };
  }

  return { data: data ?? [] };
}

export async function estimatePublicWaitTime(departmentId: string, serviceId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('estimate_wait_time', {
    p_department_id: departmentId,
    p_service_id: serviceId,
  });

  if (error) {
    return { error: error.message };
  }

  return { data: data ?? null };
}

export async function createPublicTicket(input: CreatePublicTicketInput) {
  const supabase = createAdminClient();
  const status = input.status ?? 'waiting';

  const { data: seqData, error: seqError } = await supabase.rpc(
    'generate_daily_ticket_number',
    { p_department_id: input.departmentId }
  );

  if (seqError || !seqData || seqData.length === 0) {
    return { error: seqError?.message ?? 'Failed to generate ticket number' };
  }

  const { seq, ticket_num } = seqData[0];
  const qrToken = nanoid(16);
  const waitResult =
    input.estimatedWaitMinutes !== undefined
      ? { data: input.estimatedWaitMinutes }
      : await estimatePublicWaitTime(input.departmentId, input.serviceId);

  if ('error' in waitResult) {
    return { error: waitResult.error };
  }

  const { data: ticket, error } = await supabase
    .from('tickets')
    .insert({
      office_id: input.officeId,
      department_id: input.departmentId,
      service_id: input.serviceId,
      ticket_number: ticket_num,
      daily_sequence: seq,
      qr_token: qrToken,
      status,
      checked_in_at: input.checkedInAt ?? new Date().toISOString(),
      customer_data: (input.customerData ?? null) as any,
      estimated_wait_minutes: waitResult.data ?? null,
      is_remote: input.isRemote ?? false,
      priority: input.priority ?? 0,
      priority_category_id: input.priorityCategoryId ?? null,
      group_id: input.groupId ?? null,
    })
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: TICKET_EVENT_TYPES.JOINED,
      to_status: ticket.status,
      metadata: {
        source: input.isRemote ? 'remote_join' : 'public_join',
      },
    });
  }

  revalidatePath('/desk');
  return { data: ticket };
}

export async function completePublicCheckIn(
  ticketId: string,
  customerData: Record<string, string | boolean> | null
) {
  const supabase = createAdminClient();
  const { data: ticket, error } = await supabase
    .from('tickets')
    .update({
      customer_data: customerData as any,
      status: 'waiting',
      checked_in_at: new Date().toISOString(),
    })
    .eq('id', ticketId)
    .select()
    .single();

  if (error) {
    return { error: error.message };
  }

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: TICKET_EVENT_TYPES.CHECKED_IN,
      from_status: 'issued',
      to_status: 'waiting',
      metadata: {
        source: 'public_check_in',
      },
    });
  }

  return { data: ticket };
}

export async function callNextTicket(deskId: string) {
  const { context } = await getDeskOperationContext(deskId);
  const supabase = context.supabase;
  let smsSent = false;

  const { data: ticketId, error } = await supabase.rpc('call_next_ticket', {
    p_desk_id: deskId,
    p_staff_id: context.staff.id,
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

  if (ticket) {
    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: TICKET_EVENT_TYPES.CALLED,
      from_status: 'waiting',
      to_status: 'called',
      staff_id: context.staff.id,
      desk_id: ticket.desk_id,
    });

    const deskName = await getDeskName(supabase, ticket.desk_id);

    // Web Push — rich typed notification
    // On Vercel, pg_net trigger handles it via /api/push-send. On local, send directly.
    if (!process.env.VERCEL) {
      sendPushToTicket(ticketId, {
        type: 'called',
        title: "🔔 YOUR TURN!",
        body: `Ticket ${ticket.ticket_number} — Go to ${deskName}`,
        tag: `qf-turn-${ticketId}`,
        url: `/q/${ticket.qr_token}`,
        ticketId,
        ticketNumber: ticket.ticket_number,
        deskName,
      }).catch((err) => console.error('[CallNext] Push notification error:', err));
    }

    // APNs push for iOS App Clip users (always, regardless of env)
    const apnsSent = await sendAPNsToTicket(ticketId, {
      title: "It's Your Turn!",
      body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
      url: `/q/${ticket.qr_token}`,
    }).catch((err) => {
      console.error('[CallNext] APNs notification error:', err);
      return false;
    });

    if (!apnsSent) {
      console.warn('[CallNext] APNs notification was not sent for ticket:', ticketId);
    }

    const androidSent = await sendAndroidToTicket(ticketId, {
      type: 'called',
      title: "It's Your Turn!",
      body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      deskName,
      status: ticket.status,
      recallCount: ticket.recall_count ?? 0,
    }).catch((err) => {
      console.error('[CallNext] Android push error:', err);
      return false;
    });

    if (!androidSent) {
      console.log('[CallNext] Android live update was not sent for ticket:', ticketId);
    }

    const smsResult = await maybeSendPriorityAlertSms(supabase, {
      ticket,
      event: 'called',
      deskName,
    });
    smsSent = smsResult.sent;

    await logAuditEvent(context, {
      actionType: 'ticket_called',
      entityType: 'ticket',
      entityId: ticket.id,
      officeId: ticket.office_id,
      summary: `Called ticket ${ticket.ticket_number} to ${deskName}`,
      metadata: {
        deskId,
        smsSent,
      },
    });

    await syncLiveActivityAfterAlert(ticketId, 'CallNext');

    // Notify all other waiting tickets — their position shifted
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingAndroidTickets error:', err)
    );
  }

  revalidatePath('/desk');
  return { data: ticket, smsSent };
}

export async function callSpecificTicket(deskId: string, ticketId: string) {
  const { context, desk } = await getDeskOperationContext(deskId);
  const supabase = context.supabase;
  let smsSent = false;

  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*, department:departments(*), service:services(*)')
    .eq('id', ticketId)
    .eq('office_id', desk.office_id)
    .eq('department_id', desk.department_id)
    .eq('status', 'waiting')
    .single();

  if (fetchError || !ticket) {
    return { error: fetchError?.message ?? 'Ticket is no longer waiting in this queue' };
  }

  const now = new Date().toISOString();
  const { data: updatedTicket, error: updateError } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      called_at: now,
      called_by_staff_id: context.staff.id,
      desk_id: deskId,
      recall_count: 0,
    })
    .eq('id', ticketId)
    .eq('status', 'waiting')
    .select('*, department:departments(*), service:services(*)')
    .single();

  if (updateError || !updatedTicket) {
    return { error: updateError?.message ?? 'Ticket could not be called' };
  }

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.CALLED,
    from_status: 'waiting',
    to_status: 'called',
    staff_id: context.staff.id,
    desk_id: deskId,
    metadata: {
      source: 'manual_queue_pick',
    },
  });

  const deskName = await getDeskName(supabase, updatedTicket.desk_id);

  if (!process.env.VERCEL) {
    sendPushToTicket(ticketId, {
      type: 'called',
      title: "🔔 YOUR TURN!",
      body: `Ticket ${updatedTicket.ticket_number} — Go to ${deskName}`,
      tag: `qf-turn-${ticketId}`,
      url: `/q/${updatedTicket.qr_token}`,
      ticketId,
      ticketNumber: updatedTicket.ticket_number,
      deskName,
    }).catch((err) => console.error('[CallSpecificTicket] Push notification error:', err));
  }

  const apnsSent = await sendAPNsToTicket(ticketId, {
    title: "It's Your Turn!",
    body: `Ticket ${updatedTicket.ticket_number} — Please go to ${deskName}`,
    url: `/q/${updatedTicket.qr_token}`,
  }).catch((err) => {
    console.error('[CallSpecificTicket] APNs notification error:', err);
    return false;
  });

  if (!apnsSent) {
    console.warn('[CallSpecificTicket] APNs notification was not sent for ticket:', ticketId);
  }

  const androidSent = await sendAndroidToTicket(ticketId, {
    type: 'called',
    title: "It's Your Turn!",
    body: `Ticket ${updatedTicket.ticket_number} — Please go to ${deskName}`,
    url: `/q/${updatedTicket.qr_token}`,
    ticketId,
    ticketNumber: updatedTicket.ticket_number,
    qrToken: updatedTicket.qr_token,
    deskName,
    status: updatedTicket.status,
    recallCount: updatedTicket.recall_count ?? 0,
  }).catch((err) => {
    console.error('[CallSpecificTicket] Android push error:', err);
    return false;
  });

  if (!androidSent) {
    console.log('[CallSpecificTicket] Android live update was not sent for ticket:', ticketId);
  }

  const smsResult = await maybeSendPriorityAlertSms(supabase, {
    ticket: updatedTicket,
    event: 'called',
    deskName,
  });
  smsSent = smsResult.sent;

  await logAuditEvent(context, {
    actionType: 'ticket_called',
    entityType: 'ticket',
    entityId: updatedTicket.id,
    officeId: updatedTicket.office_id,
    summary: `Called specific ticket ${updatedTicket.ticket_number} to ${deskName}`,
    metadata: {
      deskId,
      smsSent,
      source: 'manual_queue_pick',
    },
  });

  await syncLiveActivityAfterAlert(ticketId, 'CallSpecificTicket');

  notifyWaitingTickets(updatedTicket.department_id, updatedTicket.office_id, ticketId).catch((err) =>
    console.error('[CallSpecificTicket] notifyWaitingTickets error:', err)
  );
  notifyWaitingAndroidTickets(updatedTicket.department_id, updatedTicket.office_id, ticketId).catch((err) =>
    console.error('[CallSpecificTicket] notifyWaitingAndroidTickets error:', err)
  );

  revalidatePath('/desk');
  return { data: updatedTicket, smsSent };
}

export async function startServing(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

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
    event_type: TICKET_EVENT_TYPES.SERVING_STARTED,
    from_status: 'called',
    to_status: 'serving',
    staff_id: context.staff.id,
  });

  if (ticket) {
    const deskName = await getDeskName(supabase, ticket.desk_id);

    // Web Push — "Being Served" silent status update
    sendPushToTicket(ticketId, {
      type: 'serving',
      title: 'Being Served',
      body: `Ticket ${ticket.ticket_number} at ${deskName}`,
      tag: `qf-status-${ticketId}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      deskName,
      silent: true,
    }).catch((err) => console.error('[StartServing] Push error:', err));

    sendAndroidToTicket(ticketId, {
      type: 'serving',
      title: 'Being Served',
      body: `Ticket ${ticket.ticket_number} at ${deskName}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      deskName,
      status: ticket.status,
      recallCount: ticket.recall_count ?? 0,
      silent: true,
    }).catch((err) => console.error('[StartServing] Android push error:', err));

    await logAuditEvent(context, {
      actionType: 'ticket_serving_started',
      entityType: 'ticket',
      entityId: ticket.id,
      officeId: ticket.office_id,
      summary: `Started serving ticket ${ticket.ticket_number}`,
      metadata: {
        deskId: ticket.desk_id,
      },
    });

    // Notify waiting tickets — "now serving" number changed
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'StartServing');

  revalidatePath('/desk');
  return { data: ticket };
}

export async function markServed(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

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

  await releaseRestaurantTablesForTicket(supabase, ticketId);

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.SERVED,
    from_status: 'serving',
    to_status: 'served',
    staff_id: context.staff.id,
  });

  if (ticket) {
    // Web Push — "Visit Complete" + close all previous notifications
    sendPushToTicket(ticketId, {
      type: 'served',
      title: 'Visit Complete ✓',
      body: 'Thank you! Tap to leave feedback.',
      tag: `qf-done-${ticketId}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      silent: true,
    }).catch((err) => console.error('[MarkServed] Push error:', err));

    sendAndroidToTicket(ticketId, {
      type: 'served',
      title: 'Visit Complete',
      body: 'Thank you! Tap to leave feedback.',
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      status: ticket.status,
      recallCount: ticket.recall_count ?? 0,
      silent: true,
    }).catch((err) => console.error('[MarkServed] Android push error:', err));

    await logAuditEvent(context, {
      actionType: 'ticket_served',
      entityType: 'ticket',
      entityId: ticket.id,
      officeId: ticket.office_id,
      summary: `Completed ticket ${ticket.ticket_number}`,
      metadata: {
        deskId: ticket.desk_id,
      },
    });

    // Notify waiting tickets — positions shifted forward
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'MarkServed');

  revalidatePath('/desk');
  return { data: ticket };
}

export async function markNoShow(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

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
    event_type: TICKET_EVENT_TYPES.NO_SHOW,
    from_status: 'called',
    to_status: 'no_show',
    staff_id: context.staff.id,
  });

  if (ticket) {
    // Web Push — "Missed Your Turn"
    sendPushToTicket(ticketId, {
      type: 'no_show',
      title: 'Missed Your Turn',
      body: `Ticket ${ticket.ticket_number} was marked as no-show.`,
      tag: `qf-done-${ticketId}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      silent: true,
    }).catch((err) => console.error('[MarkNoShow] Push error:', err));

    sendAndroidToTicket(ticketId, {
      type: 'no_show',
      title: 'Missed Your Turn',
      body: `Ticket ${ticket.ticket_number} was marked as no-show.`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      qrToken: ticket.qr_token,
      status: ticket.status,
      recallCount: ticket.recall_count ?? 0,
      silent: true,
    }).catch((err) => console.error('[MarkNoShow] Android push error:', err));

    await logAuditEvent(context, {
      actionType: 'ticket_no_show',
      entityType: 'ticket',
      entityId: ticket.id,
      officeId: ticket.office_id,
      summary: `Marked ticket ${ticket.ticket_number} as no-show`,
      metadata: {
        deskId: ticket.desk_id,
      },
    });

    // Notify waiting tickets — positions shifted forward
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'MarkNoShow');

  revalidatePath('/desk');
  return { data: ticket };
}

export async function transferTicket(
  ticketId: string,
  targetDepartmentId: string,
  targetServiceId: string
) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;
  const targetDepartment = await getDepartmentById(context, targetDepartmentId);
  const targetService = await getServiceById(context, targetServiceId);

  const { data: originalTicket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (fetchError || !originalTicket) {
    return { error: fetchError?.message ?? 'Ticket not found' };
  }

  if (targetDepartment.office_id !== originalTicket.office_id) {
    return { error: 'Tickets can only be transferred within the same office' };
  }

  if (targetService.department_id !== targetDepartment.id) {
    return { error: 'Selected service does not belong to the target department' };
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

  await releaseRestaurantTablesForTicket(supabase, ticketId);

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.TRANSFERRED,
    from_status: originalTicket.status,
    to_status: 'transferred',
    staff_id: context.staff.id,
    metadata: {
      new_ticket_id: newTicket.id,
      target_department_id: targetDepartmentId,
      target_service_id: targetServiceId,
    },
  });

  await logAuditEvent(context, {
    actionType: 'ticket_transferred',
    entityType: 'ticket',
    entityId: originalTicket.id,
    officeId: originalTicket.office_id,
    summary: `Transferred ticket ${originalTicket.ticket_number}`,
    metadata: {
      targetDepartmentId,
      targetServiceId,
      newTicketId: newTicket.id,
    },
  });

  await syncLiveActivity(ticketId, 'TransferTicket');

  revalidatePath('/desk');
  return { data: newTicket };
}

export async function recallTicket(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

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

  const deskName = await getDeskName(supabase, ticket.desk_id);

  // Web Push — rich recall alert
  if (!process.env.VERCEL) {
    sendPushToTicket(ticketId, {
      type: 'recall',
      title: '⚠️ REMINDER — YOUR TURN!',
      body: `Ticket ${ticket.ticket_number} — Go to ${deskName} NOW`,
      tag: `qf-turn-${ticketId}`,
      url: `/q/${ticket.qr_token}`,
      ticketId,
      ticketNumber: ticket.ticket_number,
      deskName,
      recallCount: newRecallCount,
    }).catch((err) => console.error('[Recall] Push notification error:', err));
  }

  // APNs push for iOS App Clip users (always, regardless of env)
  const apnsSent = await sendAPNsToTicket(ticketId, {
    title: 'Reminder: Your Turn!',
    body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
    url: `/q/${ticket.qr_token}`,
  }).catch((err) => {
    console.error('[Recall] APNs notification error:', err);
    return false;
  });

  if (!apnsSent) {
    console.warn('[Recall] APNs notification was not sent for ticket:', ticketId);
  }

  const androidSent = await sendAndroidToTicket(ticketId, {
    type: 'recall',
    title: 'Reminder: Your Turn!',
    body: `Ticket ${ticket.ticket_number} — Please go to ${deskName}`,
    url: `/q/${ticket.qr_token}`,
    ticketId,
    ticketNumber: ticket.ticket_number,
    qrToken: ticket.qr_token,
    deskName,
    status: ticket.status,
    recallCount: newRecallCount,
  }).catch((err) => {
    console.error('[Recall] Android push error:', err);
    return false;
  });

  if (!androidSent) {
    console.log('[Recall] Android live update was not sent for ticket:', ticketId);
  }

  const smsResult = await maybeSendPriorityAlertSms(supabase, {
    ticket,
    event: 'recall',
    deskName,
  });

  await syncLiveActivityAfterAlert(ticketId, 'Recall');

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.RECALLED,
    desk_id: ticket.desk_id,
    staff_id: context.staff.id,
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

  await logAuditEvent(context, {
    actionType: 'ticket_recalled',
    entityType: 'ticket',
    entityId: ticket.id,
    officeId: ticket.office_id,
    summary: `Recalled ticket ${ticket.ticket_number}`,
    metadata: {
      deskId: ticket.desk_id,
      recallCount: newRecallCount,
      smsSent: smsResult.sent,
    },
  });

  return { data: ticket, smsSent: smsResult.sent };
}

export async function callBackTicketToDesk(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

  const { data: ticket, error: fetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .in('status', ['serving', 'called'])
    .single();

  if (fetchError || !ticket) {
    return { error: 'Ticket is not active anymore' };
  }

  const calledAt = new Date().toISOString();
  const newRecallCount = (ticket.recall_count ?? 0) + 1;
  const { data: updatedTicket, error: updateError } = await supabase
    .from('tickets')
    .update({
      status: 'called',
      called_at: calledAt,
      serving_started_at: null,
      recall_count: newRecallCount,
      called_by_staff_id: context.staff.id,
    })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (updateError || !updatedTicket) {
    return { error: updateError?.message ?? 'Failed to bring ticket back to the desk' };
  }

  const deskName = await getDeskName(supabase, updatedTicket.desk_id);

  sendPushToTicket(ticketId, {
    type: 'recall',
    title: 'Please return to the host stand',
    body: `Ticket ${updatedTicket.ticket_number} — Please return to ${deskName}`,
    tag: `qf-turn-${ticketId}`,
    url: `/q/${updatedTicket.qr_token}`,
    ticketId,
    ticketNumber: updatedTicket.ticket_number,
    deskName,
    recallCount: newRecallCount,
  }).catch((err) => console.error('[CallBackTicketToDesk] Push notification error:', err));

  sendAPNsToTicket(ticketId, {
    title: 'Please return to the host stand',
    body: `Ticket ${updatedTicket.ticket_number} — Please return to ${deskName}`,
    url: `/q/${updatedTicket.qr_token}`,
  }).catch((err) => console.error('[CallBackTicketToDesk] APNs notification error:', err));

  sendAndroidToTicket(ticketId, {
    type: 'recall',
    title: 'Please return to the host stand',
    body: `Ticket ${updatedTicket.ticket_number} — Please return to ${deskName}`,
    url: `/q/${updatedTicket.qr_token}`,
    ticketId,
    ticketNumber: updatedTicket.ticket_number,
    qrToken: updatedTicket.qr_token,
    deskName,
    status: updatedTicket.status,
    recallCount: newRecallCount,
  }).catch((err) => console.error('[CallBackTicketToDesk] Android push error:', err));

  const smsResult = await maybeSendPriorityAlertSms(supabase, {
    ticket: updatedTicket,
    event: 'recall',
    deskName,
  });

  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.RECALLED,
    from_status: ticket.status,
    to_status: 'called',
    desk_id: updatedTicket.desk_id,
    staff_id: context.staff.id,
    metadata: {
      source: 'callback_to_desk',
      previous_status: ticket.status,
    },
  });

  await logAuditEvent(context, {
    actionType: 'ticket_recalled',
    entityType: 'ticket',
    entityId: updatedTicket.id,
    officeId: updatedTicket.office_id,
    summary: `Called back ticket ${updatedTicket.ticket_number} to ${deskName}`,
    metadata: {
      deskId: updatedTicket.desk_id,
      previousStatus: ticket.status,
      smsSent: smsResult.sent,
    },
  });

  await syncLiveActivityAfterAlert(ticketId, 'CallBackTicketToDesk');
  revalidatePath('/desk');
  return { data: updatedTicket, smsSent: smsResult.sent };
}

export async function buzzTicket(ticketId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

  // Fetch the ticket — works for any active status (waiting, called, serving)
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

  // Web Push — aggressive buzz notification
  sendPushToTicket(ticketId, {
    type: 'buzz',
    title: '📳 BUZZ!',
    body: ticket.status === 'called'
      ? `Ticket ${ticket.ticket_number} — Please go to ${deskName} NOW!`
      : `Ticket ${ticket.ticket_number} — Attention needed`,
    tag: `qf-buzz-${ticketId}-${Date.now()}`, // unique tag forces new notification
    url: `/q/${ticket.qr_token}`,
    ticketId,
    ticketNumber: ticket.ticket_number,
    deskName,
  }).catch((err) => console.error('[Buzz] Push error:', err));

  // APNs for iOS
  sendAPNsToTicket(ticketId, {
    title: 'Buzz!',
    body: ticket.status === 'called'
      ? `Ticket ${ticket.ticket_number} — Please go to ${deskName} NOW!`
      : `Ticket ${ticket.ticket_number} — Attention needed`,
    url: `/q/${ticket.qr_token}`,
  }).catch((err) => console.error('[Buzz] APNs error:', err));

  sendAndroidToTicket(ticketId, {
    type: 'buzz',
    title: 'Buzz!',
    body: ticket.status === 'called'
      ? `Ticket ${ticket.ticket_number} — Please go to ${deskName} NOW!`
      : `Ticket ${ticket.ticket_number} — Attention needed`,
    url: `/q/${ticket.qr_token}`,
    ticketId,
    ticketNumber: ticket.ticket_number,
    qrToken: ticket.qr_token,
    deskName,
    status: ticket.status,
    recallCount: ticket.recall_count ?? 0,
  }).catch((err) => console.error('[Buzz] Android push error:', err));

  // Broadcast buzz via Supabase Realtime (triggers in-app alert too)
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

  // Log event
  await supabase.from('ticket_events').insert({
    ticket_id: ticketId,
    event_type: TICKET_EVENT_TYPES.BUZZED,
    desk_id: ticket.desk_id,
    staff_id: context.staff.id,
  });

  const smsResult = await maybeSendPriorityAlertSms(supabase, {
    ticket,
    event: 'buzz',
    deskName,
  });

  // Persist buzz so clients can detect missed events even if broadcast is dropped.
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

  await logAuditEvent(context, {
    actionType: 'ticket_buzzed',
    entityType: 'ticket',
    entityId: ticket.id,
    officeId: ticket.office_id,
    summary: `Buzzed ticket ${ticket.ticket_number}`,
    metadata: {
      deskId: ticket.desk_id,
      status: ticket.status,
      smsSent: smsResult.sent,
    },
  });

  return { data: ticket, smsSent: smsResult.sent };
}

export async function resetTicketToQueue(ticketId: string) {
  const { context, ticket } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

  const { error } = await supabase
    .from('tickets')
    .update({ status: 'waiting', desk_id: null, called_at: null })
    .eq('id', ticketId)
    .in('status', ['called', 'serving']);

  if (error) {
    return { error: 'Failed to reset ticket' };
  }

  await releaseRestaurantTablesForTicket(supabase, ticketId);

  await syncLiveActivity(ticketId, 'ResetTicketToQueue');

  await logAuditEvent(context, {
    actionType: 'ticket_reset_to_queue',
    entityType: 'ticket',
    entityId: ticket.id,
    officeId: ticket.office_id,
    summary: `Reset ticket ${ticket.ticket_number} back to queue`,
    metadata: {
      previousStatus: ticket.status,
      previousDeskId: ticket.desk_id,
    },
  });

  revalidatePath('/desk');
  return { data: true };
}

export async function assignRestaurantTable(ticketId: string, tableId: string) {
  const { context } = await getTicketOperationContext(ticketId);
  const supabase = context.supabase;

  const { data: ticket, error: ticketFetchError } = await supabase
    .from('tickets')
    .select('*')
    .eq('id', ticketId)
    .single();

  if (ticketFetchError || !ticket) {
    return { error: ticketFetchError?.message ?? 'Ticket not found' };
  }

  const { data: table, error: tableError } = await supabase
    .from('restaurant_tables')
    .select('*')
    .eq('id', tableId)
    .eq('office_id', ticket.office_id)
    .single();

  if (tableError || !table) {
    return { error: tableError?.message ?? 'Table not found' };
  }

  if (table.current_ticket_id && table.current_ticket_id !== ticketId) {
    return { error: 'This table is already assigned to another party' };
  }

  if (table.status !== 'available' && table.current_ticket_id !== ticketId) {
    return { error: `This table is currently ${table.status}` };
  }

  await releaseRestaurantTablesForTicket(supabase, ticketId);

  const now = new Date().toISOString();
  const { data: assignedTable, error: assignError } = await supabase
    .from('restaurant_tables')
    .update({
      status: 'occupied',
      current_ticket_id: ticketId,
      assigned_at: now,
    })
    .eq('id', tableId)
    .select()
    .single();

  if (assignError || !assignedTable) {
    return { error: assignError?.message ?? 'Failed to assign table' };
  }

  const customerData =
    ticket.customer_data && typeof ticket.customer_data === 'object' && !Array.isArray(ticket.customer_data)
      ? (ticket.customer_data as Record<string, unknown>)
      : {};
  const nextStatus = ticket.status === 'called' ? 'serving' : ticket.status;
  const nextServingStartedAt =
    ticket.status === 'called' ? now : ticket.serving_started_at;

  const { data: updatedTicket, error: ticketError } = await supabase
    .from('tickets')
    .update({
      status: nextStatus,
      serving_started_at: nextServingStartedAt,
      customer_data: {
        ...customerData,
        assigned_table_code: assignedTable.code,
        assigned_table_label: assignedTable.label,
      } as any,
    })
    .eq('id', ticketId)
    .select()
    .single();

  if (ticketError || !updatedTicket) {
    return { error: ticketError?.message ?? 'Failed to update ticket' };
  }

  if (ticket.status === 'called') {
    await supabase.from('ticket_events').insert({
      ticket_id: ticketId,
      event_type: TICKET_EVENT_TYPES.SERVING_STARTED,
      from_status: 'called',
      to_status: 'serving',
      staff_id: context.staff.id,
      desk_id: ticket.desk_id,
      metadata: {
        table_code: assignedTable.code,
        table_label: assignedTable.label,
      },
    });
  }

  await logAuditEvent(context, {
    actionType: 'restaurant_table_assigned',
    entityType: 'ticket',
    entityId: ticket.id,
    officeId: ticket.office_id,
    summary: `Assigned table ${assignedTable.code} to ticket ${ticket.ticket_number}`,
    metadata: {
      tableId: assignedTable.id,
      tableCode: assignedTable.code,
      tableLabel: assignedTable.label,
      transitionedToServing: ticket.status === 'called',
    },
  });

  revalidatePath('/desk');
  return { data: { ticket: updatedTicket, table: assignedTable } };
}

export async function clearRestaurantTable(tableId: string) {
  const context = await getStaffContext();
  const supabase = context.supabase;

  const { data: table, error: tableError } = await supabase
    .from('restaurant_tables')
    .select('*')
    .eq('id', tableId)
    .single();

  if (tableError || !table) {
    return { error: tableError?.message ?? 'Table not found' };
  }

  await requireOfficeMembership(context);
  await requireOfficeAccess(context, table.office_id);

  const currentTicketId = table.current_ticket_id;

  const { data: clearedTable, error: clearError } = await supabase
    .from('restaurant_tables')
    .update({
      status: 'available',
      current_ticket_id: null,
      assigned_at: null,
    })
    .eq('id', tableId)
    .select()
    .single();

  if (clearError || !clearedTable) {
    return { error: clearError?.message ?? 'Failed to clear table' };
  }

  let updatedTicket: Record<string, unknown> | null = null;

  if (currentTicketId) {
    const { data: ticket } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', currentTicketId)
      .maybeSingle();

    if (ticket) {
      const customerData =
        ticket.customer_data && typeof ticket.customer_data === 'object' && !Array.isArray(ticket.customer_data)
          ? { ...(ticket.customer_data as Record<string, unknown>) }
          : {};

      delete customerData.assigned_table_code;
      delete customerData.assigned_table_label;

      const { data: ticketAfterClear } = await supabase
        .from('tickets')
        .update({
          customer_data: customerData as any,
        })
        .eq('id', currentTicketId)
        .select()
        .single();

      updatedTicket = ticketAfterClear as Record<string, unknown> | null;

      await logAuditEvent(context, {
        actionType: 'restaurant_table_cleared',
        entityType: 'ticket',
        entityId: ticket.id,
        officeId: ticket.office_id,
        summary: `Cleared table ${table.code} from ticket ${ticket.ticket_number}`,
        metadata: {
          tableId: table.id,
          tableCode: table.code,
          tableLabel: table.label,
        },
      });
    }
  }

  revalidatePath('/desk');
  return { data: { table: clearedTable, ticket: updatedTicket } };
}

export async function assignDesk(deskId: string) {
  const context = await getStaffContext();
  requireOfficeMembership(context);
  const desk = await getDeskById(context, deskId);

  if (desk.current_staff_id && desk.current_staff_id !== context.staff.id) {
    return { error: 'This desk is already assigned to another staff member' };
  }

  const { data: existingDesk } = await context.supabase
    .from('desks')
    .select('id')
    .eq('current_staff_id', context.staff.id)
    .neq('id', deskId)
    .maybeSingle();

  if (existingDesk) {
    return { error: 'You are already assigned to another desk' };
  }

  const { data: updatedDesk, error } = await context.supabase
    .from('desks')
    .update({
      current_staff_id: context.staff.id,
      status: 'open',
    })
    .eq('id', deskId)
    .select('*, department:departments(*)')
    .single();

  if (error) {
    return { error: error.message };
  }

  await logAuditEvent(context, {
    actionType: 'desk_assigned',
    entityType: 'desk',
    entityId: deskId,
    officeId: desk.office_id,
    summary: `Assigned ${context.staff.full_name} to desk ${updatedDesk.display_name ?? updatedDesk.name}`,
    metadata: {
      staffId: context.staff.id,
    },
  });

  revalidatePath('/desk');
  return { data: updatedDesk };
}

export async function unassignDesk(deskId: string) {
  const { context, desk } = await getDeskOperationContext(deskId);

  const { error } = await context.supabase
    .from('desks')
    .update({
      current_staff_id: null,
      status: 'closed',
    })
    .eq('id', deskId);

  if (error) {
    return { error: error.message };
  }

  await logAuditEvent(context, {
    actionType: 'desk_unassigned',
    entityType: 'desk',
    entityId: deskId,
    officeId: desk.office_id,
    summary: `Unassigned desk ${deskId}`,
    metadata: {
      previousStaffId: desk.current_staff_id,
    },
  });

  revalidatePath('/desk');
  return { data: true };
}

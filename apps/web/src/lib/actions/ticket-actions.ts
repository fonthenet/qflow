'use server';

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
import { getPlanLimits, type PlanId } from '@/lib/plan-limits';
import { sendTicketCalledEmail } from '@/lib/email';
import { dispatchWebhook, type WebhookEvent } from '@/lib/webhooks';

const LIVE_ACTIVITY_FOLLOWUP_DELAY_MS = 2500;

const STATUS_TO_WEBHOOK: Record<string, WebhookEvent> = {
  called: 'ticket.called',
  serving: 'ticket.serving',
  served: 'ticket.served',
  no_show: 'ticket.no_show',
  cancelled: 'ticket.cancelled',
  transferred: 'ticket.transferred',
};

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

export async function createTicket(
  officeId: string,
  departmentId: string,
  serviceId: string,
  customerData?: Record<string, unknown> | null,
  status: 'issued' | 'waiting' = 'waiting'
) {
  const supabase = await createClient();

  // Check visit limit before creating ticket
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
      if (limits.customersPerMonth !== Infinity && org.monthly_visit_count >= limits.customersPerMonth) {
        return { error: 'Monthly visit limit reached. Please upgrade your plan.' };
      }
    }
  }

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

  // Dispatch webhook
  if (officeData?.organization_id && ticket) {
    dispatchWebhook(officeData.organization_id, 'ticket.created', ticket).catch(() => {});
  }

  revalidatePath('/desk');
  return { data: ticket };
}

export async function callNextTicket(deskId: string, staffId: string) {
  const supabase = await createClient();
  let smsSent = false;

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

  if (ticket) {
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

    // Email notification (if customer has email in customer_data)
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

    await syncLiveActivityAfterAlert(ticketId, 'CallNext');

    // Notify all other waiting tickets — their position shifted
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[CallNext] notifyWaitingAndroidTickets error:', err)
    );
  }

  // Dispatch webhook for ticket called
  if (ticket) {
    const { organizationId } = await getOfficeContext(supabase, ticket.office_id);
    if (organizationId) {
      dispatchWebhook(organizationId, 'ticket.called', ticket).catch(() => {});
    }
  }

  revalidatePath('/desk');
  return { data: ticket, smsSent };
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

    // Notify waiting tickets — "now serving" number changed
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[StartServing] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'StartServing');

  if (ticket) dispatchTicketWebhook(supabase, ticket);

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

    // Notify waiting tickets — positions shifted forward
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkServed] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'MarkServed');

  if (ticket) dispatchTicketWebhook(supabase, ticket);

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

    // Notify waiting tickets — positions shifted forward
    notifyWaitingTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingTickets error:', err)
    );
    notifyWaitingAndroidTickets(ticket.department_id, ticket.office_id, ticketId).catch((err) =>
      console.error('[MarkNoShow] notifyWaitingAndroidTickets error:', err)
    );
  }

  await syncLiveActivity(ticketId, 'MarkNoShow');

  if (ticket) dispatchTicketWebhook(supabase, ticket);

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

  await syncLiveActivity(ticketId, 'TransferTicket');

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

export async function buzzTicket(ticketId: string) {
  const supabase = await createClient();

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
    event_type: 'buzz',
    desk_id: ticket.desk_id,
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

  return { data: ticket, smsSent: smsResult.sent };
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

  await syncLiveActivity(ticketId, 'ResetTicketToQueue');

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

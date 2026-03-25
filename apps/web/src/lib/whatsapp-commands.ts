import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { getQueuePosition } from '@/lib/queue-position';
import { createPublicTicket } from '@/lib/actions/public-ticket-actions';

interface OrgContext {
  id: string;
  name: string;
  settings: Record<string, any>;
}

/**
 * Route an incoming WhatsApp message to the right command handler.
 */
export async function handleWhatsAppMessage(
  phone: string,
  messageBody: string,
  org: OrgContext
): Promise<void> {
  const command = messageBody.trim().toUpperCase();

  if (command === 'JOIN' || command === 'REJOINDRE') {
    await handleJoin(phone, org);
  } else if (command === 'STATUS' || command === 'STATUT') {
    await handleStatus(phone, org);
  } else if (command === 'CANCEL' || command === 'ANNULER') {
    await handleCancel(phone, org);
  } else {
    // First message from unknown user — try join; otherwise show help
    const supabase = createAdminClient() as any;
    const { data: session } = await supabase
      .from('whatsapp_sessions')
      .select('id')
      .eq('whatsapp_phone', phone)
      .eq('organization_id', org.id)
      .eq('state', 'active')
      .maybeSingle();

    if (!session) {
      // No active session — treat as JOIN
      await handleJoin(phone, org);
    } else {
      await sendWhatsAppMessage({
        to: phone,
        body: [
          `📋 *${org.name}* — WhatsApp Queue`,
          '',
          'Available commands:',
          '• *STATUS* — Check your position',
          '• *CANCEL* — Leave the queue',
          '',
          'Reply with a command.',
        ].join('\n'),
      });
    }
  }
}

/**
 * JOIN — create a ticket and start a session.
 */
async function handleJoin(phone: string, org: OrgContext): Promise<void> {
  const supabase = createAdminClient() as any;

  // Check for an existing active session
  const { data: existing } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (existing?.ticket_id) {
    // Already in queue — send position instead
    const pos = await getQueuePosition(existing.ticket_id);
    await sendWhatsAppMessage({
      to: phone,
      body: [
        `You're already in the queue at *${org.name}*.`,
        pos.position != null
          ? `📍 Position: *${pos.position}* | ⏱ Estimated wait: *${pos.estimated_wait_minutes ?? '?'} min*`
          : '',
        '',
        'Reply *STATUS* for updates or *CANCEL* to leave.',
      ]
        .filter(Boolean)
        .join('\n'),
    });
    return;
  }

  // Get the default virtual queue code for WhatsApp
  const virtualCodeId = org.settings?.whatsapp_default_virtual_code_id;
  if (!virtualCodeId) {
    await sendWhatsAppMessage({
      to: phone,
      body: `Sorry, WhatsApp queue is not fully configured for *${org.name}* yet. Please join via the QR code instead.`,
    });
    return;
  }

  const { data: vCode } = await supabase
    .from('virtual_queue_codes')
    .select('*')
    .eq('id', virtualCodeId)
    .single();

  if (!vCode || !vCode.is_active) {
    await sendWhatsAppMessage({
      to: phone,
      body: `Sorry, this queue is currently closed. Please try again later.`,
    });
    return;
  }

  // Determine office/department/service from the virtual code
  const officeId = vCode.office_id;
  const departmentId = vCode.department_id;
  const serviceId = vCode.service_id;

  if (!officeId || !departmentId || !serviceId) {
    // If the virtual code doesn't pin all three, we can't auto-join
    await sendWhatsAppMessage({
      to: phone,
      body: `Sorry, this queue requires choosing a service. Please join via the QR code link instead.`,
    });
    return;
  }

  // Create the ticket
  const result = await createPublicTicket({
    officeId,
    departmentId,
    serviceId,
    customerData: { phone, source: 'whatsapp' },
    isRemote: true,
  });

  if ('error' in result && result.error) {
    await sendWhatsAppMessage({
      to: phone,
      body: `⚠️ Could not join the queue: ${result.error}`,
    });
    return;
  }

  const ticket = result.data;
  if (!ticket) {
    await sendWhatsAppMessage({
      to: phone,
      body: `⚠️ Something went wrong. Please try again.`,
    });
    return;
  }

  // Create WhatsApp session
  await supabase.from('whatsapp_sessions').insert({
    organization_id: org.id,
    whatsapp_phone: phone,
    ticket_id: ticket.id,
    virtual_queue_code_id: virtualCodeId,
    office_id: officeId,
    department_id: departmentId,
    service_id: serviceId,
    state: 'active',
  });

  // Get queue position
  const pos = await getQueuePosition(ticket.id);

  await sendWhatsAppMessage({
    to: phone,
    body: [
      `✅ You're in the queue at *${org.name}*!`,
      '',
      `🎫 Ticket: *${ticket.ticket_number}*`,
      pos.position != null
        ? `📍 Position: *${pos.position}* | ⏱ Wait: ~*${pos.estimated_wait_minutes ?? '?'} min*`
        : '',
      pos.now_serving ? `📢 Now serving: *${pos.now_serving}*` : '',
      '',
      'Reply *STATUS* for updates or *CANCEL* to leave.',
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

/**
 * STATUS — return current queue position.
 */
async function handleStatus(phone: string, org: OrgContext): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (!session?.ticket_id) {
    await sendWhatsAppMessage({
      to: phone,
      body: `You're not in any queue. Reply *JOIN* to join.`,
    });
    return;
  }

  const pos = await getQueuePosition(session.ticket_id);

  if (pos.position === 0) {
    await sendWhatsAppMessage({
      to: phone,
      body: `🔔 *It's your turn!* Please proceed to your service point.`,
    });
    return;
  }

  if (pos.position === null) {
    // Ticket might have been completed/cancelled
    await supabase
      .from('whatsapp_sessions')
      .update({ state: 'completed' })
      .eq('whatsapp_phone', phone)
      .eq('organization_id', org.id)
      .eq('state', 'active');

    await sendWhatsAppMessage({
      to: phone,
      body: `Your ticket is no longer active. Reply *JOIN* to join again.`,
    });
    return;
  }

  await sendWhatsAppMessage({
    to: phone,
    body: [
      `📊 *Queue Status — ${org.name}*`,
      '',
      `📍 Your position: *${pos.position}*`,
      `⏱ Estimated wait: *${pos.estimated_wait_minutes ?? '?'} min*`,
      pos.now_serving ? `📢 Now serving: *${pos.now_serving}*` : '',
      `👥 Total waiting: *${pos.total_waiting}*`,
      '',
      'Reply *CANCEL* to leave the queue.',
    ]
      .filter(Boolean)
      .join('\n'),
  });
}

/**
 * CANCEL — cancel the ticket and end the session.
 */
async function handleCancel(phone: string, org: OrgContext): Promise<void> {
  const supabase = createAdminClient() as any;

  const { data: session } = await supabase
    .from('whatsapp_sessions')
    .select('id, ticket_id')
    .eq('whatsapp_phone', phone)
    .eq('organization_id', org.id)
    .eq('state', 'active')
    .maybeSingle();

  if (!session?.ticket_id) {
    await sendWhatsAppMessage({
      to: phone,
      body: `You're not in any queue. Reply *JOIN* to join.`,
    });
    return;
  }

  // Cancel the ticket
  await supabase
    .from('tickets')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', session.ticket_id)
    .in('status', ['waiting', 'issued']);

  // Log the event
  await supabase.from('ticket_events').insert({
    ticket_id: session.ticket_id,
    event_type: 'cancelled',
    to_status: 'cancelled',
    metadata: { source: 'whatsapp_cancel' },
  });

  // End session
  await supabase
    .from('whatsapp_sessions')
    .update({ state: 'completed' })
    .eq('id', session.id);

  await sendWhatsAppMessage({
    to: phone,
    body: `✅ Your ticket has been cancelled. Reply *JOIN* to rejoin anytime.`,
  });
}

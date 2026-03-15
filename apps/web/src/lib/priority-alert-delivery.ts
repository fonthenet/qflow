import {
  extractTicketPhone,
  getPriorityAlertConfig,
  isPriorityAlertEventEnabled,
  type PriorityAlertEvent,
} from '@/lib/priority-alerts';
import { isSmsProviderConfigured, sendSmsMessage } from '@/lib/sms';

type SupabaseLikeClient = {
  from: (table: string) => any;
};

function buildAbsoluteTicketUrl(qrToken: string): string {
  const baseUrl = (
    process.env.APP_CLIP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'https://qflow-sigma.vercel.app'
  ).replace(/\/+$/, '');

  return `${baseUrl}/q/${qrToken}`;
}

async function getOfficeContext(
  supabase: SupabaseLikeClient,
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

export async function maybeSendPriorityAlertSms(
  supabase: SupabaseLikeClient,
  params: {
    ticket: {
      id: string;
      office_id: string;
      qr_token: string;
      ticket_number: string;
      status: string;
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


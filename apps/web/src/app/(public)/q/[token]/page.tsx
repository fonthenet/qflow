import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CheckInForm } from '@/components/queue/check-in-form';
import { QueueStatus } from '@/components/queue/queue-status';
import { GroupStatus } from '@/components/queue/group-status';
import { getPriorityAlertConfig } from '@/lib/priority-alerts';
import { isSmsProviderConfigured } from '@/lib/sms';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function TicketStatusPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  // Fetch ticket with related data
  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('qr_token', token)
    .single();

  if (error || !ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl bg-card p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <svg
              className="h-8 w-8 text-destructive"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">
            Ticket Not Found
          </h1>
          <p className="text-sm text-muted-foreground">
            This ticket link is invalid or has expired. Please check your QR code
            and try again.
          </p>
        </div>
      </div>
    );
  }

  // If ticket has a group_id, show the group status view
  if (ticket.group_id) {
    // Fetch office name for the group view
    const { data: groupOffice } = await supabase
      .from('offices')
      .select('name')
      .eq('id', ticket.office_id)
      .single();

    return (
      <GroupStatus
        groupId={ticket.group_id}
        currentTicketId={ticket.id}
        officeName={groupOffice?.name ?? 'Office'}
      />
    );
  }

  // Fetch office info
  const { data: office } = await supabase
    .from('offices')
    .select('name, address, organization_id')
    .eq('id', ticket.office_id)
    .single();

  let priorityAlertConfig = null;
  if (office?.organization_id) {
    const { data: organization } = await supabase
      .from('organizations')
      .select('settings')
      .eq('id', office.organization_id)
      .single();

    priorityAlertConfig = getPriorityAlertConfig(
      (organization?.settings as Record<string, any> | null) ?? null,
      isSmsProviderConfigured()
    );
  }

  // Fetch service info
  const { data: service } = await supabase
    .from('services')
    .select('name, description')
    .eq('id', ticket.service_id)
    .single();

  // Fetch desk info if assigned
  let desk: { name: string; display_name: string | null } | null = null;
  if (ticket.desk_id) {
    const { data } = await supabase
      .from('desks')
      .select('name, display_name')
      .eq('id', ticket.desk_id)
      .single();
    desk = data;
  }

  const contextInfo = {
    officeName: office?.name ?? 'Office',
    officeAddress: office?.address ?? '',
    serviceName: service?.name ?? 'Service',
    serviceDescription: service?.description ?? '',
  };

  // Status: issued with no customer data -> show check-in form
  if (ticket.status === 'issued' && !ticket.customer_data) {
    return (
      <CheckInForm
        ticket={ticket}
        officeName={contextInfo.officeName}
        serviceName={contextInfo.serviceName}
      />
    );
  }

  // Main customer journey: waiting, called, serving, served
  if (
    ticket.status === 'waiting' ||
    ticket.status === 'called' ||
    ticket.status === 'serving' ||
    ticket.status === 'served'
  ) {
    return (
      <QueueStatus
        ticket={ticket}
        officeName={contextInfo.officeName}
        serviceName={contextInfo.serviceName}
        priorityAlertConfig={priorityAlertConfig}
      />
    );
  }

  // Status: no_show, cancelled, transferred
  const statusConfig: Record<string, { title: string; description: string; icon: string }> = {
    no_show: {
      title: 'Missed Your Turn',
      description:
        'You were called but did not show up. Please visit the front desk if you still need service.',
      icon: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    cancelled: {
      title: 'Ticket Cancelled',
      description: 'This ticket has been cancelled. Please take a new ticket if you need service.',
      icon: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    },
    transferred: {
      title: 'Ticket Transferred',
      description:
        'Your ticket has been transferred to another service. Please check your new ticket.',
      icon: 'M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4',
    },
  };

  const config = statusConfig[ticket.status] ?? {
    title: 'Ticket Status',
    description: `Current status: ${ticket.status}`,
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <div className="w-full max-w-sm text-center">
        <div className="rounded-xl bg-card p-8 shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/10">
            <svg
              className="h-8 w-8 text-warning"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={config.icon}
              />
            </svg>
          </div>
          <h1 className="mb-2 text-xl font-bold text-foreground">{config.title}</h1>
          <p className="mb-6 text-sm text-muted-foreground">{config.description}</p>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium text-muted-foreground">Ticket Number</p>
            <p className="text-2xl font-bold text-foreground">{ticket.ticket_number}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {contextInfo.officeName} &middot; {contextInfo.serviceName}
        </p>
      </div>
    </div>
  );
}

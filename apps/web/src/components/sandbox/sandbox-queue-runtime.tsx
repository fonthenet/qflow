'use client';

import { useMemo, useState } from 'react';
import { QueueStatus } from '@/components/queue/queue-status';
import type { SandboxPreviewData } from '@/lib/platform/sandbox-preview';
import type { Database } from '@/lib/supabase/database.types';

type TicketRow = Database['public']['Tables']['tickets']['Row'];
type QueueState = 'waiting' | 'called' | 'serving' | 'served' | 'cancelled';

function buildSandboxTicket(
  preview: SandboxPreviewData,
  ticketId: string | undefined,
  state: QueueState
): {
  ticket: TicketRow;
  position: number | null;
  estimatedWait: number | null;
  nowServing: string | null;
  deskName: string | null;
  departmentName: string;
  serviceName: string;
} {
  const baseEntry =
    preview.queueTickets.find((entry) => entry.id === ticketId) ?? preview.queueTickets[0];
  const fallbackDepartment = preview.departments[0];
  const fallbackService = fallbackDepartment?.services[0];
  const currentDepartment =
    preview.departments.find((department) => department.code === baseEntry?.departmentCode) ??
    fallbackDepartment;
  const currentService =
    currentDepartment?.services.find((service) => service.code === baseEntry?.serviceCode) ??
    fallbackService;
  const now = new Date().toISOString();
  const servingTicket =
    preview.queueTickets.find((entry) => entry.status === 'serving')?.ticketNumber ??
    preview.queueTickets.find((entry) => entry.status === 'called')?.ticketNumber ??
    null;

  return {
    ticket: {
      appointment_id: baseEntry?.source === 'reservation' ? `${baseEntry.id}-appointment` : null,
      called_at: state === 'called' || state === 'serving' ? now : null,
      called_by_staff_id: null,
      checked_in_at: now,
      completed_at: state === 'served' ? now : null,
      created_at: now,
      customer_data: {
        name: baseEntry?.name ?? 'Sandbox Customer',
        email: 'sandbox@example.com',
        party_name: baseEntry?.name ?? 'Sandbox Customer',
        party_size: baseEntry?.partySize,
        seating_preference: baseEntry?.seatingPreference,
        reservation_reference: baseEntry?.reservationReference,
      },
      customer_id: null,
      daily_sequence: 1,
      department_id: currentDepartment?.id ?? 'sandbox-department',
      desk_id: state === 'called' || state === 'serving' ? 'sandbox-desk' : null,
      estimated_wait_minutes: state === 'waiting' ? baseEntry?.estimatedWaitMinutes ?? 10 : 0,
      group_id: null,
      id: baseEntry?.id ?? 'sandbox-ticket',
      is_remote: baseEntry?.source === 'remote_join',
      source: baseEntry?.source === 'remote_join' ? 'qr_code' : baseEntry?.source === 'reservation' ? 'walk_in' : 'walk_in',
      notes: 'Sandbox preview only',
      office_id: preview.organization.id,
      parked_at: null,
      priority: null,
      priority_category_id: null,
      qr_token: 'sandbox-ticket',
      recall_count: state === 'called' ? 1 : 0,
      service_id: currentService?.id ?? 'sandbox-service',
      serving_started_at: state === 'serving' || state === 'served' ? now : null,
      status: state,
      ticket_number: baseEntry?.ticketNumber ?? 'SBX-001',
      transferred_from_ticket_id: null,
      locale: null,
      payment_status: null,
    },
    position: state === 'waiting' ? baseEntry?.position ?? 2 : null,
    estimatedWait:
      state === 'waiting' ? baseEntry?.estimatedWaitMinutes ?? 10 : null,
    nowServing: servingTicket,
    deskName:
      state === 'called' || state === 'serving'
        ? baseEntry?.deskName ?? preview.desks[0]?.displayName ?? preview.desks[0]?.name ?? null
        : null,
    departmentName: currentDepartment?.name ?? baseEntry?.departmentName ?? '',
    serviceName: currentService?.name ?? baseEntry?.serviceName ?? '',
  };
}

export function SandboxQueueRuntime({
  preview,
  initialTicketId,
}: {
  preview: SandboxPreviewData;
  initialTicketId?: string;
}) {
  const [state, setState] = useState<QueueState>('waiting');
  const payload = useMemo(
    () => buildSandboxTicket(preview, initialTicketId, state),
    [initialTicketId, preview, state]
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[1.5rem] border border-border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary/80">
              Sandbox queue controls
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Move through the real customer queue screen without using live tickets.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['waiting', 'called', 'serving', 'served', 'cancelled'] as QueueState[]).map((nextState) => (
              <button
                key={nextState}
                type="button"
                onClick={() => setState(nextState)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  state === nextState
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-white text-foreground hover:bg-muted'
                }`}
              >
                {nextState}
              </button>
            ))}
          </div>
        </div>
      </div>

      <QueueStatus
        key={`${payload.ticket.id}-${state}`}
        ticket={payload.ticket}
        organizationName={preview.organization.name}
        officeName={preview.office.name}
        departmentName={payload.departmentName}
        serviceName={payload.serviceName}
        sandbox={{
          enabled: true,
          initialPosition: payload.position,
          initialEstimatedWait: payload.estimatedWait,
          nowServing: payload.nowServing,
          deskName: payload.deskName,
        }}
      />
    </div>
  );
}

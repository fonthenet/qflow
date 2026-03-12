'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';
import QRCode from 'qrcode';
import { GroupTicketModal } from '@/components/kiosk/group-ticket-modal';
import { SendTicketLink } from '@/components/kiosk/send-ticket-link';

interface PriorityCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  weight: number | null;
}

interface KioskViewProps {
  office: any;
  organization: any;
  departments: any[];
  priorityCategories?: PriorityCategory[];
}

export function KioskView({ office, organization, departments, priorityCategories = [] }: KioskViewProps) {
  const [step, setStep] = useState<'department' | 'service' | 'priority' | 'ticket'>('department');
  const [selectedDept, setSelectedDept] = useState<any>(null);
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedPriority, setSelectedPriority] = useState<PriorityCategory | null>(null);
  const [ticket, setTicket] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  function handleServiceSelected(service: any) {
    setSelectedService(service);
    if (priorityCategories.length > 0) {
      setStep('priority');
    } else {
      handleCreateTicket(service, null);
    }
  }

  function handlePrioritySelected(priority: PriorityCategory | null) {
    setSelectedPriority(priority);
    handleCreateTicket(selectedService, priority);
  }

  async function handleCreateTicket(service: any, priority: PriorityCategory | null) {
    setLoading(true);
    const supabase = createClient();

    // Generate ticket number
    const { data: seqData, error: seqError } = await supabase.rpc(
      'generate_daily_ticket_number',
      { p_department_id: selectedDept.id }
    );

    if (seqError || !seqData?.[0]) {
      alert('Error generating ticket number. Please try again.');
      setLoading(false);
      return;
    }

    const { ticket_num, seq } = seqData[0];
    const qrToken = nanoid(12);

    // Create ticket with priority info
    const insertData: Record<string, unknown> = {
      office_id: office.id,
      department_id: selectedDept.id,
      service_id: service.id,
      ticket_number: ticket_num,
      daily_sequence: seq,
      status: 'waiting',
      qr_token: qrToken,
      checked_in_at: new Date().toISOString(),
    };

    if (priority) {
      insertData.priority_category_id = priority.id;
      insertData.priority = priority.weight ?? 0;
    }

    const { data: newTicket, error: ticketError } = await supabase
      .from('tickets')
      .insert(insertData)
      .select()
      .single();

    if (ticketError) {
      alert('Error creating ticket. Please try again.');
      setLoading(false);
      return;
    }

    // Generate QR code
    const qrUrl = `${window.location.origin}/q/${qrToken}`;
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    setTicket({
      ...newTicket,
      service_name: service.name,
      department_name: selectedDept.name,
      priority_name: priority?.name ?? null,
      priority_icon: priority?.icon ?? null,
      priority_color: priority?.color ?? null,
    });
    setQrDataUrl(dataUrl);
    setStep('ticket');
    setLoading(false);
  }

  function handlePrint() {
    window.print();
  }

  function handleNewTicket() {
    setStep('department');
    setSelectedDept(null);
    setSelectedService(null);
    setSelectedPriority(null);
    setTicket(null);
    setQrDataUrl('');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Header */}
      <div className="bg-card border-b border-border px-6 py-4 text-center">
        <h1 className="text-2xl font-bold">
          {organization?.name || 'QueueFlow'}
        </h1>
        <p className="text-muted-foreground">{office.name}</p>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Step 1: Select Department */}
        {step === 'department' && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold">Welcome</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Please select a department
              </p>
            </div>
            <div className="grid gap-4">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => {
                    setSelectedDept(dept);
                    setStep('service');
                  }}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all"
                >
                  <div>
                    <h3 className="text-xl font-semibold">{dept.name}</h3>
                    {dept.description && (
                      <p className="mt-1 text-muted-foreground">
                        {dept.description}
                      </p>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-primary">
                    {dept.code}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Select Service */}
        {step === 'service' && selectedDept && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold">{selectedDept.name}</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Select a service
              </p>
            </div>
            <div className="grid gap-4">
              {selectedDept.services
                ?.filter((s: any) => s.is_active)
                ?.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((service: any) => (
                  <button
                    key={service.id}
                    onClick={() => handleServiceSelected(service)}
                    disabled={loading}
                    className="flex items-center justify-between rounded-xl border border-border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all disabled:opacity-50"
                  >
                    <div>
                      <h3 className="text-xl font-semibold">{service.name}</h3>
                      {service.description && (
                        <p className="mt-1 text-muted-foreground">
                          {service.description}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-muted-foreground">
                        Est. {service.estimated_service_time} min
                      </p>
                    </div>
                    <div className="text-lg font-bold text-primary">
                      {service.code}
                    </div>
                  </button>
                ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep('department')}
                className="flex-1 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
              >
                Back to Departments
              </button>
              <button
                onClick={() => setShowGroupModal(true)}
                disabled={loading}
                className="flex-1 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                Group Ticket
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Select Priority */}
        {step === 'priority' && selectedService && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-3xl font-bold">Select Priority</h2>
              <p className="mt-2 text-lg text-muted-foreground">
                Choose your priority level
              </p>
            </div>
            <div className="grid gap-4">
              {/* Normal / Default option */}
              <button
                onClick={() => handlePrioritySelected(null)}
                disabled={loading}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-6 text-left shadow-sm hover:border-primary hover:shadow-md transition-all disabled:opacity-50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-xl">
                  🎫
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-semibold">Normal</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Standard queue - first come, first served
                  </p>
                </div>
              </button>

              {/* Priority category options */}
              {priorityCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handlePrioritySelected(cat)}
                  disabled={loading}
                  className="flex items-center gap-4 rounded-xl border-2 bg-card p-6 text-left shadow-sm hover:shadow-md transition-all disabled:opacity-50"
                  style={{ borderColor: cat.color ?? '#6b7280' }}
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-full text-xl text-white"
                    style={{ backgroundColor: cat.color ?? '#6b7280' }}
                  >
                    {cat.icon || '⭐'}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold">{cat.name}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Priority weight: {cat.weight}
                    </p>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-bold text-white"
                    style={{ backgroundColor: cat.color ?? '#6b7280' }}
                  >
                    Priority
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('service')}
              className="w-full rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              Back to Services
            </button>
          </div>
        )}

        {/* Step 4: Show Ticket */}
        {step === 'ticket' && ticket && (
          <div className="space-y-6">
            {/* Printable ticket */}
            <div
              ref={printRef}
              className="rounded-xl border-2 border-dashed border-primary/30 bg-card p-8 text-center print:border-solid print:border-black"
            >
              <p className="text-sm text-muted-foreground print:text-black">
                {organization?.name}
              </p>
              <p className="text-xs text-muted-foreground print:text-black">
                {office.name}
              </p>

              <div className="my-6">
                <p className="text-sm font-medium text-muted-foreground">
                  Your Ticket
                </p>
                <p className="text-6xl font-black text-primary print:text-black">
                  {ticket.ticket_number}
                </p>
              </div>

              <div className="mb-4 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium">Department:</span>{' '}
                  {ticket.department_name}
                </p>
                <p>
                  <span className="font-medium">Service:</span>{' '}
                  {ticket.service_name}
                </p>
                {ticket.priority_name && (
                  <p className="mt-2">
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: ticket.priority_color ?? '#6b7280' }}
                    >
                      {ticket.priority_icon && <span>{ticket.priority_icon}</span>}
                      {ticket.priority_name}
                    </span>
                  </p>
                )}
              </div>

              {qrDataUrl && (
                <div className="flex justify-center">
                  <img
                    src={qrDataUrl}
                    alt="Scan to track your queue position"
                    className="h-48 w-48"
                  />
                </div>
              )}

              {/* Group tickets listing */}
              {ticket.group_tickets && ticket.group_tickets.length > 1 && (
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Group Tickets ({ticket.group_tickets.length})
                  </p>
                  <div className="space-y-1">
                    {ticket.group_tickets.map((gt: any, i: number) => (
                      <div
                        key={gt.id}
                        className="flex items-center justify-between text-xs text-muted-foreground"
                      >
                        <span>{gt.person_name || `Person ${i + 1}`}</span>
                        <span className="font-mono font-bold">{gt.ticket_number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-4 text-xs text-muted-foreground">
                Scan this QR code to track your position
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date().toLocaleString()}
              </p>
            </div>

            {/* Share options (hidden when printing) */}
            <div className="print:hidden">
              <SendTicketLink
                ticketUrl={`${window.location.origin}/q/${ticket.qr_token}`}
                ticketNumber={ticket.ticket_number}
                officeName={office.name}
              />
            </div>

            {/* Actions (hidden when printing) */}
            <div className="flex gap-4 print:hidden">
              <button
                onClick={handlePrint}
                className="flex-1 rounded-lg bg-primary px-4 py-4 text-lg font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
              >
                Print Ticket
              </button>
              <button
                onClick={handleNewTicket}
                className="flex-1 rounded-lg border border-border bg-background px-4 py-4 text-lg font-medium hover:bg-muted transition-colors"
              >
                New Ticket
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Group Ticket Modal */}
      {showGroupModal && selectedDept && (
        <GroupTicketModal
          office={office}
          organization={organization}
          department={selectedDept}
          priorityCategories={priorityCategories}
          onClose={() => setShowGroupModal(false)}
          onComplete={(groupTickets, groupQrDataUrl) => {
            setTicket({
              ...groupTickets[0],
              service_name: groupTickets[0].service_name,
              department_name: selectedDept.name,
              group_tickets: groupTickets,
            });
            setQrDataUrl(groupQrDataUrl);
            setShowGroupModal(false);
            setStep('ticket');
          }}
        />
      )}
    </div>
  );
}

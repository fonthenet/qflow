'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { nanoid } from 'nanoid';

interface RemoteJoinFormProps {
  virtualCode: any;
  office: any;
  organization?: any;
  department: any;
  services?: any[];
  hasSpecificService?: boolean;
  estimatedWait?: number | null;
  service?: any;
}

export function RemoteJoinForm({
  virtualCode,
  office,
  organization,
  department,
  services = [],
  hasSpecificService = false,
  estimatedWait = null,
  service,
}: RemoteJoinFormProps) {
  // If a single service prop is passed (from simplified page), use it
  const resolvedServices = service ? [service] : services;
  const resolvedHasSpecific = service ? true : hasSpecificService;

  const [selectedServiceId, setSelectedServiceId] = useState<string>(
    resolvedHasSpecific && resolvedServices.length === 1 ? resolvedServices[0].id : ''
  );
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentWait, setCurrentWait] = useState<number | null>(estimatedWait);
  const [ticket, setTicket] = useState<{ ticket_number: string; qr_token: string } | null>(null);

  // Update wait estimate when service changes
  async function handleServiceChange(serviceId: string) {
    setSelectedServiceId(serviceId);
    if (serviceId) {
      const supabase = createClient();
      const { data: waitMinutes } = await supabase.rpc('estimate_wait_time', {
        p_department_id: department.id,
        p_service_id: serviceId,
      });
      setCurrentWait(waitMinutes ?? null);
    }
  }

  async function handleJoinQueue(e: React.FormEvent) {
    e.preventDefault();

    const serviceToUse = selectedServiceId || virtualCode.service_id;
    if (!serviceToUse) {
      setError('Please select a service');
      return;
    }

    setJoining(true);
    setError(null);

    try {
      const supabase = createClient();

      // Generate ticket number via proper RPC
      const { data: seqData, error: seqError } = await supabase.rpc(
        'generate_daily_ticket_number',
        { p_department_id: department.id }
      );

      if (seqError || !seqData?.[0]) {
        setError('Failed to generate ticket. Please try again.');
        setJoining(false);
        return;
      }

      const { ticket_num, seq } = seqData[0];
      const qrToken = nanoid(16);

      // Build customer data
      const customerData: Record<string, string> = {};
      if (customerName.trim()) customerData.name = customerName.trim();
      if (customerPhone.trim()) customerData.phone = customerPhone.trim();

      // Create ticket with is_remote flag
      const { data: newTicket, error: ticketError } = await supabase
        .from('tickets')
        .insert({
          office_id: virtualCode.office_id,
          department_id: virtualCode.department_id,
          service_id: serviceToUse,
          ticket_number: ticket_num,
          daily_sequence: seq,
          qr_token: qrToken,
          status: 'waiting',
          is_remote: true,
          checked_in_at: new Date().toISOString(),
          customer_data: Object.keys(customerData).length > 0 ? customerData : null,
          estimated_wait_minutes: currentWait,
        })
        .select('ticket_number, qr_token')
        .single();

      if (ticketError) throw ticketError;

      setTicket(newTicket);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to join queue. Please try again.');
    } finally {
      setJoining(false);
    }
  }

  const orgName = organization?.name || 'QueueFlow';
  const displayService = resolvedServices.length === 1 ? resolvedServices[0] : null;

  // Success state - show ticket and link to tracking
  if (ticket) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-xl border border-border bg-card p-8 shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <svg
                className="h-8 w-8 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="mb-2 text-2xl font-bold text-foreground">
              You&apos;re in the Queue!
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              You have successfully joined the queue remotely.
            </p>

            <div className="mb-6 rounded-lg bg-muted p-4">
              <p className="text-sm font-medium text-muted-foreground">
                Your Ticket Number
              </p>
              <p className="text-4xl font-bold text-primary">
                {ticket.ticket_number}
              </p>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-left text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Office</span>
                <span className="font-medium text-foreground">{office?.name}</span>
              </div>
              {department && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Department</span>
                  <span className="font-medium text-foreground">{department.name}</span>
                </div>
              )}
              {displayService && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Service</span>
                  <span className="font-medium text-foreground">{displayService.name}</span>
                </div>
              )}
            </div>

            <a
              href={`/q/${ticket.qr_token}`}
              className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Track Your Position
            </a>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">Powered by QueueFlow</p>
        </div>
      </div>
    );
  }

  // Join form
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Header */}
      <div className="bg-primary px-4 pb-8 pt-6 text-center text-primary-foreground">
        <p className="text-sm font-medium opacity-80">{orgName}</p>
        <h1 className="mt-1 text-2xl font-bold">{office?.name}</h1>
        <div className="mx-auto mt-4 max-w-sm space-y-1 rounded-lg bg-white/15 px-4 py-3 text-sm">
          {department && (
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
              <span>{department.name}</span>
            </div>
          )}
          {displayService && (
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span>{displayService.name}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">
        {/* Estimated wait */}
        {currentWait !== null && (
          <div className="mb-6 rounded-xl bg-card p-4 text-center shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">Estimated Wait Time</p>
            <p className="text-2xl font-bold text-primary">
              {currentWait}
              <span className="text-sm font-normal text-muted-foreground"> min</span>
            </p>
          </div>
        )}

        {/* Service selection (if not specific) */}
        {!resolvedHasSpecific && resolvedServices.length > 1 && (
          <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
            <label className="mb-3 block text-sm font-medium text-foreground">
              Select a Service <span className="text-destructive">*</span>
            </label>
            <div className="space-y-2">
              {resolvedServices.map((svc: any) => (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => handleServiceChange(svc.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-all ${
                    selectedServiceId === svc.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border bg-background hover:border-primary/50'
                  }`}
                >
                  <p className="font-medium text-foreground">{svc.name}</p>
                  {svc.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{svc.description}</p>
                  )}
                  {svc.estimated_service_time && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Est. {svc.estimated_service_time} min
                    </p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <h2 className="mb-1 text-lg font-semibold text-foreground">Your Details</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Enter your information to join the queue.
        </p>

        <form onSubmit={handleJoinQueue} className="space-y-5">
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-foreground">
              Name <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="name"
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Enter your name"
              autoComplete="name"
              className="w-full rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-foreground">
              Phone <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <input
              id="phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              autoComplete="tel"
              className="w-full rounded-lg border border-input bg-card px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={joining || (!resolvedHasSpecific && !selectedServiceId)}
            className="w-full rounded-xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-lg transition-all hover:bg-primary/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {joining ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Joining Queue...
              </span>
            ) : (
              'Join Queue'
            )}
          </button>
        </form>

        <div className="mt-6 rounded-lg bg-muted/50 p-4">
          <p className="text-center text-xs text-muted-foreground">
            After joining, you&apos;ll receive a ticket to track your position.
            You can wait anywhere and come when it&apos;s almost your turn.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 pb-6 pt-2 text-center">
        <p className="text-xs text-muted-foreground">Powered by QueueFlow</p>
      </div>
    </div>
  );
}

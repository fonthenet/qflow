'use client';

import { useState, useEffect, useCallback, useRef, useTransition } from 'react';
import {
  PhoneForwarded,
  Play,
  CheckCircle2,
  UserX,
  ArrowRightLeft,
  Volume2,
  Smartphone,
  Clock,
  Users,
  Ticket,
  ChevronRight,
  Loader2,
  X,
  AlertCircle,
  TimerReset,
  MapPinned,
} from 'lucide-react';
import { useRealtimeQueue } from '@/lib/hooks/use-realtime-queue';
import {
  callNextTicket,
  startServing,
  markServed,
  markNoShow,
  transferTicket,
  recallTicket,
  buzzTicket,
  resetTicketToQueue,
} from '@/lib/actions/ticket-actions';
import { CustomerDataCard } from '@/components/desk/customer-data-card';
import { PriorityBadge } from '@/components/tickets/priority-badge';
import type { Database } from '@/lib/supabase/database.types';
import type { CustomerDataScope } from '@/lib/privacy';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Department = Database['public']['Tables']['departments']['Row'];
type Service = Database['public']['Tables']['services']['Row'];
type IntakeField = Database['public']['Tables']['intake_form_fields']['Row'];

interface DeskPanelProps {
  desk: {
    id: string;
    name: string;
    display_name: string | null;
    department_id: string;
    office_id: string;
  };
  staffName: string;
  departments: Department[];
  services: Service[];
  priorityCategories?: Array<{
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  }>;
  currentTicketFields?: IntakeField[];
  customerDataScope?: CustomerDataScope;
  initialCurrentTicket?: Ticket | null;
}

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

function useServiceTimer(startTime: string | null) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsed(0);
      return;
    }

    const start = new Date(startTime).getTime();
    const tick = () => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return {
    elapsed,
    formatted: `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
    minutes,
    seconds,
  };
}

const CALL_WAIT_SECONDS = 60;

function useCallCountdown(calledAt: string | null) {
  const [remaining, setRemaining] = useState(CALL_WAIT_SECONDS);

  useEffect(() => {
    if (!calledAt) {
      setRemaining(CALL_WAIT_SECONDS);
      return;
    }

    const start = new Date(calledAt).getTime();
    const tick = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setRemaining(Math.max(0, CALL_WAIT_SECONDS - elapsed));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [calledAt]);

  return remaining;
}

export function DeskPanel({
  desk,
  staffName,
  departments,
  services,
  priorityCategories = [],
  currentTicketFields = [],
  customerDataScope = 'staff',
  initialCurrentTicket,
}: DeskPanelProps) {
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(
    initialCurrentTicket ?? null
  );
  const [lastAction, setLastAction] = useState<{
    ticketNumber: string;
    action: 'served' | 'no_show' | 'cancelled' | 'transferred' | 'reset';
    time: Date;
  } | null>(null);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPending, startTransition] = useTransition();
  const toastIdRef = useRef(0);

  const { queue, isLoading } = useRealtimeQueue({
    officeId: desk.office_id,
    departmentId: desk.department_id,
  });

  const timer = useServiceTimer(
    currentTicket?.status === 'serving' ? currentTicket.serving_started_at : null
  );

  const callCountdown = useCallCountdown(
    currentTicket?.status === 'called' ? currentTicket.called_at : null
  );

  // Sync current ticket from realtime data
  useEffect(() => {
    if (!currentTicket) return;

    // Check if our current ticket still exists in active states
    const allActive = [...queue.called, ...queue.serving];
    const updated = allActive.find((t) => t.id === currentTicket.id);
    if (updated) {
      // Only sync if the realtime data is newer (avoid overwriting optimistic recall updates)
      const currentCalledAt = currentTicket.called_at ? new Date(currentTicket.called_at).getTime() : 0;
      const updatedCalledAt = updated.called_at ? new Date(updated.called_at).getTime() : 0;
      if (updatedCalledAt >= currentCalledAt) {
        setCurrentTicket(updated);
      }
      return;
    }

    const waitingTicket = queue.waiting.find((t) => t.id === currentTicket.id);
    if (waitingTicket) {
      setCurrentTicket(null);
      return;
    }

    const cancelledTicket = queue.cancelled.find((t) => t.id === currentTicket.id);
    if (cancelledTicket) {
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'cancelled', time: new Date() });
      setCurrentTicket(null);
      return;
    }

    if (
      currentTicket.status === 'serving' ||
      currentTicket.status === 'called'
    ) {
      const inServed = queue.recentlyServed.find(
        (t) => t.id === currentTicket.id
      );
      if (inServed) {
        setCurrentTicket(null);
      }
    }
  }, [queue, currentTicket]);

  const addToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCallNext = () => {
    startTransition(async () => {
      const result = await callNextTicket(desk.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
      addToast(`Called ticket ${result.data.ticket_number}`, 'info');
    });
  };

  const handleStartServing = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await startServing(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCurrentTicket(result.data);
      addToast('Now serving customer');
    });
  };

  const handleMarkServed = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await markServed(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'served', time: new Date() });
      setCurrentTicket(null);
      addToast('Customer marked as served', 'success');
    });
  };

  const handleNoShow = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await markNoShow(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'no_show', time: new Date() });
      setCurrentTicket(null);
      addToast('Ticket marked as no-show', 'info');
    });
  };

  const handleRecall = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await recallTicket(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      const smsSent = 'smsSent' in result && result.smsSent === true;
      // Update local state so countdown resets
      setCurrentTicket((prev) =>
        prev ? { ...prev, called_at: new Date().toISOString() } : prev
      );
      addToast(
        smsSent
          ? 'Recall alert sent — timer reset and text backup delivered'
          : 'Recall alert sent — timer reset',
        'info'
      );
    });
  };

  const handleBuzz = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await buzzTicket(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      const smsSent = 'smsSent' in result && result.smsSent === true;
      addToast(
        smsSent
          ? 'Buzz alert sent by push + text'
          : 'Buzz alert sent',
        'info'
      );
    });
  };

  const handleResetToQueue = () => {
    if (!currentTicket) return;
    startTransition(async () => {
      const result = await resetTicketToQueue(currentTicket.id);
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'reset', time: new Date() });
      setCurrentTicket(null);
      addToast('Ticket reset to queue', 'info');
    });
  };

  const handleTransfer = () => {
    if (!currentTicket || !transferDeptId || !transferServiceId) return;
    startTransition(async () => {
      const result = await transferTicket(
        currentTicket.id,
        transferDeptId,
        transferServiceId
      );
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setLastAction({ ticketNumber: currentTicket.ticket_number, action: 'transferred', time: new Date() });
      setCurrentTicket(null);
      setShowTransferDialog(false);
      setTransferDeptId('');
      setTransferServiceId('');
      addToast(
        `Transferred to ${departments.find((d) => d.id === transferDeptId)?.name ?? 'department'}`,
        'success'
      );
    });
  };

  const transferableServices = services.filter(
    (s) => s.department_id === transferDeptId && s.is_active
  );

  const ticketStatus = currentTicket?.status;
  const isIdle = !currentTicket;
  const isCalled = ticketStatus === 'called';
  const isServing = ticketStatus === 'serving';
  const departmentMap = new Map(departments.map((department) => [department.id, department]));
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  const getPriorityCategory = useCallback(
    (ticket: Ticket | null | undefined) =>
      priorityCategories.find((category) => category.id === ticket?.priority_category_id) ?? null,
    [priorityCategories]
  );

  const getTicketServiceName = useCallback(
    (ticket: Ticket | null | undefined) =>
      (ticket?.service_id ? serviceMap.get(ticket.service_id)?.name : null) ?? 'Unknown service',
    [serviceMap]
  );

  const getTicketDepartmentName = useCallback(
    (ticket: Ticket | null | undefined) =>
      (ticket?.department_id ? departmentMap.get(ticket.department_id)?.name : null) ?? 'Unknown department',
    [departmentMap]
  );

  const getTicketCustomerName = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket?.customer_data || typeof ticket.customer_data !== 'object' || Array.isArray(ticket.customer_data)) {
      return null;
    }

    const candidate = (ticket.customer_data as Record<string, unknown>).name;
    return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : null;
  }, []);

  const getTicketSource = useCallback((ticket: Ticket | null | undefined) => {
    if (!ticket) return 'Unknown';
    if (ticket.appointment_id) return 'Appointment';
    if (ticket.is_remote) return 'Remote join';
    return 'Walk-in';
  }, []);

  const formatAbsoluteTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    return new Date(value).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  }, []);

  const formatRelativeTime = useCallback((value: string | null | undefined) => {
    if (!value) return '--';
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
    if (elapsedMinutes < 1) return 'Just now';
    if (elapsedMinutes === 1) return '1 min ago';
    if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
  }, []);

  const waitingTickets = queue.waiting;
  const activeElsewhere = [...queue.called, ...queue.serving].filter((ticket) => ticket.id !== currentTicket?.id);
  const nextWaitingTicket = waitingTickets[0] ?? null;
  const longestWaitingMinutes = waitingTickets.reduce((longest, ticket) => {
    if (!ticket.created_at) return longest;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60000));
    return Math.max(longest, elapsed);
  }, 0);
  const queueStateLabel = isServing ? 'Serving now' : isCalled ? 'Waiting for customer' : 'Ready for next ticket';

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {desk.display_name ?? desk.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Operator: {staffName}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground/80">{queueStateLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {queue.waiting.length} waiting
            </span>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground md:flex">
            <TimerReset className="h-4 w-4" />
            Longest wait {longestWaitingMinutes}m
          </div>
          <div
            className={`h-3 w-3 rounded-full ${
              isServing
                ? 'bg-success animate-pulse'
                : isCalled
                  ? 'bg-warning animate-pulse'
                  : 'bg-muted-foreground'
            }`}
            title={isServing ? 'Serving' : isCalled ? 'Called' : 'Idle'}
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Left Column: Current Ticket + Customer Data */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Current Ticket Card */}
          <div
            className={`rounded-2xl border-2 p-6 transition-all ${
              isServing
                ? 'border-success/40 bg-success/5'
                : isCalled
                  ? 'border-warning/40 bg-warning/5 animate-[pulse_2s_ease-in-out_3]'
                  : 'border-border bg-card'
            }`}
          >
            {isIdle ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                {lastAction ? (
                  <>
                    <div className={`rounded-full p-5 mb-4 ${
                      lastAction.action === 'served' ? 'bg-success/10' :
                      lastAction.action === 'no_show' ? 'bg-warning/10' :
                      lastAction.action === 'cancelled' ? 'bg-destructive/10' :
                      'bg-muted'
                    }`}>
                      {lastAction.action === 'served' ? (
                        <CheckCircle2 className="h-8 w-8 text-success" />
                      ) : lastAction.action === 'no_show' ? (
                        <UserX className="h-8 w-8 text-warning" />
                      ) : lastAction.action === 'cancelled' ? (
                        <AlertCircle className="h-8 w-8 text-destructive" />
                      ) : lastAction.action === 'transferred' ? (
                        <ArrowRightLeft className="h-8 w-8 text-primary" />
                      ) : (
                        <Ticket className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-1">
                      {lastAction.action === 'served' ? 'Visit Complete' :
                       lastAction.action === 'no_show' ? 'Marked No-Show' :
                       lastAction.action === 'cancelled' ? 'Customer Left Queue' :
                       lastAction.action === 'transferred' ? 'Ticket Transferred' :
                       'Ticket Reset'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-1">
                      Ticket <span className="font-bold text-foreground">{lastAction.ticketNumber}</span>
                      {lastAction.action === 'served' ? ' was served by you' :
                       lastAction.action === 'no_show' ? ' did not show up' :
                       lastAction.action === 'cancelled' ? ' ended their visit' :
                       lastAction.action === 'transferred' ? ' was transferred' :
                       ' was sent back to queue'}
                    </p>
                    <p className="text-xs text-muted-foreground mb-6">
                      {lastAction.time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="rounded-full bg-muted p-6 mb-4">
                      <Ticket className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h2 className="text-xl font-semibold text-foreground mb-1">
                      No Active Ticket
                    </h2>
                    <p className="text-sm text-muted-foreground mb-6">
                      {queue.waiting.length > 0
                        ? `${queue.waiting.length} ticket${queue.waiting.length > 1 ? 's' : ''} waiting in queue`
                        : 'Queue is empty'}
                    </p>
                  </>
                )}
                <button
                  onClick={handleCallNext}
                  disabled={isPending || queue.waiting.length === 0}
                  className="inline-flex items-center gap-3 rounded-xl bg-primary px-8 py-4 text-lg font-bold text-primary-foreground shadow-lg shadow-primary/25 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0"
                >
                  {isPending ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <PhoneForwarded className="h-6 w-6" />
                  )}
                  {queue.waiting.length > 0 ? `Call Next (${queue.waiting.length})` : 'Call Next'}
                </button>
              </div>
            ) : (
              <div>
                {/* Status Badge + Timer */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                        isServing
                          ? 'bg-success/15 text-success'
                          : 'bg-warning/15 text-warning'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          isServing ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      {isServing ? 'Serving' : 'Called'}
                    </span>
                    <PriorityBadge priorityCategory={getPriorityCategory(currentTicket)} />
                  </div>
                  {isServing && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      <span
                        className={`font-mono text-lg font-bold ${
                          timer.minutes >= 10 ? 'text-destructive' : 'text-foreground'
                        }`}
                      >
                        {timer.formatted}
                      </span>
                    </div>
                  )}
                  {isCalled && (
                    <div
                      className={`flex items-center gap-2 rounded-full px-4 py-1.5 ${
                        callCountdown <= 10
                          ? 'bg-destructive/15'
                          : callCountdown <= 30
                            ? 'bg-warning/15'
                            : 'bg-muted'
                      } ${callCountdown <= 10 ? 'animate-pulse' : ''}`}
                    >
                      <Clock className={`h-5 w-5 ${
                        callCountdown <= 10 ? 'text-destructive' : callCountdown <= 30 ? 'text-warning' : 'text-muted-foreground'
                      }`} />
                      <span
                        className={`font-mono text-2xl font-black tabular-nums ${
                          callCountdown <= 10
                            ? 'text-destructive'
                            : callCountdown <= 30
                              ? 'text-warning'
                              : 'text-foreground'
                        }`}
                      >
                        0:{callCountdown.toString().padStart(2, '0')}
                      </span>
                      {callCountdown === 0 && (
                        <span className="rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">EXPIRED</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Ticket Number - Large and prominent */}
                <div className="text-center mb-5">
                  <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    Ticket Number
                  </p>
                  <p className="text-6xl font-black text-foreground tracking-tight leading-none">
                    {currentTicket.ticket_number}
                  </p>
                </div>

                <div className="mb-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Service</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getTicketServiceName(currentTicket)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Source</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getTicketSource(currentTicket)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Checked in</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatAbsoluteTime(currentTicket.checked_in_at)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isServing ? 'Started serving' : 'Called at'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {isServing ? formatAbsoluteTime(currentTicket.serving_started_at) : formatAbsoluteTime(currentTicket.called_at)}
                    </p>
                  </div>
                </div>

                {/* Customer Data */}
                {currentTicket.customer_data ? (
                  <CustomerDataCard
                    data={currentTicket.customer_data as Record<string, unknown> | null}
                    fields={currentTicketFields}
                    scope={customerDataScope}
                    className="mb-5"
                  />
                ) : (
                  <div className="mb-5 grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{getTicketCustomerName(currentTicket) ?? 'No intake collected'}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Department</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">{getTicketDepartmentName(currentTicket)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estimated wait</p>
                      <p className="mt-1 text-sm font-semibold text-foreground">
                        {currentTicket.estimated_wait_minutes ? `${currentTicket.estimated_wait_minutes} min` : 'Not available'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-3">
                  {isCalled && (
                    <>
                      <button
                        onClick={handleStartServing}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-success px-5 py-3 text-sm font-bold text-success-foreground shadow-md hover:bg-success/90 disabled:opacity-50 transition-all"
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Start Serving
                      </button>
                      <button
                        onClick={handleRecall}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                      >
                        <Volume2 className="h-4 w-4" />
                        Recall
                      </button>
                      <button
                        onClick={handleBuzz}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 px-5 py-3 text-sm font-bold text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-all"
                      >
                        <Smartphone className="h-4 w-4" />
                        Buzz
                      </button>
                      <button
                        onClick={handleNoShow}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-warning/10 px-5 py-3 text-sm font-bold text-warning hover:bg-warning/20 disabled:opacity-50 transition-all"
                      >
                        <UserX className="h-4 w-4" />
                        No Show
                      </button>
                      <button
                        onClick={handleResetToQueue}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-5 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50 transition-all"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        Reset to Queue
                      </button>
                    </>
                  )}

                  {isServing && (
                    <>
                      <button
                        onClick={handleMarkServed}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-success px-6 py-3 text-sm font-bold text-success-foreground shadow-md hover:bg-success/90 disabled:opacity-50 transition-all"
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Mark Served
                      </button>
                      <button
                        onClick={() => setShowTransferDialog(true)}
                        disabled={isPending}
                        className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-5 py-3 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                        Transfer
                      </button>
                    </>
                  )}

                  {/* Call Next while serving (queue next) */}
                  {isServing && queue.waiting.length > 0 && (
                    <button
                      onClick={handleCallNext}
                      disabled={isPending}
                      className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-bold text-foreground hover:bg-muted disabled:opacity-50 transition-all ml-auto"
                    >
                      <PhoneForwarded className="h-4 w-4" />
                      Call Next ({queue.waiting.length})
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Queue Health */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Waiting</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.waiting.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Longest wait</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{longestWaitingMinutes}m</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active elsewhere</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{activeElsewhere.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently served</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{queue.recentlyServed.length}</p>
            </div>
          </div>
        </div>

        {/* Right Column: Queue List */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Waiting Queue */}
          <div className="rounded-2xl border border-border bg-card flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Queue
                </h3>
                <p className="text-xs text-muted-foreground">Next people waiting for this desk&apos;s department</p>
              </div>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {queue.waiting.length}
              </span>
            </div>
            <div className="border-b border-border px-4 py-3">
              {nextWaitingTicket ? (
                <div className="rounded-xl bg-primary/5 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Up next</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-lg font-bold text-foreground">{nextWaitingTicket.ticket_number}</p>
                    <PriorityBadge priorityCategory={getPriorityCategory(nextWaitingTicket)} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{getTicketServiceName(nextWaitingTicket)} · {formatRelativeTime(nextWaitingTicket.created_at)}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No one is waiting right now.</p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : queue.waiting.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
                  <Ticket className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">No tickets waiting</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When new arrivals check in, they will appear here in queue order.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {queue.waiting.map((ticket, index) => (
                    <div
                      key={ticket.id}
                      className="rounded-xl border border-border px-3 py-3 transition-colors hover:bg-muted/30"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-foreground">
                              {ticket.ticket_number}
                            </p>
                            <PriorityBadge priorityCategory={getPriorityCategory(ticket)} className="shrink-0" />
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {getTicketSource(ticket)}
                            </span>
                          </div>
                          <p className="mt-1 text-sm text-foreground/80">{getTicketServiceName(ticket)}</p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{getTicketCustomerName(ticket) ?? 'No name provided'}</span>
                            <span>{formatRelativeTime(ticket.created_at)}</span>
                            <span>Checked in {formatAbsoluteTime(ticket.checked_in_at)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Currently Called / Being Served by Others */}
          <div className="rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                Active at Other Desks
              </h3>
              <p className="text-xs text-muted-foreground">Cross-desk visibility for called or serving tickets</p>
            </div>
            <div className="p-2 space-y-1 max-h-56 overflow-y-auto">
              {activeElsewhere.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No other desks are actively calling or serving right now.
                </p>
              ) : (
                activeElsewhere.map((ticket) => (
                  <div
                    key={ticket.id}
                    className="rounded-xl border border-border px-3 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          ticket.status === 'serving' ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      <span className="text-sm font-bold text-foreground">
                        {ticket.ticket_number}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground ml-auto">
                        {ticket.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{getTicketServiceName(ticket)}</span>
                      <span>{getTicketSource(ticket)}</span>
                      <span>{formatRelativeTime(ticket.called_at ?? ticket.serving_started_at)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Transfer Dialog */}
      {showTransferDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-primary" />
                Transfer Ticket
              </h3>
              <button
                onClick={() => {
                  setShowTransferDialog(false);
                  setTransferDeptId('');
                  setTransferServiceId('');
                }}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Transferring ticket{' '}
                  <span className="font-bold text-foreground">
                    {currentTicket?.ticket_number}
                  </span>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">
                  Department
                </label>
                <select
                  value={transferDeptId}
                  onChange={(e) => {
                    setTransferDeptId(e.target.value);
                    setTransferServiceId('');
                  }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  <option value="">Select department...</option>
                  {departments
                    .filter((d) => d.is_active && d.id !== desk.department_id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
              {transferDeptId && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Service
                  </label>
                  <select
                    value={transferServiceId}
                    onChange={(e) => setTransferServiceId(e.target.value)}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    <option value="">Select service...</option>
                    {transferableServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setShowTransferDialog(false);
                    setTransferDeptId('');
                    setTransferServiceId('');
                  }}
                  className="flex-1 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={!transferDeptId || !transferServiceId || isPending}
                  className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Transferring...
                    </span>
                  ) : (
                    'Transfer'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium animate-[slideIn_0.3s_ease-out] ${
              toast.type === 'success'
                ? 'bg-success text-success-foreground'
                : toast.type === 'error'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-primary text-primary-foreground'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="h-4 w-4 flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="h-4 w-4 flex-shrink-0" />}
            {toast.type === 'info' && <ChevronRight className="h-4 w-4 flex-shrink-0" />}
            {toast.message}
            <button
              onClick={() => removeToast(toast.id)}
              className="ml-2 opacity-70 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

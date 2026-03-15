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
import type { Database } from '@/lib/supabase/database.types';

type Ticket = Database['public']['Tables']['tickets']['Row'];
type Department = Database['public']['Tables']['departments']['Row'];
type Service = Database['public']['Tables']['services']['Row'];

interface DeskPanelProps {
  desk: {
    id: string;
    name: string;
    display_name: string | null;
    department_id: string;
    office_id: string;
  };
  staffId: string;
  staffName: string;
  departments: Department[];
  services: Service[];
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
  staffId,
  staffName,
  departments,
  services,
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
      const result = await callNextTicket(desk.id, staffId);
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
      const result = await startServing(currentTicket.id, staffId);
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
      const result = await markServed(currentTicket.id, staffId);
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
      const result = await markNoShow(currentTicket.id, staffId);
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
      const reachedPhone =
        ('pushSent' in result && result.pushSent === true) ||
        ('apnsSent' in result && result.apnsSent === true) ||
        ('androidSent' in result && result.androidSent === true) ||
        ('smsSent' in result && result.smsSent === true);
      // Update local state so countdown resets
      setCurrentTicket((prev) =>
        prev ? { ...prev, called_at: new Date().toISOString() } : prev
      );
      addToast(
        reachedPhone
          ? 'Recall alert sent to the phone and timer reset'
          : 'Recall sent, but no phone delivery channel responded',
        reachedPhone ? 'info' : 'error'
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
      const reachedPhone =
        ('pushSent' in result && result.pushSent === true) ||
        ('apnsSent' in result && result.apnsSent === true) ||
        ('androidSent' in result && result.androidSent === true) ||
        ('smsSent' in result && result.smsSent === true);
      addToast(
        reachedPhone
          ? 'Buzz alert sent to the phone'
          : 'Buzz sent, but no phone delivery channel responded',
        reachedPhone ? 'info' : 'error'
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
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {queue.waiting.length} waiting
            </span>
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

                {/* Customer Data */}
                <CustomerDataCard
                  data={currentTicket.customer_data as Record<string, unknown> | null}
                  className="mb-5"
                />

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

          {/* Quick Stats Row */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{queue.waiting.length}</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">Waiting</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-foreground">{queue.serving.length}</p>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                Being Served
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 text-center">
              <p className="text-2xl font-bold text-foreground">
                {queue.recentlyServed.length}
              </p>
              <p className="text-xs text-muted-foreground font-medium mt-1">
                Recently Served
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Queue List */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Waiting Queue */}
          <div className="rounded-2xl border border-border bg-card flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-foreground">
                Queue
              </h3>
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
                {queue.waiting.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : queue.waiting.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  No tickets waiting
                </p>
              ) : (
                <div className="space-y-1">
                  {queue.waiting.map((ticket, index) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">
                          {ticket.ticket_number}
                        </p>
                        {ticket.customer_data &&
                          typeof ticket.customer_data === 'object' &&
                          !Array.isArray(ticket.customer_data) &&
                          'name' in ticket.customer_data && (
                            <p className="text-xs text-muted-foreground truncate">
                              {String(ticket.customer_data.name)}
                            </p>
                          )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {ticket.created_at
                          ? new Date(ticket.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Currently Called / Being Served by Others */}
          {(queue.called.length > 0 || queue.serving.length > 0) && (
            <div className="rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Active at Other Desks
                </h3>
              </div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto">
                {[...queue.called, ...queue.serving]
                  .filter((t) => t.id !== currentTicket?.id)
                  .map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-3 rounded-lg px-3 py-2"
                    >
                      <span
                        className={`h-2 w-2 rounded-full flex-shrink-0 ${
                          ticket.status === 'serving' ? 'bg-success' : 'bg-warning'
                        }`}
                      />
                      <span className="text-sm font-bold text-foreground">
                        {ticket.ticket_number}
                      </span>
                      <span className="text-xs text-muted-foreground capitalize ml-auto">
                        {ticket.status}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
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

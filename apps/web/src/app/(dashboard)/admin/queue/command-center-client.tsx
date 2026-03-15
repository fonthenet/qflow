'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTerminology } from '@/lib/terminology-context';
import { useRealtimeQueue } from '@/lib/hooks/use-realtime-queue';
import {
  assignDesk,
  buzzTicket,
  callNextTicket,
  callSpecificTicket,
  markNoShow,
  markServed,
  recallTicket,
  resetTicketToQueue,
  startServing,
  transferTicket,
  unassignDesk,
} from '@/lib/actions/ticket-actions';
import { cancelVisit, deleteVisit } from './actions';
import { FocusPanel, StageColumn } from './command-center-panels';
import {
  ConfirmAction,
  QueueClientProps,
  OperatorActionPulse,
  Ticket,
  TicketAction,
  Toast,
  ToastContainer,
  ViewMode,
  bucketQueueTickets,
  flattenQueueData,
  formatClock,
  formatDuration,
  getTicketActionKey,
  getCustomerName,
  getStatusMeta,
  matchesSearch,
  sortRecentTickets,
} from './command-center-utils';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Filter,
  Hourglass,
  PhoneCall,
  Search,
  X,
} from 'lucide-react';

export function CommandCenterClient({
  staffId,
  staffName,
  assignedDesk,
  availableDesks,
  departments,
  services,
  offices,
  primaryOfficeId,
  tickets: initialTickets,
  totalCount,
  currentPage,
  pageSize,
  filters,
}: QueueClientProps) {
  const t = useTerminology();
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('board');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [transferDialogId, setTransferDialogId] = useState<string | null>(null);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [deskId, setDeskId] = useState<string | null>(assignedDesk?.id || null);
  const [deskDisplayName, setDeskDisplayName] = useState<string | null>(assignedDesk?.display_name || assignedDesk?.name || null);
  const [deskSelectOpen, setDeskSelectOpen] = useState(false);

  const { queue, isLoading: queueLoading, refetch } = useRealtimeQueue({ officeId: primaryOfficeId });
  const [localQueue, setLocalQueue] = useState(queue);
  const [localHistory, setLocalHistory] = useState(initialTickets);
  const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
  const [actionPulseByTicket, setActionPulseByTicket] = useState<Record<string, OperatorActionPulse>>({});

  useEffect(() => {
    setLocalQueue(queue);
  }, [queue]);

  useEffect(() => {
    setLocalHistory(initialTickets);
  }, [initialTickets]);

  function addToast(message: string, type: Toast['type'] = 'success') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }

  const backlogTickets = [...localQueue.issued, ...localQueue.waiting].filter((ticket) => matchesSearch(ticket, search));
  const calledTickets = localQueue.called.filter((ticket) => matchesSearch(ticket, search));
  const servingTickets = localQueue.serving.filter((ticket) => matchesSearch(ticket, search));
  const recentTickets = sortRecentTickets([
    ...localQueue.recentlyServed,
    ...localQueue.cancelled,
    ...localQueue.noShows,
    ...localQueue.transferred,
  ]).filter((ticket) => matchesSearch(ticket, search));
  const historyTickets = localHistory.filter((ticket) => matchesSearch(ticket, search));
  const boardTickets = [...servingTickets, ...calledTickets, ...backlogTickets, ...recentTickets];

  useEffect(() => {
    const source = viewMode === 'board' ? boardTickets : historyTickets;
    if (source.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !source.some((ticket) => ticket.id === selectedId)) {
      setSelectedId(source[0].id);
    }
  }, [boardTickets, historyTickets, selectedId, viewMode]);

  const selectedTicket =
    viewMode === 'board'
      ? boardTickets.find((ticket) => ticket.id === selectedId) || null
      : historyTickets.find((ticket) => ticket.id === selectedId) || null;

  const transferTicketRecord = [...boardTickets, ...historyTickets].find((ticket) => ticket.id === transferDialogId) || null;
  const filteredServices = transferDeptId
    ? services.filter((service) => service.department_id === transferDeptId)
    : services;
  const intakeCount = localQueue.issued.length + localQueue.waiting.length;
  const calledCount = localQueue.called.length;
  const servingCount = localQueue.serving.length;
  const resolvedCount = recentTickets.length;
  const longestWaitSeconds = backlogTickets.reduce((max, ticket) => {
    if (!ticket.created_at) return max;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 1000));
    return Math.max(max, elapsed);
  }, 0);

  function setActionPending(ticketId: string, action: TicketAction, pending: boolean) {
    const key = getTicketActionKey(ticketId, action);
    setPendingActions((current) => {
      if (!pending) {
        const { [key]: _ignored, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: true };
    });
  }

  function isActionPending(ticketId: string, action: TicketAction) {
    return Boolean(pendingActions[getTicketActionKey(ticketId, action)]);
  }

  function setLivePulse(ticketId: string, pulse: OperatorActionPulse) {
    setActionPulseByTicket((current) => ({
      ...current,
      [ticketId]: pulse,
    }));
  }

  function getLivePulse(ticketId: string) {
    return actionPulseByTicket[ticketId] || null;
  }

  function updateTicketLocally(ticketId: string, transform: (ticket: Ticket) => Ticket | null) {
    setLocalQueue((current) => {
      const nextTickets = flattenQueueData(current).flatMap((ticket) => {
        if (ticket.id !== ticketId) return [ticket];
        const nextTicket = transform(ticket);
        return nextTicket ? [nextTicket] : [];
      });
      return bucketQueueTickets(nextTickets);
    });

    setLocalHistory((current) =>
      current.flatMap((ticket) => {
        if (ticket.id !== ticketId) return [ticket];
        const nextTicket = transform(ticket);
        return nextTicket ? [nextTicket] : [];
      })
    );
  }

  function refreshViews() {
    void refetch();
    startTransition(() => {
      router.refresh();
    });
  }

  async function runTask(
    action: TicketAction,
    ticketId: string,
    work: () => Promise<{ error?: string | null; data?: unknown } | void>,
    successMessage: string,
    optimisticUpdate?: () => void,
    onSuccess?: (result: { error?: string | null; data?: unknown } | void) => void
  ) {
    const queueSnapshot = localQueue;
    const historySnapshot = localHistory;
    setActionPending(ticketId, action, true);
    if (optimisticUpdate) optimisticUpdate();

    try {
      const result = await work();
      if (result && 'error' in result && result.error) {
        throw new Error(result.error);
      }
      onSuccess?.(result);
      addToast(successMessage);
      refreshViews();
    } catch (error) {
      setLocalQueue(queueSnapshot);
      setLocalHistory(historySnapshot);
      addToast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
    } finally {
      setActionPending(ticketId, action, false);
    }
  }

  function handlePrimaryAction(ticket: Ticket) {
    if (ticket.status === 'issued' || ticket.status === 'waiting') {
      handleAction('call', ticket);
      return;
    }
    if (ticket.status === 'called') {
      handleAction('serve', ticket);
      return;
    }
    if (ticket.status === 'serving') {
      handleAction('done', ticket);
    }
  }

  function handleAction(
    action: 'call' | 'serve' | 'done' | 'recall' | 'noshow' | 'buzz' | 'reset',
    ticket: Ticket
  ) {
    if (action === 'call') {
      if (!deskId) {
        addToast(`Assign a ${t.desk.toLowerCase()} before calling a visit.`, 'error');
        return;
      }
      void runTask(
        'call',
        ticket.id,
        () => callSpecificTicket(ticket.id, deskId, staffId),
        `${ticket.ticket_number} called.`,
        () => {
          setLivePulse(ticket.id, {
            label: 'Call sent',
            at: new Date().toISOString(),
            tone: 'success',
          });
          const calledAt = new Date().toISOString();
          updateTicketLocally(ticket.id, (current) => ({
            ...current,
            status: 'called',
            desk_id: deskId,
            called_by_staff_id: staffId,
            called_at: calledAt,
          }));
        }
      );
      return;
    }
    if (action === 'serve') {
      void runTask(
        'serve',
        ticket.id,
        () => startServing(ticket.id, staffId),
        'Visit moved into service.',
        () => {
          setLivePulse(ticket.id, {
            label: 'Service started',
            at: new Date().toISOString(),
            tone: 'success',
          });
          const servingStartedAt = new Date().toISOString();
          updateTicketLocally(ticket.id, (current) => ({
            ...current,
            status: 'serving',
            serving_started_at: servingStartedAt,
          }));
        }
      );
      return;
    }
    if (action === 'done') {
      void runTask(
        'done',
        ticket.id,
        () => markServed(ticket.id, staffId),
        'Visit completed.',
        () => {
          setLivePulse(ticket.id, {
            label: 'Visit completed',
            at: new Date().toISOString(),
            tone: 'success',
          });
          const completedAt = new Date().toISOString();
          updateTicketLocally(ticket.id, (current) => ({
            ...current,
            status: 'served',
            completed_at: completedAt,
          }));
        }
      );
      return;
    }
    if (action === 'recall') {
      void runTask(
        'recall',
        ticket.id,
        () => recallTicket(ticket.id),
        'Recall sent.',
        () => {
          const recalledAt = new Date().toISOString();
          setLivePulse(ticket.id, {
            label: `Recall #${(ticket.recall_count ?? 0) + 1} sent`,
            at: recalledAt,
            tone: 'attention',
          });
          updateTicketLocally(ticket.id, (current) => ({
            ...current,
            called_at: recalledAt,
            recall_count: (current.recall_count ?? 0) + 1,
          }));
        }
      );
      return;
    }
    if (action === 'noshow') {
      void runTask(
        'noshow',
        ticket.id,
        () => markNoShow(ticket.id, staffId),
        'Visit marked as no-show.',
        () => {
          setLivePulse(ticket.id, {
            label: 'Marked no-show',
            at: new Date().toISOString(),
            tone: 'attention',
          });
          const completedAt = new Date().toISOString();
          updateTicketLocally(ticket.id, (current) => ({
            ...current,
            status: 'no_show',
            completed_at: completedAt,
          }));
        }
      );
      return;
    }
    if (action === 'buzz') {
      void runTask(
        'buzz',
        ticket.id,
        () => buzzTicket(ticket.id),
        'Buzz sent.',
        () => {
          setLivePulse(ticket.id, {
            label: 'Buzz sent',
            at: new Date().toISOString(),
            tone: 'attention',
          });
        }
      );
      return;
    }
    void runTask(
      'reset',
      ticket.id,
      () => resetTicketToQueue(ticket.id),
      'Visit reset to the queue.',
      () => {
        setLivePulse(ticket.id, {
          label: 'Reset to queue',
          at: new Date().toISOString(),
          tone: 'neutral',
        });
        updateTicketLocally(ticket.id, (current) => ({
          ...current,
          status: 'waiting',
          desk_id: null,
          called_at: null,
          serving_started_at: null,
        }));
      }
    );
  }

  function handleCallNext() {
    if (!deskId) {
      addToast(`Assign a ${t.desk.toLowerCase()} before calling the next visit.`, 'error');
      return;
    }
    const nextTicket = backlogTickets[0];
    if (!nextTicket) return;
    void runTask(
      'call',
      nextTicket.id,
      () => callNextTicket(deskId, staffId),
      'Next visit called.',
      () => {
        const calledAt = new Date().toISOString();
        setLivePulse(nextTicket.id, {
          label: 'Call sent',
          at: calledAt,
          tone: 'success',
        });
        updateTicketLocally(nextTicket.id, (current) => ({
          ...current,
          status: 'called',
          desk_id: deskId,
          called_by_staff_id: staffId,
          called_at: calledAt,
        }));
      }
    );
  }

  function handleAssignDesk(nextDeskId: string) {
    const key = `desk:${nextDeskId}`;
    setPendingActions((current) => ({ ...current, [key]: true }));
    const previousDeskId = deskId;
    const previousDeskLabel = deskDisplayName;
    const desk = availableDesks.find((item) => item.id === nextDeskId) || null;
    setDeskId(nextDeskId);
    setDeskDisplayName(desk?.display_name || desk?.name || null);
    setDeskSelectOpen(false);

    void assignDesk(nextDeskId, staffId)
      .then((result) => {
        if (result && 'error' in result && result.error) {
          throw new Error(result.error);
        }
        addToast(`${t.desk} assigned.`);
        refreshViews();
      })
      .catch((error) => {
        setDeskId(previousDeskId);
        setDeskDisplayName(previousDeskLabel);
        addToast(error instanceof Error ? error.message : 'Failed to assign desk.', 'error');
      })
      .finally(() => {
        setPendingActions((current) => {
          const { [key]: _ignored, ...rest } = current;
          return rest;
        });
      });
  }

  function handleUnassignDesk() {
    if (!deskId) return;
    const actionKey = `desk:${deskId}`;
    setPendingActions((current) => ({ ...current, [actionKey]: true }));
    const previousDeskId = deskId;
    const previousDeskLabel = deskDisplayName;
    setDeskId(null);
    setDeskDisplayName(null);

    void unassignDesk(deskId)
      .then((result) => {
        if (result && 'error' in result && result.error) {
          throw new Error(result.error);
        }
        addToast(`${t.desk} released.`);
        refreshViews();
      })
      .catch((error) => {
        setDeskId(previousDeskId);
        setDeskDisplayName(previousDeskLabel);
        addToast(error instanceof Error ? error.message : 'Failed to release desk.', 'error');
      })
      .finally(() => {
        setPendingActions((current) => {
          const { [actionKey]: _ignored, ...rest } = current;
          return rest;
        });
      });
  }

  function executeConfirm() {
    if (!confirmAction) return;
    const currentAction = confirmAction;
    setConfirmAction(null);

    if (currentAction.type === 'cancel') {
      void runTask(
        'cancel',
        currentAction.id,
        () => cancelVisit(currentAction.id),
        'Visit cancelled.',
        () => {
          setLivePulse(currentAction.id, {
            label: 'Visit cancelled',
            at: new Date().toISOString(),
            tone: 'attention',
          });
          const completedAt = new Date().toISOString();
          updateTicketLocally(currentAction.id, (ticket) => ({
            ...ticket,
            status: 'cancelled',
            completed_at: completedAt,
          }));
        }
      );
      return;
    }

    void runTask(
      'delete',
      currentAction.id,
      () => deleteVisit(currentAction.id),
      'Record deleted.',
      () => {
        setActionPulseByTicket((current) => {
          const { [currentAction.id]: _ignored, ...rest } = current;
          return rest;
        });
        updateTicketLocally(currentAction.id, () => null);
      }
    );
  }

  function handleTransfer() {
    if (!transferDialogId || !transferDeptId || !transferServiceId) return;
    const ticketId = transferDialogId;
    setTransferDialogId(null);
    setTransferDeptId('');
    setTransferServiceId('');
    void runTask(
      'transfer',
      ticketId,
      () => transferTicket(ticketId, transferDeptId, transferServiceId),
      'Visit transferred.',
      () => {
        setLivePulse(ticketId, {
          label: 'Transferred',
          at: new Date().toISOString(),
          tone: 'success',
        });
        const completedAt = new Date().toISOString();
        updateTicketLocally(ticketId, (ticket) => ({
          ...ticket,
          status: 'transferred',
          completed_at: completedAt,
        }));
      }
    );
  }

  function updateFilters(key: string, value: string) {
    const next = { ...filters, [key]: value };
    const params = new URLSearchParams();
    if (next.office) params.set('office', next.office);
    if (next.status && next.status !== 'all') params.set('status', next.status);
    if (next.date) params.set('date', next.date);
    router.push(`/admin/queue${params.toString() ? `?${params.toString()}` : ''}`);
  }

  function goToPage(page: number) {
    const params = new URLSearchParams();
    if (filters.office) params.set('office', filters.office);
    if (filters.status && filters.status !== 'all') params.set('status', filters.status);
    if (filters.date) params.set('date', filters.date);
    if (page > 1) params.set('page', String(page));
    router.push(`/admin/queue${params.toString() ? `?${params.toString()}` : ''}`);
  }

  const totalPages = Math.ceil(totalCount / pageSize);
  const nextTicket = backlogTickets[0] || null;
  const activeDeskActionPending = Boolean(deskId && pendingActions[`desk:${deskId}`]);
  const boardCount = backlogTickets.length + calledTickets.length + servingTickets.length;

  function openDeskPickerForTicket(ticket: Ticket) {
    setSelectedId(ticket.id);
    if (availableDesks.length === 1) {
      handleAssignDesk(availableDesks[0].id);
      return;
    }
    setDeskSelectOpen(true);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-[#dbe7ff] bg-white p-5 shadow-[0_18px_40px_rgba(44,85,160,0.08)] md:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#eef4ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5470a8]">
                  Live board
                </span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  {staffName}
                </span>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                  {deskId ? deskDisplayName || t.desk : `No ${t.desk.toLowerCase()} assigned`}
                </span>
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                Waiting tickets first, then called and in service.
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {deskId
                  ? nextTicket
                    ? `${getCustomerName(nextTicket)} is next to call.`
                    : `Your ${t.desk.toLowerCase()} is ready.`
                  : `Assign a ${t.desk.toLowerCase()} from any waiting card or from the control bar.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCallNext}
                disabled={isRefreshing || !deskId || intakeCount === 0 || (nextTicket ? isActionPending(nextTicket.id, 'call') : false)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#2f6fed] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#255fce] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <PhoneCall className="h-4 w-4" />
                Call next
              </button>

              <div className="relative">
                {deskId ? (
                  <button
                    type="button"
                    onClick={handleUnassignDesk}
                    disabled={activeDeskActionPending}
                    className="rounded-full border border-[#bfd0f8] bg-white px-4 py-3 text-sm font-semibold text-[#33539b] transition hover:border-[#8faef1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Release {t.desk}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeskSelectOpen((open) => !open)}
                    className="rounded-full border border-[#bfd0f8] bg-white px-4 py-3 text-sm font-semibold text-[#33539b] transition hover:border-[#8faef1]"
                  >
                    Assign {t.desk}
                  </button>
                )}

                {deskSelectOpen ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-[22px] border border-[#d7e4ff] bg-white p-2 shadow-[0_18px_32px_rgba(44,85,160,0.14)]">
                    {availableDesks.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No available {t.deskPlural.toLowerCase()}.</p>
                    ) : (
                      availableDesks.map((desk) => (
                        <button
                          key={desk.id}
                          type="button"
                          onClick={() => handleAssignDesk(desk.id)}
                          className="w-full rounded-[18px] px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-[#f5f8ff]"
                        >
                          {desk.display_name || desk.name}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <CompactStat label="Waiting" value={intakeCount} tone="blue" />
            <CompactStat label="Called" value={calledCount} tone="indigo" />
            <CompactStat label="Serving" value={servingCount} tone="emerald" />
            <CompactStat label="Live board" value={boardCount} tone="slate" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-[#dbe7ff] bg-[#f5f8ff] p-1">
              <button type="button" onClick={() => setViewMode('board')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === 'board' ? 'bg-[#2f6fed] text-white shadow-[0_8px_16px_rgba(47,111,237,0.25)]' : 'text-slate-500 hover:text-slate-900'}`}>Live board</button>
              <button type="button" onClick={() => setViewMode('history')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === 'history' ? 'bg-[#2f6fed] text-white shadow-[0_8px_16px_rgba(47,111,237,0.25)]' : 'text-slate-500 hover:text-slate-900'}`}>Visit records</button>
            </div>

            <div className="relative min-w-[240px] flex-1 xl:min-w-[300px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${t.customerPlural.toLowerCase()}, services, or ticket numbers`}
                className="w-full rounded-full border border-[#dbe7ff] bg-[#f8fbff] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#2f6fed] focus:ring-2 focus:ring-[#2f6fed]/10"
              />
            </div>
          </div>

          {viewMode === 'history' ? (
            <button type="button" onClick={() => setShowFilters((open) => !open)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${showFilters ? 'border-[#2f6fed] bg-[#2f6fed] text-white' : 'border-[#bfd0f8] bg-white text-[#33539b] hover:border-[#8faef1]'}`}>
              <Filter className="h-4 w-4" />
              Filters
            </button>
          ) : null}
        </div>

        {viewMode === 'history' && showFilters ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[24px] border border-[#dbe7ff] bg-[#f8fbff] p-3">
            <select value={filters.office} onChange={(event) => updateFilters('office', event.target.value)} className="rounded-full border border-[#dbe7ff] bg-white px-4 py-2 text-sm text-slate-700 outline-none">
              <option value="">All {t.officePlural}</option>
              {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
            </select>
            <select value={filters.status} onChange={(event) => updateFilters('status', event.target.value)} className="rounded-full border border-[#dbe7ff] bg-white px-4 py-2 text-sm text-slate-700 outline-none">
              <option value="all">All statuses</option>
              <option value="issued">Issued</option>
              <option value="waiting">Waiting</option>
              <option value="called">Called</option>
              <option value="serving">Serving</option>
              <option value="served">Completed</option>
              <option value="no_show">No show</option>
              <option value="cancelled">Cancelled</option>
              <option value="transferred">Transferred</option>
            </select>
            <input type="date" value={filters.date} onChange={(event) => updateFilters('date', event.target.value)} className="rounded-full border border-[#dbe7ff] bg-white px-4 py-2 text-sm text-slate-700 outline-none" />
            {(filters.office || filters.status !== 'all' || filters.date) ? (
              <button type="button" onClick={() => router.push('/admin/queue')} className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-medium text-slate-500 transition hover:bg-white hover:text-slate-900">
                <X className="h-4 w-4" />
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        {viewMode === 'board' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.85fr]">
            <div className="grid gap-4 xl:grid-cols-1 2xl:grid-cols-3">
              <StageColumn title="Waiting to call" subtitle="These are the live tickets that still need the next operator move." tickets={backlogTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} getActionLoading={isActionPending} getLivePulse={getLivePulse} onAssignDesk={openDeskPickerForTicket} />
              <StageColumn title="Called" subtitle="Called tickets waiting to arrive, be recalled, or be marked no-show." tickets={calledTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} getActionLoading={isActionPending} getLivePulse={getLivePulse} onAssignDesk={openDeskPickerForTicket} />
              <StageColumn title="In service" subtitle="Tickets currently being handled by staff." tickets={servingTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} getActionLoading={isActionPending} getLivePulse={getLivePulse} onAssignDesk={openDeskPickerForTicket} />
            </div>

            <FocusPanel ticket={selectedTicket} terminology={t} deskId={deskId} onAction={handleAction} onConfirm={setConfirmAction} onTransfer={(ticket) => { setTransferDialogId(ticket.id); setTransferDeptId(''); setTransferServiceId(''); }} getActionLoading={isActionPending} livePulse={selectedTicket ? getLivePulse(selectedTicket.id) : null} />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[30px] border border-[#dbe7ff] bg-[#f8fbff] p-4 shadow-[0_12px_24px_rgba(44,85,160,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Visit records</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {historyTickets.length === 0 ? 'No matching visits or reservations.' : `${historyTickets.length} matching visits or reservations`}
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {historyTickets.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-400">No visits found.</div>
                ) : (
                  historyTickets.map((ticket) => {
                    const meta = getStatusMeta(ticket.status);
                    const selected = selectedId === ticket.id;
                    return (
                      <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${selected ? 'border-[#2f6fed] bg-[#2f6fed] text-white shadow-[0_14px_26px_rgba(47,111,237,0.24)]' : 'border-[#dbe7ff] bg-white hover:shadow-[0_12px_24px_rgba(44,85,160,0.08)]'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? 'bg-white/10 text-white' : meta.badge}`}>{ticket.ticket_number}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? 'bg-white/10 text-white' : meta.badge}`}>{meta.label}</span>
                            </div>
                            <p className={`mt-3 text-base font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>{getCustomerName(ticket)}</p>
                            <p className={`mt-1 text-sm ${selected ? 'text-white/72' : 'text-slate-500'}`}>{ticket.service?.name || 'General service'}{ticket.department?.name ? ` · ${ticket.department.name}` : ''}</p>
                          </div>
                          <div className={`text-right text-sm ${selected ? 'text-white/78' : 'text-slate-500'}`}>
                            <p>{formatClock(ticket.completed_at || ticket.created_at)}</p>
                            <p className="mt-1">{ticket.office?.name || '--'}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {totalPages > 1 ? (
                <div className="mt-5 flex items-center justify-between">
                  <p className="text-sm text-slate-500">{(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="rounded-full border border-slate-300 p-2 text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="rounded-full border border-slate-300 p-2 text-slate-700 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </div>
              ) : null}
            </div>

            <FocusPanel ticket={selectedTicket} terminology={t} deskId={deskId} onAction={handleAction} onConfirm={setConfirmAction} onTransfer={(ticket) => { setTransferDialogId(ticket.id); setTransferDeptId(''); setTransferServiceId(''); }} getActionLoading={isActionPending} livePulse={selectedTicket ? getLivePulse(selectedTicket.id) : null} />
          </div>
        )}

        {queueLoading && viewMode === 'board' ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#f5f8ff] px-4 py-2 text-sm text-[#5470a8]">
            <Hourglass className="h-4 w-4" />
            Syncing live queue...
          </div>
        ) : null}
      </section>

      {transferDialogId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={() => setTransferDialogId(null)}>
          <div className="w-full max-w-md rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(20,27,26,0.12)]" onClick={(event) => event.stopPropagation()}>
            <h3 className="text-xl font-semibold text-slate-950">Transfer {t.customer.toLowerCase()}</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">Move this visit into a different {t.department.toLowerCase()} or service while keeping the customer journey intact.</p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">{t.department}</label>
                <select value={transferDeptId} onChange={(event) => { setTransferDeptId(event.target.value); setTransferServiceId(''); }} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#2f6fed]">
                  <option value="">Select {t.department.toLowerCase()}</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Service</label>
                <select value={transferServiceId} onChange={(event) => setTransferServiceId(event.target.value)} disabled={!transferDeptId} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#2f6fed] disabled:cursor-not-allowed disabled:opacity-50">
                  <option value="">Select service</option>
                  {filteredServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </select>
              </div>
            </div>

            {transferTicketRecord ? (
              <div className="mt-5 rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-600">
                Moving <span className="font-semibold text-slate-900">{transferTicketRecord.ticket_number}</span> for <span className="font-semibold text-slate-900">{getCustomerName(transferTicketRecord)}</span>.
              </div>
            ) : null}

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setTransferDialogId(null)} className="flex-1 rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">Cancel</button>
              <button type="button" onClick={handleTransfer} disabled={!transferDeptId || !transferServiceId || (transferDialogId ? isActionPending(transferDialogId, 'transfer') : false)} className="flex-1 rounded-full bg-[#2f6fed] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#255fce] disabled:cursor-not-allowed disabled:bg-slate-300">Transfer</button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={() => setConfirmAction(null)}>
          <div className="w-full max-w-sm rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(20,27,26,0.12)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff2e3] text-amber-700">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-950">{confirmAction.type === 'cancel' ? 'Cancel this visit?' : 'Delete this record?'}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{confirmAction.type === 'cancel' ? 'The visit will be marked cancelled and removed from active flow.' : 'This removes the visit from history after completion.'}</p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setConfirmAction(null)} className="flex-1 rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">Back</button>
              <button type="button" onClick={executeConfirm} disabled={isActionPending(confirmAction.id, confirmAction.type)} className="flex-1 rounded-full bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300">{confirmAction.type === 'cancel' ? 'Cancel visit' : 'Delete record'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

function CompactStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'blue' | 'indigo' | 'emerald' | 'slate';
}) {
  const toneClass = {
    blue: 'border-[#d7e4ff] bg-white',
    indigo: 'border-[#ddd9ff] bg-[#fbfaff]',
    emerald: 'border-[#d8efe6] bg-[#f9fdfb]',
    slate: 'border-slate-200 bg-[#fbfcfe]',
  }[tone];

  return (
    <div className={`rounded-[24px] border px-4 py-3 ${toneClass}`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className="mt-2 block text-xl font-semibold text-slate-950">{value}</span>
    </div>
  );
}

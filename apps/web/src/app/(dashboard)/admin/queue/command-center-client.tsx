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
  MetricCard,
  QueueClientProps,
  Ticket,
  Toast,
  ToastContainer,
  ViewMode,
  formatClock,
  formatDuration,
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
  Workflow,
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
  const [isPending, startTransition] = useTransition();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [transferDialogId, setTransferDialogId] = useState<string | null>(null);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [deskId, setDeskId] = useState<string | null>(assignedDesk?.id || null);
  const [deskDisplayName, setDeskDisplayName] = useState<string | null>(assignedDesk?.display_name || assignedDesk?.name || null);
  const [deskSelectOpen, setDeskSelectOpen] = useState(false);

  const { queue, isLoading: queueLoading } = useRealtimeQueue({ officeId: primaryOfficeId });

  function addToast(message: string, type: Toast['type'] = 'success') {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }

  const backlogTickets = [...queue.issued, ...queue.waiting].filter((ticket) => matchesSearch(ticket, search));
  const calledTickets = queue.called.filter((ticket) => matchesSearch(ticket, search));
  const servingTickets = queue.serving.filter((ticket) => matchesSearch(ticket, search));
  const recentTickets = sortRecentTickets([
    ...queue.recentlyServed,
    ...queue.cancelled,
    ...queue.noShows,
    ...queue.transferred,
  ]).filter((ticket) => matchesSearch(ticket, search));
  const historyTickets = initialTickets.filter((ticket) => matchesSearch(ticket, search));
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

  const transferTicketRecord = boardTickets.find((ticket) => ticket.id === transferDialogId) || null;
  const filteredServices = transferDeptId
    ? services.filter((service) => service.department_id === transferDeptId)
    : services;
  const intakeCount = queue.issued.length + queue.waiting.length;
  const longestWaitSeconds = backlogTickets.reduce((max, ticket) => {
    if (!ticket.created_at) return max;
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 1000));
    return Math.max(max, elapsed);
  }, 0);

  async function runTask(
    work: () => Promise<{ error?: string | null } | void>,
    successMessage: string
  ) {
    startTransition(async () => {
      try {
        const result = await work();
        if (result && 'error' in result && result.error) {
          addToast(result.error, 'error');
          return;
        }
        addToast(successMessage);
        router.refresh();
      } catch (error) {
        addToast(error instanceof Error ? error.message : 'Something went wrong.', 'error');
      }
    });
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
      runTask(() => callSpecificTicket(ticket.id, deskId, staffId), `${ticket.ticket_number} called.`);
      return;
    }
    if (action === 'serve') {
      runTask(() => startServing(ticket.id, staffId), 'Visit moved into service.');
      return;
    }
    if (action === 'done') {
      runTask(() => markServed(ticket.id, staffId), 'Visit completed.');
      return;
    }
    if (action === 'recall') {
      runTask(() => recallTicket(ticket.id), 'Recall sent.');
      return;
    }
    if (action === 'noshow') {
      runTask(() => markNoShow(ticket.id, staffId), 'Visit marked as no-show.');
      return;
    }
    if (action === 'buzz') {
      runTask(() => buzzTicket(ticket.id), 'Buzz sent.');
      return;
    }
    runTask(() => resetTicketToQueue(ticket.id), 'Visit reset to the queue.');
  }

  function handleCallNext() {
    if (!deskId) {
      addToast(`Assign a ${t.desk.toLowerCase()} before calling the next visit.`, 'error');
      return;
    }
    runTask(() => callNextTicket(deskId, staffId), 'Next visit called.');
  }

  function handleAssignDesk(nextDeskId: string) {
    runTask(async () => {
      const result = await assignDesk(nextDeskId, staffId);
      if (result && 'error' in result && result.error) return result;
      const desk = availableDesks.find((item) => item.id === nextDeskId) || null;
      setDeskId(nextDeskId);
      setDeskDisplayName(desk?.display_name || desk?.name || null);
      setDeskSelectOpen(false);
      return result;
    }, `${t.desk} assigned.`);
  }

  function handleUnassignDesk() {
    if (!deskId) return;
    runTask(async () => {
      const result = await unassignDesk(deskId);
      if (result && 'error' in result && result.error) return result;
      setDeskId(null);
      setDeskDisplayName(null);
      return result;
    }, `${t.desk} released.`);
  }

  function executeConfirm() {
    if (!confirmAction) return;
    runTask(async () => {
      if (confirmAction.type === 'cancel') {
        await cancelVisit(confirmAction.id);
      } else {
        await deleteVisit(confirmAction.id);
      }
      setConfirmAction(null);
    }, confirmAction.type === 'cancel' ? 'Visit cancelled.' : 'Record deleted.');
  }

  function handleTransfer() {
    if (!transferDialogId || !transferDeptId || !transferServiceId) return;
    runTask(async () => {
      const result = await transferTicket(transferDialogId, transferDeptId, transferServiceId);
      if (result && 'error' in result && result.error) return result;
      setTransferDialogId(null);
      setTransferDeptId('');
      setTransferServiceId('');
      return result;
    }, 'Visit transferred.');
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

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Operations system</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Command center built around live handoff, not just a queue list.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              Assign your {t.desk.toLowerCase()}, select the exact {t.customer.toLowerCase()} you need, and run call, service,
              recall, cancel, and transfer from one operational surface.
            </p>
          </div>

          <div className="rounded-[28px] border border-[#d9ebe7] bg-[#f0f6f5] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#446068]">Operator dock</p>
                <p className="mt-2 text-lg font-semibold text-[#10292f]">{staffName}</p>
                <p className="mt-1 text-sm text-[#4b666d]">
                  {deskId ? `Active on ${deskDisplayName || t.desk}` : `No ${t.desk.toLowerCase()} assigned yet`}
                </p>
              </div>
              <div className="relative">
                {deskId ? (
                  <button type="button" onClick={handleUnassignDesk} disabled={isPending} className="rounded-full border border-[#b2d8d0] bg-white px-4 py-2 text-sm font-semibold text-[#10292f] transition hover:border-[#8cc7bc]">
                    Release
                  </button>
                ) : (
                  <button type="button" onClick={() => setDeskSelectOpen((open) => !open)} className="rounded-full bg-[#10292f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#18383f]">
                    Assign {t.desk}
                  </button>
                )}

                {deskSelectOpen ? (
                  <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_18px_32px_rgba(20,27,26,0.12)]">
                    {availableDesks.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-slate-500">No available {t.deskPlural.toLowerCase()}.</p>
                    ) : (
                      availableDesks.map((desk) => (
                        <button
                          key={desk.id}
                          type="button"
                          onClick={() => handleAssignDesk(desk.id)}
                          className="w-full rounded-[18px] px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                        >
                          {desk.display_name || desk.name}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleCallNext}
                disabled={isPending || !deskId || intakeCount === 0}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <PhoneCall className="h-4 w-4" />
                Call next
              </button>
              <div className="rounded-[20px] border border-white/70 bg-white px-4 py-3 text-sm text-slate-600">
                {intakeCount === 0 ? 'No backlog right now.' : `${intakeCount} visits waiting across intake.`}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Intake backlog" value={intakeCount.toString()} helper="Issued and waiting visits" />
        <MetricCard label="Called out" value={queue.called.length.toString()} helper="Need arrival or recall" />
        <MetricCard label="In service" value={queue.serving.length.toString()} helper="Currently with staff" />
        <MetricCard label="Longest wait" value={formatDuration(longestWaitSeconds)} helper="Across the live backlog" />
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-[#fbfaf8] p-1">
              <button type="button" onClick={() => setViewMode('board')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === 'board' ? 'bg-[#10292f] text-white' : 'text-slate-500 hover:text-slate-900'}`}>Live board</button>
              <button type="button" onClick={() => setViewMode('history')} className={`rounded-full px-4 py-2 text-sm font-semibold transition ${viewMode === 'history' ? 'bg-[#10292f] text-white' : 'text-slate-500 hover:text-slate-900'}`}>History</button>
            </div>

            <div className="relative min-w-[240px] flex-1 xl:min-w-[300px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${t.customerPlural.toLowerCase()}, services, or ticket numbers`}
                className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10"
              />
            </div>
          </div>

          {viewMode === 'history' ? (
            <button type="button" onClick={() => setShowFilters((open) => !open)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${showFilters ? 'border-[#10292f] bg-[#10292f] text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}>
              <Filter className="h-4 w-4" />
              Filters
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2 text-sm text-slate-600">
              <Workflow className="h-4 w-4 text-slate-400" />
              Category-aware labels adapt automatically to this workspace.
            </div>
          )}
        </div>

        {viewMode === 'history' && showFilters ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-3">
            <select value={filters.office} onChange={(event) => updateFilters('office', event.target.value)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none">
              <option value="">All {t.officePlural}</option>
              {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
            </select>
            <select value={filters.status} onChange={(event) => updateFilters('status', event.target.value)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none">
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
            <input type="date" value={filters.date} onChange={(event) => updateFilters('date', event.target.value)} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 outline-none" />
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
            <div className="grid gap-4 2xl:grid-cols-2">
              <StageColumn title="Intake queue" subtitle="Issued and waiting visits ready for the next operator move." tickets={backlogTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} />
              <StageColumn title="Called" subtitle="Customers who need to arrive, respond, or be recalled." tickets={calledTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} />
              <StageColumn title="Serving now" subtitle="Live service sessions and active handoffs." tickets={servingTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} />
              <StageColumn title="Recently resolved" subtitle="Completed, cancelled, no-show, and transferred visits." tickets={recentTickets} terminology={t} selectedId={selectedId} deskId={deskId} onSelect={setSelectedId} onPrimaryAction={handlePrimaryAction} />
            </div>

            <FocusPanel ticket={selectedTicket} terminology={t} deskId={deskId} onAction={handleAction} onConfirm={setConfirmAction} onTransfer={(ticket) => { setTransferDialogId(ticket.id); setTransferDeptId(''); setTransferServiceId(''); }} />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[30px] border border-slate-200 bg-[#fbfaf8] p-4 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Visit history</h2>
                  <p className="mt-1 text-sm text-slate-500">{historyTickets.length === 0 ? 'No matching visits.' : `${historyTickets.length} matching visits`}</p>
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
                      <button key={ticket.id} type="button" onClick={() => setSelectedId(ticket.id)} className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${selected ? 'border-[#10292f] bg-[#10292f] text-white' : `border-slate-200 bg-white hover:shadow-[0_12px_24px_rgba(20,27,26,0.06)]`}`}>
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

            <FocusPanel ticket={selectedTicket} terminology={t} deskId={deskId} onAction={handleAction} onConfirm={setConfirmAction} onTransfer={(ticket) => { setTransferDialogId(ticket.id); setTransferDeptId(''); setTransferServiceId(''); }} />
          </div>
        )}

        {queueLoading && viewMode === 'board' ? (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#f6f7f4] px-4 py-2 text-sm text-slate-500">
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
                <select value={transferDeptId} onChange={(event) => { setTransferDeptId(event.target.value); setTransferServiceId(''); }} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]">
                  <option value="">Select {t.department.toLowerCase()}</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Service</label>
                <select value={transferServiceId} onChange={(event) => setTransferServiceId(event.target.value)} disabled={!transferDeptId} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f] disabled:cursor-not-allowed disabled:opacity-50">
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
              <button type="button" onClick={handleTransfer} disabled={isPending || !transferDeptId || !transferServiceId} className="flex-1 rounded-full bg-[#10292f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:bg-slate-300">Transfer</button>
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
              <button type="button" onClick={executeConfirm} disabled={isPending} className="flex-1 rounded-full bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300">{confirmAction.type === 'cancel' ? 'Cancel visit' : 'Delete record'}</button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

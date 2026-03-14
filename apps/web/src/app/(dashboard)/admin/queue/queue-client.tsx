'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTerminology } from '@/lib/terminology-context';
import { useRealtimeQueue } from '@/lib/hooks/use-realtime-queue';
import {
  callNextTicket,
  startServing,
  markServed,
  markNoShow,
  recallTicket,
  buzzTicket,
  resetTicketToQueue,
  transferTicket,
  assignDesk,
  unassignDesk,
} from '@/lib/actions/ticket-actions';
import { cancelVisit, deleteVisit } from './actions';
import {
  Clock,
  QrCode,
  Monitor,
  ExternalLink,
  XCircle,
  Trash2,
  User,
  Phone,
  Mail,
  AlertTriangle,
  Filter,
  X,
  ChevronLeft,
  ChevronRight,
  Zap,
  PhoneCall,
  CheckCircle2,
  UserX,
  ArrowRightLeft,
  Timer,
  Hourglass,
  Circle,
  Megaphone,
  RotateCcw,
  Bell,
  Play,
  ChevronDown,
  MonitorSmartphone,
} from 'lucide-react';

// ─── Types ───

interface Ticket {
  id: string;
  ticket_number: string;
  status: string;
  created_at: string | null;
  called_at: string | null;
  serving_started_at: string | null;
  completed_at: string | null;
  is_remote: boolean | null;
  customer_data: { name?: string; phone?: string; email?: string } | null;
  estimated_wait_minutes: number | null;
  qr_token: string | null;
  recall_count: number | null;
  priority: number | null;
  desk_id: string | null;
  office_id: string | null;
  department_id: string | null;
  service_id: string | null;
  service: { name: string } | null;
  department: { name: string } | null;
  office: { name: string } | null;
  desk: { name: string } | null;
}

interface Desk {
  id: string;
  name: string;
  display_name: string | null;
  department_id: string | null;
  office_id: string;
}

interface Office { id: string; name: string }
interface Department { id: string; name: string }
interface Service { id: string; name: string; department_id: string | null }

type TabKey = 'queue' | 'history';

// ─── Status config ───

const statusMeta: Record<string, {
  label: string; bg: string; text: string; ring: string; icon: typeof Clock; dot: string;
}> = {
  waiting: { label: 'Waiting', bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200', icon: Hourglass, dot: 'bg-amber-400' },
  issued: { label: 'Issued', bg: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-200', icon: Circle, dot: 'bg-sky-400' },
  called: { label: 'Called', bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-200', icon: PhoneCall, dot: 'bg-indigo-500' },
  serving: { label: 'Serving', bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200', icon: Zap, dot: 'bg-emerald-500' },
  served: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-600', ring: 'ring-green-200', icon: CheckCircle2, dot: 'bg-green-500' },
  completed: { label: 'Completed', bg: 'bg-green-50', text: 'text-green-600', ring: 'ring-green-200', icon: CheckCircle2, dot: 'bg-green-500' },
  no_show: { label: 'No Show', bg: 'bg-red-50', text: 'text-red-600', ring: 'ring-red-200', icon: UserX, dot: 'bg-red-500' },
  cancelled: { label: 'Cancelled', bg: 'bg-gray-50', text: 'text-gray-500', ring: 'ring-gray-200', icon: XCircle, dot: 'bg-gray-400' },
  transferred: { label: 'Transferred', bg: 'bg-purple-50', text: 'text-purple-600', ring: 'ring-purple-200', icon: ArrowRightLeft, dot: 'bg-purple-500' },
};

const activeStatuses = ['waiting', 'issued', 'called', 'serving'];
const terminalStatuses = ['served', 'completed', 'no_show', 'cancelled', 'transferred'];

// ─── Hooks ───

function useElapsed(since: string | null, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!since || !active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since, active]);
  if (!since) return null;
  return Math.max(0, Math.floor(((active ? now : Date.now()) - new Date(since).getTime()) / 1000));
}

function formatSec(sec: number | null): string {
  if (sec === null) return '--';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${(m % 60).toString().padStart(2, '0')}m`;
}

function formatDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr || !endStr) return '--';
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '<1 min';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

// ─── Toast system ───

interface Toast { id: number; message: string; type: 'success' | 'error' | 'info' }

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg animate-in slide-in-from-right ${
            t.type === 'success' ? 'bg-emerald-600 text-white' :
            t.type === 'error' ? 'bg-red-600 text-white' :
            'bg-foreground text-background'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ─── Ticket Card ───

function TicketCard({
  ticket,
  terminology: t,
  deskId,
  staffId,
  isMyTicket,
  onAction,
  onCancel,
  onDelete,
  onTransfer,
}: {
  ticket: Ticket;
  terminology: ReturnType<typeof useTerminology>;
  deskId: string | null;
  staffId: string;
  isMyTicket: boolean;
  onAction: (action: string, ticketId: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onTransfer: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = statusMeta[ticket.status] || statusMeta.waiting;
  const StatusIcon = meta.icon;
  const isActive = activeStatuses.includes(ticket.status);
  const isTerminal = terminalStatuses.includes(ticket.status);
  const customerName = (ticket.customer_data as any)?.name || 'Walk-in';
  const customerPhone = (ticket.customer_data as any)?.phone;
  const customerEmail = (ticket.customer_data as any)?.email;

  const timerSince = ticket.status === 'serving'
    ? ticket.serving_started_at
    : ticket.status === 'called'
      ? ticket.called_at
      : ticket.created_at;
  const elapsed = useElapsed(timerSince, isActive);

  const isCalled = ticket.status === 'called';
  const isServing = ticket.status === 'serving';
  const isWaiting = ticket.status === 'waiting' || ticket.status === 'issued';

  return (
    <div className={`rounded-2xl border transition-all duration-200 ${
      isServing
        ? 'bg-emerald-50 border-emerald-200 ring-1 ring-emerald-200 shadow-md'
        : isCalled
          ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200 shadow-sm animate-pulse-subtle'
          : isActive
            ? `${meta.bg} border-transparent ring-1 ${meta.ring} shadow-sm`
            : 'bg-card border-border hover:shadow-sm'
    }`}>
      {/* Main row */}
      <div className="px-4 py-3.5 flex items-center gap-3">
        {/* Ticket number */}
        <button
          onClick={() => setExpanded(!expanded)}
          className={`shrink-0 rounded-xl px-2.5 py-1.5 font-mono text-xs font-bold transition-colors ${
            isActive ? `${meta.bg} ${meta.text}` : 'bg-muted text-muted-foreground'
          }`}
        >
          {ticket.ticket_number}
        </button>

        {/* Customer + service — clickable to expand */}
        <button onClick={() => setExpanded(!expanded)} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground truncate">{customerName}</span>
            {ticket.is_remote && <QrCode className="h-3 w-3 text-muted-foreground shrink-0" />}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {ticket.service?.name || 'General'}
            {ticket.department?.name ? ` · ${ticket.department.name}` : ''}
          </div>
        </button>

        {/* Live timer */}
        {isActive && elapsed !== null && (
          <div className="shrink-0 text-right mr-1">
            <div className={`font-mono text-sm font-semibold tabular-nums ${meta.text}`}>
              {formatSec(elapsed)}
            </div>
          </div>
        )}

        {/* Status capsule */}
        <div className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}>
          {isActive && (
            <span className="relative flex h-1.5 w-1.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${meta.dot} opacity-75`} />
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${meta.dot}`} />
            </span>
          )}
          <StatusIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{meta.label}</span>
        </div>

        {/* ── Action buttons inline ── */}
        {deskId && isWaiting && (
          <button
            onClick={() => onAction('call', ticket.id)}
            className="shrink-0 rounded-xl bg-foreground text-background px-3.5 py-1.5 text-xs font-semibold hover:bg-foreground/90 transition-colors"
          >
            Call
          </button>
        )}
        {isCalled && isMyTicket && (
          <div className="shrink-0 flex gap-1.5">
            <button
              onClick={() => onAction('serve', ticket.id)}
              className="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              Serve
            </button>
            <button
              onClick={() => onAction('recall', ticket.id)}
              className="rounded-xl bg-indigo-100 text-indigo-700 px-2.5 py-1.5 text-xs font-medium hover:bg-indigo-200 transition-colors"
              title="Recall"
            >
              <Bell className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onAction('noshow', ticket.id)}
              className="rounded-xl bg-red-100 text-red-600 px-2.5 py-1.5 text-xs font-medium hover:bg-red-200 transition-colors"
              title="No Show"
            >
              <UserX className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {isServing && isMyTicket && (
          <div className="shrink-0 flex gap-1.5">
            <button
              onClick={() => onAction('done', ticket.id)}
              className="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700 transition-colors"
            >
              Done
            </button>
            <button
              onClick={() => onTransfer(ticket.id)}
              className="rounded-xl bg-purple-100 text-purple-700 px-2.5 py-1.5 text-xs font-medium hover:bg-purple-200 transition-colors"
              title="Transfer"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="h-px bg-border/50 mb-3" />
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Customer */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">{t.customer}</p>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-foreground">{customerName}</span>
                </div>
                {customerPhone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" /><span>{customerPhone}</span>
                  </div>
                )}
                {customerEmail && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /><span>{customerEmail}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  {ticket.is_remote
                    ? <><QrCode className="h-3 w-3" /> Remote (QR)</>
                    : <><Monitor className="h-3 w-3" /> On-site</>
                  }
                </div>
                {ticket.priority != null && ticket.priority > 0 && (
                  <div className="text-xs text-amber-600 font-medium">Priority {ticket.priority}</div>
                )}
                {(ticket.recall_count ?? 0) > 0 && (
                  <div className="text-xs text-amber-600">Recalled {ticket.recall_count}x</div>
                )}
              </div>
            </div>

            {/* Timeline */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Timeline</p>
              <div className="space-y-1.5">
                <TimelineRow label="Joined" ts={ticket.created_at} />
                <TimelineRow label="Called" ts={ticket.called_at} />
                <TimelineRow label="Serving" ts={ticket.serving_started_at} />
                <TimelineRow label="Done" ts={ticket.completed_at} />
                {ticket.desk?.name && (
                  <div className="flex items-center justify-between text-sm pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">{t.desk}</span>
                    <span className="font-medium text-foreground">{ticket.desk.name}</span>
                  </div>
                )}
                {ticket.office?.name && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t.office}</span>
                    <span className="text-foreground">{ticket.office.name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Actions</p>
              <div className="flex flex-wrap gap-1.5">
                {ticket.qr_token && (
                  <a href={`/q/${ticket.qr_token}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                    <ExternalLink className="h-3 w-3" /> Track
                  </a>
                )}
                {ticket.qr_token && (
                  <a href={`/api/qr/branded?token=${ticket.qr_token}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors">
                    <QrCode className="h-3 w-3" /> QR
                  </a>
                )}
                {isActive && deskId && (
                  <button onClick={() => onAction('buzz', ticket.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors">
                    <Megaphone className="h-3 w-3" /> Buzz
                  </button>
                )}
                {(isCalled || isServing) && isMyTicket && (
                  <button onClick={() => onAction('reset', ticket.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors">
                    <RotateCcw className="h-3 w-3" /> Reset
                  </button>
                )}
                {!isTerminal && (
                  <button onClick={() => onCancel(ticket.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors">
                    <XCircle className="h-3 w-3" /> Cancel
                  </button>
                )}
                {isTerminal && (
                  <button onClick={() => onDelete(ticket.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors">
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineRow({ label, ts }: { label: string; ts: string | null }) {
  if (!ts) return null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground tabular-nums">
        {new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  );
}

// ─── Main Component ───

export function QueueClient({
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
}: {
  staffId: string;
  staffName: string;
  assignedDesk: Desk | null;
  availableDesks: Desk[];
  departments: Department[];
  services: Service[];
  offices: Office[];
  primaryOfficeId: string;
  tickets: Ticket[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  filters: { office: string; status: string; date: string };
}) {
  const t = useTerminology();
  const router = useRouter();
  const totalPages = Math.ceil(totalCount / pageSize);
  const [tab, setTab] = useState<TabKey>('queue');
  const [showFilters, setShowFilters] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'cancel' | 'delete' } | null>(null);
  const [transferDialog, setTransferDialog] = useState<string | null>(null);
  const [transferDeptId, setTransferDeptId] = useState('');
  const [transferServiceId, setTransferServiceId] = useState('');
  const [deskId, setDeskId] = useState<string | null>(assignedDesk?.id || null);
  const [deskDisplayName, setDeskDisplayName] = useState<string | null>(assignedDesk?.display_name || assignedDesk?.name || null);
  const [deskSelectOpen, setDeskSelectOpen] = useState(false);

  // Realtime queue for the live tab
  const { queue, isLoading: queueLoading } = useRealtimeQueue({ officeId: primaryOfficeId });

  // Merge realtime data for live queue
  const liveTickets = [
    ...queue.serving,
    ...queue.called,
    ...queue.waiting,
  ];

  let toastId = 0;
  function addToast(message: string, type: Toast['type'] = 'success') {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }

  // ── Queue Actions ──

  async function handleAction(action: string, ticketId: string) {
    startTransition(async () => {
      let result: any;
      switch (action) {
        case 'call':
          if (!deskId) { addToast('Assign a desk first', 'error'); return; }
          result = await callNextTicket(deskId, staffId);
          if (result.error) addToast(result.error, 'error');
          else addToast(`Called #${result.data?.ticket_number}`);
          break;
        case 'serve':
          result = await startServing(ticketId, staffId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Now serving');
          break;
        case 'done':
          result = await markServed(ticketId, staffId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Marked as served');
          break;
        case 'noshow':
          result = await markNoShow(ticketId, staffId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Marked as no show');
          break;
        case 'recall':
          result = await recallTicket(ticketId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Customer recalled');
          break;
        case 'buzz':
          result = await buzzTicket(ticketId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Buzz sent');
          break;
        case 'reset':
          result = await resetTicketToQueue(ticketId);
          if (result.error) addToast(result.error, 'error');
          else addToast('Reset to queue');
          break;
      }
    });
  }

  async function handleCallNext() {
    if (!deskId) { addToast('Assign a desk first', 'error'); return; }
    startTransition(async () => {
      const result = await callNextTicket(deskId, staffId);
      if (result.error) addToast(result.error, 'error');
      else addToast(`Called #${result.data?.ticket_number}`);
    });
  }

  async function handleTransfer() {
    if (!transferDialog || !transferDeptId || !transferServiceId) return;
    startTransition(async () => {
      const result = await transferTicket(transferDialog, transferDeptId, transferServiceId);
      if (result.error) addToast(result.error, 'error');
      else addToast('Transferred');
      setTransferDialog(null);
      setTransferDeptId('');
      setTransferServiceId('');
    });
  }

  async function handleAssignDesk(id: string) {
    const deskInfo = availableDesks.find((d) => d.id === id);
    startTransition(async () => {
      const result = await assignDesk(id, staffId);
      if (result.error) addToast(result.error, 'error');
      else {
        setDeskId(id);
        setDeskDisplayName(deskInfo?.display_name || deskInfo?.name || 'Desk');
        addToast(`Assigned to ${deskInfo?.display_name || deskInfo?.name}`);
      }
      setDeskSelectOpen(false);
    });
  }

  async function handleUnassignDesk() {
    if (!deskId) return;
    startTransition(async () => {
      await unassignDesk(deskId);
      setDeskId(null);
      setDeskDisplayName(null);
      addToast('Desk released', 'info');
    });
  }

  function executeConfirm() {
    if (!confirmAction) return;
    startTransition(async () => {
      if (confirmAction.type === 'cancel') await cancelVisit(confirmAction.id);
      else await deleteVisit(confirmAction.id);
      setConfirmAction(null);
      addToast(confirmAction.type === 'cancel' ? 'Visit cancelled' : 'Record deleted');
      router.refresh();
    });
  }

  // URL helpers
  function updateFilters(key: string, value: string) {
    const p = new URLSearchParams();
    const current = { ...filters, [key]: value };
    if (current.office) p.set('office', current.office);
    if (current.status && current.status !== 'all') p.set('status', current.status);
    if (current.date) p.set('date', current.date);
    router.push(`/admin/queue${p.toString() ? `?${p.toString()}` : ''}`);
  }
  function goToPage(page: number) {
    const p = new URLSearchParams();
    if (filters.office) p.set('office', filters.office);
    if (filters.status && filters.status !== 'all') p.set('status', filters.status);
    if (filters.date) p.set('date', filters.date);
    if (page > 1) p.set('page', String(page));
    router.push(`/admin/queue${p.toString() ? `?${p.toString()}` : ''}`);
  }

  const deskName = deskDisplayName;
  const filteredServices = transferDeptId
    ? services.filter((s) => s.department_id === transferDeptId)
    : services;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Live operations</h1>
          <p className="text-sm text-muted-foreground">
            Manage arrivals, active service, and customer handoff in real time
          </p>
        </div>
      </div>

      {/* Desk assignment bar */}
      <div className={`rounded-2xl border p-3 mb-5 flex items-center justify-between ${
        deskId ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'
      }`}>
        {deskId ? (
          <>
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="h-4 w-4 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-800">
                Active at <span className="font-bold">{deskName}</span>
              </span>
            </div>
            <button
              onClick={handleUnassignDesk}
              disabled={isPending}
              className="rounded-lg px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              Release
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-amber-800">
                No {t.desk.toLowerCase()} assigned — assign one to start calling
              </span>
            </div>
            <div className="relative">
              <button
                onClick={() => setDeskSelectOpen(!deskSelectOpen)}
                className="rounded-lg bg-foreground text-background px-3.5 py-1.5 text-xs font-semibold hover:bg-foreground/90 transition-colors"
              >
                Assign {t.desk}
              </button>
              {deskSelectOpen && (
                <div className="absolute right-0 top-full mt-1 w-56 rounded-xl border border-border bg-card shadow-lg z-20 py-1 max-h-60 overflow-y-auto">
                  {availableDesks.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">No available {t.deskPlural.toLowerCase()}</p>
                  )}
                  {availableDesks.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => handleAssignDesk(d.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    >
                      {d.display_name || d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Stats strip */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        <StatPill label="Waiting" value={queue.waiting.length} color="amber" />
        <StatPill label="Called" value={queue.called.length} color="indigo" />
        <StatPill label="Serving" value={queue.serving.length} color="emerald" active />
        <StatPill label="Done" value={queue.recentlyServed.length} color="green" />
      </div>

      {/* Call Next button — prominent when desk is assigned */}
      {deskId && tab === 'queue' && queue.waiting.length > 0 && (
        <button
          onClick={handleCallNext}
          disabled={isPending}
          className="w-full mb-4 rounded-2xl bg-foreground text-background py-3.5 text-sm font-bold hover:bg-foreground/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <PhoneCall className="h-4 w-4" />
          Call Next {t.customer} ({queue.waiting.length} waiting)
        </button>
      )}

      {/* Tabs */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex rounded-xl bg-muted p-1 gap-0.5">
          <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} count={liveTickets.length}>
            Live Queue
          </TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')} count={totalCount}>
            History
          </TabButton>
        </div>
        {tab === 'history' && (
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              showFilters ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Filter className="h-3 w-3" /> Filters
          </button>
        )}
      </div>

      {/* Filters (history tab only) */}
      {tab === 'history' && showFilters && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          <select value={filters.office} onChange={(e) => updateFilters('office', e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring">
            <option value="">All {t.officePlural}</option>
            {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => updateFilters('status', e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All Statuses</option>
            <option value="waiting">Waiting</option>
            <option value="called">Called</option>
            <option value="serving">Serving</option>
            <option value="served">Completed</option>
            <option value="no_show">No Show</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input type="date" value={filters.date} onChange={(e) => updateFilters('date', e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" />
          {(filters.office || filters.status !== 'all' || filters.date) && (
            <button onClick={() => router.push('/admin/queue')}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      )}

      {/* ── Live Queue Tab ── */}
      {tab === 'queue' && (
        <div className="space-y-2">
          {queueLoading && liveTickets.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-foreground border-t-transparent mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading queue...</p>
            </div>
          )}
          {!queueLoading && liveTickets.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border py-16 text-center">
              <Hourglass className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground">Queue is empty</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t.customerPlural} will appear here when they join
              </p>
            </div>
          )}
          {liveTickets.map((ticket: any) => (
            <TicketCard
              key={ticket.id}
              ticket={{
                ...ticket,
                service: null,
                department: null,
                office: null,
                desk: null,
                customer_data: ticket.customer_data as any,
              }}
              terminology={t}
              deskId={deskId}
              staffId={staffId}
              isMyTicket={ticket.desk_id === deskId}
              onAction={handleAction}
              onCancel={(id) => setConfirmAction({ id, type: 'cancel' })}
              onDelete={(id) => setConfirmAction({ id, type: 'delete' })}
              onTransfer={(id) => setTransferDialog(id)}
            />
          ))}
          {/* Recently served */}
          {queue.recentlyServed.length > 0 && (
            <>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest pt-4 pb-1">Recently Completed</p>
              {queue.recentlyServed.map((ticket: any) => (
                <TicketCard
                  key={`done-${ticket.id}`}
                  ticket={{
                    ...ticket,
                    service: null, department: null, office: null, desk: null,
                    customer_data: ticket.customer_data as any,
                  }}
                  terminology={t}
                  deskId={deskId}
                  staffId={staffId}
                  isMyTicket={ticket.desk_id === deskId}
                  onAction={handleAction}
                  onCancel={(id) => setConfirmAction({ id, type: 'cancel' })}
                  onDelete={(id) => setConfirmAction({ id, type: 'delete' })}
                  onTransfer={(id) => setTransferDialog(id)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && (
        <>
          <div className="space-y-2">
            {initialTickets.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border py-16 text-center">
                <p className="text-sm text-muted-foreground">No visits found</p>
              </div>
            )}
            {initialTickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                terminology={t}
                deskId={deskId}
                staffId={staffId}
                isMyTicket={ticket.desk_id === deskId}
                onAction={handleAction}
                onCancel={(id) => setConfirmAction({ id, type: 'cancel' })}
                onDelete={(id) => setConfirmAction({ id, type: 'delete' })}
                onTransfer={(id) => setTransferDialog(id)}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
              </p>
              <div className="flex gap-1.5">
                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                  className="rounded-lg border border-border p-1.5 text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}
                  className="rounded-lg border border-border p-1.5 text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Transfer Dialog ── */}
      {transferDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setTransferDialog(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-foreground mb-4">Transfer {t.customer}</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t.department}</label>
                <select value={transferDeptId} onChange={(e) => { setTransferDeptId(e.target.value); setTransferServiceId(''); }}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">Select {t.department.toLowerCase()}</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Service</label>
                <select value={transferServiceId} onChange={(e) => setTransferServiceId(e.target.value)}
                  disabled={!transferDeptId}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                  <option value="">Select service</option>
                  {filteredServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setTransferDialog(null)}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleTransfer} disabled={isPending || !transferDeptId || !transferServiceId}
                className="rounded-xl bg-purple-600 text-white px-4 py-2 text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50">
                {isPending ? 'Transferring...' : 'Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm Dialog ── */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setConfirmAction(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`rounded-full p-2.5 ${confirmAction.type === 'delete' ? 'bg-red-100' : 'bg-amber-100'}`}>
                <AlertTriangle className={`h-5 w-5 ${confirmAction.type === 'delete' ? 'text-red-600' : 'text-amber-600'}`} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {confirmAction.type === 'delete' ? 'Delete record?' : 'Cancel visit?'}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {confirmAction.type === 'delete' ? 'This permanently removes the record.' : 'The customer will be notified.'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmAction(null)} disabled={isPending}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors">
                Go back
              </button>
              <button onClick={executeConfirm} disabled={isPending}
                className={`rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                  confirmAction.type === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}>
                {isPending ? 'Processing...' : confirmAction.type === 'delete' ? 'Delete' : 'Cancel visit'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

// ─── Sub-components ───

function StatPill({ label, value, color, active }: { label: string; value: number; color: string; active?: boolean }) {
  const colorMap: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    green: 'bg-green-50 text-green-600',
  };
  const dotMap: Record<string, string> = {
    amber: 'bg-amber-400', indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', green: 'bg-green-500',
  };
  return (
    <div className={`shrink-0 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ${colorMap[color]}`}>
      {active && (
        <span className="relative flex h-1.5 w-1.5">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dotMap[color]} opacity-75`} />
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dotMap[color]}`} />
        </span>
      )}
      <span className="font-bold tabular-nums">{value}</span>
      <span className="opacity-70">{label}</span>
    </div>
  );
}

function TabButton({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}>
      {children}
      <span className={`ml-1.5 tabular-nums ${active ? 'text-foreground' : 'text-muted-foreground/60'}`}>{count}</span>
    </button>
  );
}

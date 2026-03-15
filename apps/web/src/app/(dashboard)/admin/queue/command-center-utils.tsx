'use client';

import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { QueueData, QueueTicket } from '@/lib/hooks/use-realtime-queue';

export type Ticket = QueueTicket & {
  service?: { name: string } | null;
  department?: { name: string } | null;
  office?: { name: string } | null;
  desk?: { name?: string | null; display_name?: string | null } | null;
};

export interface Desk {
  id: string;
  name: string;
  display_name: string | null;
  department_id: string | null;
  office_id: string;
}

export interface Office {
  id: string;
  name: string;
}

export interface Department {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  department_id: string | null;
}

export interface QueueClientProps {
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
}

export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export interface OperatorActionPulse {
  label: string;
  at: string;
  tone: 'neutral' | 'success' | 'attention';
}

export type ViewMode = 'board' | 'history';
export type TicketAction =
  | 'call'
  | 'serve'
  | 'done'
  | 'recall'
  | 'noshow'
  | 'buzz'
  | 'reset'
  | 'cancel'
  | 'delete'
  | 'transfer';

export type ConfirmAction =
  | { id: string; type: 'cancel' }
  | { id: string; type: 'delete' };

export const statusMeta: Record<
  string,
  {
    label: string;
    badge: string;
    border: string;
    pulse?: boolean;
  }
> = {
  issued: {
    label: 'Issued',
    badge: 'bg-sky-50 text-sky-700',
    border: 'border-sky-200',
  },
  waiting: {
    label: 'Waiting',
    badge: 'bg-amber-50 text-amber-700',
    border: 'border-amber-200',
  },
  called: {
    label: 'Called',
    badge: 'bg-indigo-50 text-indigo-700',
    border: 'border-indigo-200',
    pulse: true,
  },
  serving: {
    label: 'Serving',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-200',
  },
  served: {
    label: 'Completed',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-200',
  },
  completed: {
    label: 'Completed',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-200',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'bg-slate-100 text-slate-600',
    border: 'border-slate-200',
  },
  no_show: {
    label: 'No Show',
    badge: 'bg-rose-50 text-rose-700',
    border: 'border-rose-200',
  },
  transferred: {
    label: 'Transferred',
    badge: 'bg-purple-50 text-purple-700',
    border: 'border-purple-200',
  },
};

export function getStatusMeta(status: string) {
  return statusMeta[status] || statusMeta.waiting;
}

export function getCustomerName(ticket: Ticket) {
  const value = ticket.customer_data;
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
    return value.name;
  }
  return 'Walk-in';
}

export function getCustomerPhone(ticket: Ticket) {
  const value = ticket.customer_data;
  if (value && typeof value === 'object' && 'phone' in value && typeof value.phone === 'string') {
    return value.phone;
  }
  return null;
}

export function getCustomerEmail(ticket: Ticket) {
  const value = ticket.customer_data;
  if (value && typeof value === 'object' && 'email' in value && typeof value.email === 'string') {
    return value.email;
  }
  return null;
}

export function getDeskLabel(ticket: Ticket) {
  return ticket.desk?.display_name || ticket.desk?.name || 'Unassigned';
}

export function formatClock(value: string | null) {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value: string | null) {
  if (!value) return '--';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function useElapsed(value: string | null, active: boolean) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!value || !active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [value, active]);

  if (!value) return null;
  return Math.max(0, Math.floor(((active ? now : Date.now()) - new Date(value).getTime()) / 1000));
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return '--';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remain).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function matchesSearch(ticket: Ticket, search: string) {
  if (!search) return true;
  const normalized = search.toLowerCase();
  return [
    getCustomerName(ticket),
    getCustomerPhone(ticket) || '',
    getCustomerEmail(ticket) || '',
    ticket.ticket_number,
    ticket.service?.name || '',
    ticket.department?.name || '',
    ticket.office?.name || '',
  ].some((value) => value.toLowerCase().includes(normalized));
}

export function sortRecentTickets(tickets: Ticket[]) {
  return [...tickets].sort(
    (left, right) =>
      new Date(right.completed_at ?? right.created_at ?? 0).getTime() -
      new Date(left.completed_at ?? left.created_at ?? 0).getTime()
  );
}

export function flattenQueueData(queue: QueueData): Ticket[] {
  return [
    ...queue.issued,
    ...queue.waiting,
    ...queue.called,
    ...queue.serving,
    ...queue.recentlyServed,
    ...queue.cancelled,
    ...queue.noShows,
    ...queue.transferred,
  ] as Ticket[];
}

export function bucketQueueTickets(tickets: Ticket[]): QueueData {
  const byCompletedAtDesc = (left: Ticket, right: Ticket) =>
    new Date(right.completed_at ?? 0).getTime() - new Date(left.completed_at ?? 0).getTime();

  return {
    issued: tickets.filter((ticket) => ticket.status === 'issued'),
    waiting: tickets.filter((ticket) => ticket.status === 'waiting'),
    called: tickets.filter((ticket) => ticket.status === 'called'),
    serving: tickets.filter((ticket) => ticket.status === 'serving'),
    recentlyServed: tickets.filter((ticket) => ticket.status === 'served').sort(byCompletedAtDesc).slice(0, 6),
    cancelled: tickets.filter((ticket) => ticket.status === 'cancelled').sort(byCompletedAtDesc).slice(0, 6),
    noShows: tickets.filter((ticket) => ticket.status === 'no_show').sort(byCompletedAtDesc).slice(0, 6),
    transferred: tickets.filter((ticket) => ticket.status === 'transferred').sort(byCompletedAtDesc).slice(0, 6),
  };
}

export function getTicketActionKey(ticketId: string, action: TicketAction) {
  return `${ticketId}:${action}`;
}

export function formatRelativeActionTime(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === 'success'
              ? 'bg-emerald-600 text-white'
              : toast.type === 'error'
                ? 'bg-rose-600 text-white'
                : 'bg-[#3156a6] text-white'
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(20,27,26,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

export function ActionButton({
  label,
  icon,
  onClick,
  disabled,
  loading = false,
  danger = false,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
          : 'border-[#d7e4ff] bg-white text-[#3156a6] hover:border-[#a9c2f5] hover:bg-[#f7faff]'
      }`}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : icon}
      {label}
    </button>
  );
}

export function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

'use client';

import { useTerminology } from '@/lib/terminology-context';
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  Megaphone,
  MonitorSmartphone,
  PhoneCall,
  Play,
  QrCode,
  RotateCcw,
  Trash2,
  UserRound,
  UserX,
  Workflow,
  XCircle,
  ArrowRightLeft,
} from 'lucide-react';
import {
  ActionButton,
  ConfirmAction,
  Ticket,
  TimelineRow,
  formatDateTime,
  formatDuration,
  getCustomerEmail,
  getCustomerName,
  getCustomerPhone,
  getDeskLabel,
  getStatusMeta,
  useElapsed,
} from './command-center-utils';

function VisitCard({
  ticket,
  terminology,
  selected,
  ownedByMyDesk,
  canCall,
  onSelect,
  onPrimaryAction,
}: {
  ticket: Ticket;
  terminology: ReturnType<typeof useTerminology>;
  selected: boolean;
  ownedByMyDesk: boolean;
  canCall: boolean;
  onSelect: () => void;
  onPrimaryAction: () => void;
}) {
  const meta = getStatusMeta(ticket.status);
  const activeTime = useElapsed(
    ticket.status === 'serving'
      ? ticket.serving_started_at
      : ticket.status === 'called'
        ? ticket.called_at
        : ticket.created_at,
    ['issued', 'waiting', 'called', 'serving'].includes(ticket.status)
  );

  let primaryLabel = 'View';
  if (ticket.status === 'issued' || ticket.status === 'waiting') primaryLabel = 'Call';
  if (ticket.status === 'called') primaryLabel = 'Start';
  if (ticket.status === 'serving') primaryLabel = 'Complete';

  const primaryDisabled =
    (ticket.status === 'issued' || ticket.status === 'waiting') ? !canCall :
    (ticket.status === 'called' || ticket.status === 'serving') ? !ownedByMyDesk :
    false;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[26px] border p-4 text-left transition ${
        selected
          ? 'border-[#10292f] bg-[#10292f] text-white shadow-[0_18px_36px_rgba(16,41,47,0.16)]'
          : `bg-white hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(20,27,26,0.08)] ${meta.border}`
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? 'bg-white/12 text-white' : meta.badge}`}>
              {ticket.ticket_number}
            </span>
            {ticket.priority ? (
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${selected ? 'bg-[#8de2d5]/20 text-[#bdf0e7]' : 'bg-[#f0f6f5] text-[#10292f]'}`}>
                Priority {ticket.priority}
              </span>
            ) : null}
            {ticket.is_remote ? (
              <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${selected ? 'bg-white/10 text-white/80' : 'bg-slate-100 text-slate-500'}`}>
                Remote
              </span>
            ) : null}
          </div>
          <p className={`mt-3 text-lg font-semibold ${selected ? 'text-white' : 'text-slate-950'}`}>{getCustomerName(ticket)}</p>
          <p className={`mt-1 text-sm ${selected ? 'text-white/72' : 'text-slate-500'}`}>
            {ticket.service?.name || 'General service'}
            {ticket.department?.name ? ` · ${ticket.department.name}` : ''}
          </p>
        </div>

        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? 'bg-white/10 text-white' : meta.badge}`}>
          {meta.label}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <p className={`text-[11px] uppercase tracking-[0.16em] ${selected ? 'text-white/45' : 'text-slate-400'}`}>{terminology.desk}</p>
          <p className={`mt-1 text-sm font-medium ${selected ? 'text-white/85' : 'text-slate-700'}`}>{getDeskLabel(ticket)}</p>
        </div>
        <div>
          <p className={`text-[11px] uppercase tracking-[0.16em] ${selected ? 'text-white/45' : 'text-slate-400'}`}>Active time</p>
          <p className={`mt-1 text-sm font-medium ${selected ? 'text-white/85' : 'text-slate-700'}`}>{formatDuration(activeTime)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className={`text-xs ${selected ? 'text-white/60' : 'text-slate-500'}`}>
          {ownedByMyDesk ? `On your ${terminology.desk.toLowerCase()}` : ticket.status === 'called' || ticket.status === 'serving' ? `Assigned to ${getDeskLabel(ticket)}` : 'Ready for operator action'}
        </p>
        {ticket.status === 'served' || ticket.status === 'cancelled' || ticket.status === 'no_show' || ticket.status === 'transferred' ? null : (
          <button
            type="button"
            disabled={primaryDisabled}
            onClick={(event) => {
              event.stopPropagation();
              onPrimaryAction();
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
              selected
                ? 'bg-white text-[#10292f] hover:bg-white/90 disabled:bg-white/20 disabled:text-white/50'
                : 'bg-[#10292f] text-white hover:bg-[#18383f] disabled:bg-slate-200 disabled:text-slate-400'
            }`}
          >
            {primaryLabel}
            {ticket.status === 'serving' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </button>
  );
}

export function StageColumn({
  title,
  subtitle,
  tickets,
  terminology,
  selectedId,
  deskId,
  onSelect,
  onPrimaryAction,
}: {
  title: string;
  subtitle: string;
  tickets: Ticket[];
  terminology: ReturnType<typeof useTerminology>;
  selectedId: string | null;
  deskId: string | null;
  onSelect: (ticketId: string) => void;
  onPrimaryAction: (ticket: Ticket) => void;
}) {
  return (
    <section className="rounded-[30px] border border-slate-200 bg-[#fbfaf8] p-4 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{tickets.length}</span>
      </div>

      <div className="space-y-3">
        {tickets.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-400">
            No visits in this stage.
          </div>
        ) : (
          tickets.map((ticket) => (
            <VisitCard
              key={ticket.id}
              ticket={ticket}
              terminology={terminology}
              selected={selectedId === ticket.id}
              ownedByMyDesk={Boolean(deskId && ticket.desk_id === deskId)}
              canCall={Boolean(deskId)}
              onSelect={() => onSelect(ticket.id)}
              onPrimaryAction={() => onPrimaryAction(ticket)}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function FocusPanel({
  ticket,
  terminology,
  deskId,
  onAction,
  onConfirm,
  onTransfer,
}: {
  ticket: Ticket | null;
  terminology: ReturnType<typeof useTerminology>;
  deskId: string | null;
  onAction: (action: 'call' | 'serve' | 'done' | 'recall' | 'noshow' | 'buzz' | 'reset', ticket: Ticket) => void;
  onConfirm: (action: ConfirmAction) => void;
  onTransfer: (ticket: Ticket) => void;
}) {
  if (!ticket) {
    return (
      <aside className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)]">
        <p className="text-sm text-slate-500">Select a visit to manage its next step, customer context, and handoff actions.</p>
      </aside>
    );
  }

  const meta = getStatusMeta(ticket.status);
  const ownedByMyDesk = Boolean(deskId && ticket.desk_id === deskId);
  const isActive = ['issued', 'waiting', 'called', 'serving'].includes(ticket.status);
  const canCall = Boolean(deskId && (ticket.status === 'issued' || ticket.status === 'waiting'));
  const canServe = ticket.status === 'called' && ownedByMyDesk;
  const canComplete = ticket.status === 'serving' && ownedByMyDesk;
  const canRecall = ticket.status === 'called' && ownedByMyDesk;
  const canNoShow = ticket.status === 'called' && ownedByMyDesk;
  const canReset = (ticket.status === 'called' || ticket.status === 'serving') && ownedByMyDesk;
  const canTransfer = ticket.status === 'serving' && ownedByMyDesk;
  const canDelete = ['served', 'completed', 'cancelled', 'no_show', 'transferred'].includes(ticket.status);
  const customerPhone = getCustomerPhone(ticket);
  const customerEmail = getCustomerEmail(ticket);

  return (
    <aside className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_14px_30px_rgba(20,27,26,0.04)] xl:sticky xl:top-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Focused visit</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{ticket.ticket_number}</h2>
          <p className="mt-1 text-sm text-slate-500">{getCustomerName(ticket)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${meta.badge}`}>{meta.label}</span>
      </div>

      {!ownedByMyDesk && (ticket.status === 'called' || ticket.status === 'serving') ? (
        <div className="mt-5 rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This visit is currently on another {terminology.desk.toLowerCase()}. You can still review context and cancel if needed.
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
        <div className="rounded-[24px] bg-[#f6f7f4] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Service</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">{ticket.service?.name || 'General service'}</p>
          <p className="mt-1 text-sm text-slate-500">{ticket.department?.name || terminology.department}</p>
        </div>
        <div className="rounded-[24px] bg-[#f6f7f4] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{terminology.desk}</p>
          <p className="mt-2 text-sm font-semibold text-slate-900">{getDeskLabel(ticket)}</p>
          <p className="mt-1 text-sm text-slate-500">{ticket.office?.name || terminology.office}</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <ActionButton label="Call this visit now" icon={<PhoneCall className="h-4 w-4" />} disabled={!canCall} onClick={() => onAction('call', ticket)} />
        <ActionButton label="Start service" icon={<Play className="h-4 w-4" />} disabled={!canServe} onClick={() => onAction('serve', ticket)} />
        <ActionButton label="Complete service" icon={<CheckCircle2 className="h-4 w-4" />} disabled={!canComplete} onClick={() => onAction('done', ticket)} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <ActionButton label="Recall" icon={<Bell className="h-4 w-4" />} disabled={!canRecall} onClick={() => onAction('recall', ticket)} />
        <ActionButton label="Buzz" icon={<Megaphone className="h-4 w-4" />} disabled={!isActive} onClick={() => onAction('buzz', ticket)} />
        <ActionButton label="No show" icon={<UserX className="h-4 w-4" />} disabled={!canNoShow} onClick={() => onAction('noshow', ticket)} />
        <ActionButton label="Reset" icon={<RotateCcw className="h-4 w-4" />} disabled={!canReset} onClick={() => onAction('reset', ticket)} />
        <ActionButton label="Transfer" icon={<ArrowRightLeft className="h-4 w-4" />} disabled={!canTransfer} onClick={() => onTransfer(ticket)} />
        <ActionButton
          label={canDelete ? 'Delete' : 'Cancel'}
          icon={canDelete ? <Trash2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          danger
          onClick={() => onConfirm({ id: ticket.id, type: canDelete ? 'delete' : 'cancel' })}
        />
      </div>

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Customer</p>
        <div className="mt-3 space-y-2 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 text-slate-400" />
            <span>{getCustomerName(ticket)}</span>
          </div>
          {customerPhone ? (
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-slate-400" />
              <span>{customerPhone}</span>
            </div>
          ) : null}
          {customerEmail ? (
            <div className="flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-slate-400" />
              <span>{customerEmail}</span>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            {ticket.is_remote ? <QrCode className="h-4 w-4 text-slate-400" /> : <MonitorSmartphone className="h-4 w-4 text-slate-400" />}
            <span>{ticket.is_remote ? 'Remote join' : 'On-site arrival'}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Timeline</p>
        <div className="mt-3 space-y-3 text-sm text-slate-600">
          <TimelineRow label="Created" value={formatDateTime(ticket.created_at)} />
          <TimelineRow label="Called" value={formatDateTime(ticket.called_at)} />
          <TimelineRow label="Serving" value={formatDateTime(ticket.serving_started_at)} />
          <TimelineRow label="Closed" value={formatDateTime(ticket.completed_at)} />
        </div>
      </div>

      <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4 text-sm text-slate-600">
        <div className="flex items-center gap-2 text-slate-900">
          <Workflow className="h-4 w-4 text-slate-400" />
          <span className="font-semibold">Customer-flow note</span>
        </div>
        <p className="mt-2 leading-7">
          This panel keeps the next action, customer context, and handoff logic in one place so the same workflow still works across categories.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <a
          href={ticket.qr_token ? `/q/${ticket.qr_token}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            ticket.qr_token ? 'border-slate-300 text-slate-700 hover:border-slate-400' : 'border-slate-200 text-slate-300'
          }`}
        >
          <ExternalLink className="h-4 w-4" />
          Track
        </a>
        <a
          href={ticket.qr_token ? `/api/qr/branded?token=${ticket.qr_token}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            ticket.qr_token ? 'border-slate-300 text-slate-700 hover:border-slate-400' : 'border-slate-200 text-slate-300'
          }`}
        >
          <QrCode className="h-4 w-4" />
          QR
        </a>
      </div>
    </aside>
  );
}

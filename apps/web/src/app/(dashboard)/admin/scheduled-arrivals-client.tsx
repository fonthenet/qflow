'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react';
import { CalendarCheck2, CalendarClock, Clock3, MapPin, Plus, Search, Ticket, TimerReset, XCircle } from 'lucide-react';
import { useTerminology } from '@/lib/terminology-context';
import {
  cancelAppointment,
  checkInAppointment,
  createAppointment,
} from '@/lib/actions/appointment-actions';
import type {
  ScheduledArrival,
  ScheduledArrivalsPageData,
} from './scheduled-arrivals-data';

type DashboardVariant = 'appointments' | 'reservations';

interface ScheduledArrivalsClientProps extends ScheduledArrivalsPageData {
  variant: DashboardVariant;
  basePath: string;
}

type Toast = {
  id: number;
  message: string;
  type: 'success' | 'error';
};

type CreateFormState = {
  officeId: string;
  departmentId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  date: string;
  time: string;
};

const activeTicketStatuses = new Set(['issued', 'waiting', 'called', 'serving']);
const resolvedTicketStatuses = new Set(['served', 'completed', 'cancelled', 'no_show', 'transferred']);

const copyByVariant: Record<
  DashboardVariant,
  {
    eyebrow: string;
    title: string;
    body: string;
    primaryLabel: string;
    createTitle: string;
    scheduledTitle: string;
    scheduledBody: string;
    activeTitle: string;
    activeBody: string;
    resolvedTitle: string;
    resolvedBody: string;
    playbookTitle: string;
    playbookItems: string[];
  }
> = {
  appointments: {
    eyebrow: 'Scheduled arrivals',
    title: 'Appointments now land in the same operating system as walk-ins.',
    body:
      'Book, check in, and hand off planned visits without leaving the command center flow. Every scheduled arrival can become a live ticket the moment the customer shows up.',
    primaryLabel: 'New appointment',
    createTitle: 'Create appointment',
    scheduledTitle: 'Scheduled next',
    scheduledBody: 'Upcoming arrivals that still need confirmation, prep, or check-in.',
    activeTitle: 'In command center',
    activeBody: 'Appointments already turned into active visits inside live operations.',
    resolvedTitle: 'Resolved and exceptions',
    resolvedBody: 'Completed, cancelled, transferred, and no-show outcomes for this day.',
    playbookTitle: 'Appointment playbook',
    playbookItems: [
      'Check-in creates a linked visit so the command center can call, assign, transfer, and complete it.',
      'Use one schedule across banking, healthcare, government, retail, hospitality, and any mixed-service workspace.',
      'Keep cancellations here so the live board only reflects arrivals that can still be served.',
    ],
  },
  reservations: {
    eyebrow: 'Booked flow',
    title: 'Reservations, booked tables, and planned arrivals now feed one live board.',
    body:
      'Use the same arrival system for dining rooms, concierge desks, member bookings, and any pre-booked service window. The reservation stops being a static list and becomes an operational handoff.',
    primaryLabel: 'New reservation',
    createTitle: 'Create reservation',
    scheduledTitle: 'Booked next',
    scheduledBody: 'Upcoming reservations and planned arrivals waiting for check-in.',
    activeTitle: 'Checked in and seating flow',
    activeBody: 'Booked guests who are already active in the command center and ready for service moves.',
    resolvedTitle: 'Completed and exceptions',
    resolvedBody: 'Cancelled, completed, transferred, and no-show outcomes tied back to the original booking.',
    playbookTitle: 'Reservation playbook',
    playbookItems: [
      'Booked arrivals and walk-ins can meet in the same command center once the guest checks in.',
      'The same system supports restaurants, hotels, spas, coworking spaces, and any scheduled-capacity business.',
      'Treat this route as your scheduled-arrivals board until a dedicated reservation schema adds party-size and turn-time controls.',
    ],
  },
};

function formatClock(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(value: string) {
  return new Date(value).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatRelative(value: string) {
  const diffMinutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (Math.abs(diffMinutes) < 1) return 'now';
  if (diffMinutes > 0) return `in ${diffMinutes}m`;
  return `${Math.abs(diffMinutes)}m ago`;
}

function getDefaultTime(date: string) {
  const now = new Date();
  const isToday = date === now.toISOString().split('T')[0];
  if (!isToday) return '09:00';
  const minutes = now.getMinutes();
  const nextHalfHour = minutes <= 30 ? 30 : 60;
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (nextHalfHour === 60) next.setHours(next.getHours() + 1, 0, 0, 0);
  else next.setMinutes(nextHalfHour, 0, 0);
  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
}

function createInitialForm(
  selectedOfficeId: string,
  selectedDate: string,
  departments: ScheduledArrivalsPageData['departments'],
  services: ScheduledArrivalsPageData['services']
): CreateFormState {
  const officeDepartments = departments.filter((department) => department.office_id === selectedOfficeId);
  const departmentId = officeDepartments[0]?.id || '';
  const officeServices = services.filter((service) => service.department_id === departmentId);

  return {
    officeId: selectedOfficeId,
    departmentId,
    serviceId: officeServices[0]?.id || '',
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    date: selectedDate,
    time: getDefaultTime(selectedDate),
  };
}

function addToast(
  setToasts: Dispatch<SetStateAction<Toast[]>>,
  message: string,
  type: Toast['type']
) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  setToasts((current) => [...current, { id, message, type }]);
  window.setTimeout(() => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, 3200);
}

function getTicketBadge(status: string | null | undefined) {
  switch (status) {
    case 'issued':
    case 'waiting':
      return 'bg-amber-50 text-amber-700';
    case 'called':
      return 'bg-indigo-50 text-indigo-700';
    case 'serving':
    case 'served':
    case 'completed':
      return 'bg-emerald-50 text-emerald-700';
    case 'cancelled':
      return 'bg-slate-100 text-slate-600';
    case 'no_show':
      return 'bg-rose-50 text-rose-700';
    case 'transferred':
      return 'bg-violet-50 text-violet-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function getTicketLabel(arrival: ScheduledArrival) {
  if (arrival.linkedTicket?.status) {
    const labels: Record<string, string> = {
      issued: 'Issued',
      waiting: 'Waiting',
      called: 'Called',
      serving: 'Serving',
      served: 'Completed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      no_show: 'No show',
      transferred: 'Transferred',
    };
    return labels[arrival.linkedTicket.status] || arrival.linkedTicket.status;
  }

  if (arrival.status === 'cancelled') return 'Cancelled';
  if (arrival.status === 'checked_in') return 'Checked in';
  if (arrival.status === 'confirmed') return 'Confirmed';
  return 'Pending';
}

function getSearchText(arrival: ScheduledArrival) {
  return [
    arrival.customer_name,
    arrival.customer_phone || '',
    arrival.customer_email || '',
    arrival.service?.name || '',
    arrival.department?.name || '',
    arrival.office?.name || '',
    arrival.linkedTicket?.ticket_number || '',
  ]
    .join(' ')
    .toLowerCase();
}

function createScheduledKey(arrival: ScheduledArrival) {
  return new Date(arrival.scheduled_at).getTime();
}

export function ScheduledArrivalsClient({
  variant,
  basePath,
  organizationName,
  businessType,
  selectedOfficeId,
  selectedDate,
  offices,
  departments,
  services,
  arrivals,
  summary,
}: ScheduledArrivalsClientProps) {
  const t = useTerminology();
  const router = useRouter();
  const copy = copyByVariant[variant];
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(() =>
    createInitialForm(selectedOfficeId, selectedDate, departments, services)
  );
  const [isPending, startTransition] = useTransition();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const filteredArrivals = arrivals
    .filter((arrival) => getSearchText(arrival).includes(search.toLowerCase()))
    .sort((left, right) => createScheduledKey(left) - createScheduledKey(right));

  const scheduled = filteredArrivals.filter((arrival) => {
    if (arrival.status === 'cancelled') return false;
    if (arrival.linkedTicket?.status && activeTicketStatuses.has(arrival.linkedTicket.status)) return false;
    if (arrival.linkedTicket?.status && resolvedTicketStatuses.has(arrival.linkedTicket.status)) return false;
    return arrival.status !== 'checked_in';
  });

  const activeFlow = filteredArrivals.filter((arrival) => {
    if (arrival.status === 'checked_in' && !arrival.linkedTicket) return true;
    return arrival.linkedTicket ? activeTicketStatuses.has(arrival.linkedTicket.status) : false;
  });

  const resolved = filteredArrivals
    .filter((arrival) => {
      if (arrival.status === 'cancelled') return true;
      return arrival.linkedTicket ? resolvedTicketStatuses.has(arrival.linkedTicket.status) : false;
    })
    .sort(
      (left, right) =>
        new Date(right.linkedTicket?.completed_at || right.scheduled_at).getTime() -
        new Date(left.linkedTicket?.completed_at || left.scheduled_at).getTime()
    );

  const upcomingMoments = scheduled.slice(0, 5);
  const serviceMix = scheduled.reduce<Record<string, number>>((accumulator, arrival) => {
    const key = arrival.service?.name || 'General service';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const serviceMixEntries = Object.entries(serviceMix).sort((left, right) => right[1] - left[1]);
  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  function updateUrl(next: { office?: string; date?: string }) {
    const params = new URLSearchParams();
    const office = next.office ?? selectedOfficeId;
    const date = next.date ?? selectedDate;

    if (office) params.set('office', office);
    if (date) params.set('date', date);

    router.push(`${basePath}${params.toString() ? `?${params.toString()}` : ''}`);
  }

  function openCreate() {
    setForm(createInitialForm(selectedOfficeId, selectedDate, departments, services));
    setShowCreate(true);
  }

  function handleFormChange<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((current) => {
      if (key === 'officeId') {
        const officeDepartments = departments.filter((department) => department.office_id === value);
        const departmentId = officeDepartments[0]?.id || '';
        const officeServices = services.filter((service) => service.department_id === departmentId);
        return { ...current, officeId: value, departmentId, serviceId: officeServices[0]?.id || '' };
      }

      if (key === 'departmentId') {
        const officeServices = services.filter((service) => service.department_id === value);
        return { ...current, departmentId: value, serviceId: officeServices[0]?.id || '' };
      }

      return { ...current, [key]: value };
    });
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.officeId || !form.departmentId || !form.serviceId || !form.customerName || !form.date || !form.time) {
      addToast(setToasts, 'Complete the required fields before saving.', 'error');
      return;
    }

    startTransition(async () => {
      const scheduledAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      const result = await createAppointment({
        officeId: form.officeId,
        departmentId: form.departmentId,
        serviceId: form.serviceId,
        customerName: form.customerName,
        customerPhone: form.customerPhone || undefined,
        customerEmail: form.customerEmail || undefined,
        scheduledAt,
      });

      if (result?.error) {
        addToast(setToasts, result.error, 'error');
        return;
      }

      setShowCreate(false);
      addToast(setToasts, `${variant === 'appointments' ? 'Appointment' : 'Reservation'} created.`, 'success');
      router.refresh();
    });
  }

  function handleCheckIn(arrivalId: string) {
    startTransition(async () => {
      const result = await checkInAppointment(arrivalId);
      if (result?.error) {
        addToast(setToasts, result.error, 'error');
        return;
      }

      const ticketNumber = result?.data?.ticket?.ticket_number;
      addToast(
        setToasts,
        ticketNumber ? `${ticketNumber} sent to the command center.` : 'Arrival checked in.',
        'success'
      );
      router.refresh();
    });
  }

  function handleCancel(arrivalId: string) {
    startTransition(async () => {
      const result = await cancelAppointment(arrivalId);
      if (result?.error) {
        addToast(setToasts, result.error, 'error');
        return;
      }

      addToast(setToasts, `${variant === 'appointments' ? 'Appointment' : 'Reservation'} cancelled.`, 'success');
      router.refresh();
    });
  }

  const formDepartments = departments.filter((department) => department.office_id === form.officeId);
  const formServices = services.filter((service) => service.department_id === form.departmentId);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#173740_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">{copy.eyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organizationName} is configured for {businessType?.replace(/_/g, ' ') || 'service operations'}. {copy.body}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SummaryCard label={variant === 'appointments' ? 'Scheduled today' : 'Booked today'} value={summary.scheduledCount} helper={formatDateLabel(selectedDate)} />
            <SummaryCard label={isToday ? 'Due next 90m' : 'Ready this day'} value={isToday ? summary.dueSoonCount : scheduled.length} helper={isToday ? 'Needs prep or check-in soon' : 'Still waiting to be checked in'} />
            <SummaryCard label="Active in flow" value={summary.activeFlowCount} helper="Already in the command center" />
            <SummaryCard label="7-day volume" value={summary.sevenDayVolume} helper={`${summary.cancellationRate}% cancellation rate`} />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Checked in" value={summary.checkedInCount.toString()} helper="Arrivals already converted into visits" />
        <MetricCard label="Still scheduled" value={scheduled.length.toString()} helper="Pending or confirmed bookings left to process" />
        <MetricCard label="Resolved" value={resolved.length.toString()} helper="Completed, cancelled, transferred, or no-show" />
        <MetricCard label={variant === 'appointments' ? 'Cross-route handoff' : 'Booked-to-live handoff'} value="1 system" helper="Scheduling and command center stay linked" />
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[220px]">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t.office}</label>
              <select value={selectedOfficeId} onChange={(event) => updateUrl({ office: event.target.value })} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-[#10292f]">
                {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
              </select>
            </div>

            <div className="min-w-[220px]">
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Schedule date</label>
              <input type="date" value={selectedDate} onChange={(event) => updateUrl({ date: event.target.value })} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-[#10292f]" />
            </div>

            <div className="relative min-w-[240px] flex-1 xl:min-w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${t.customerPlural.toLowerCase()}, services, or ticket numbers`} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-[#10292f] focus:ring-2 focus:ring-[#10292f]/10" />
            </div>
          </div>

          <button type="button" onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]">
            <Plus className="h-4 w-4" />
            {copy.primaryLabel}
          </button>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-6">
          <BoardSection title={copy.scheduledTitle} body={copy.scheduledBody} emptyTitle={variant === 'appointments' ? 'No appointments left to check in' : 'No reservations left to check in'} emptyBody="Everything for this date is either already active or resolved.">
            {scheduled.length === 0 ? null : scheduled.map((arrival) => (
              <ArrivalCard key={arrival.id} arrival={arrival} actionLabel="Check in" actionIcon={<CalendarCheck2 className="h-4 w-4" />} onAction={() => handleCheckIn(arrival.id)} onCancel={() => handleCancel(arrival.id)} isPending={isPending} />
            ))}
          </BoardSection>

          <BoardSection title={copy.activeTitle} body={copy.activeBody} emptyTitle="No arrivals are active right now" emptyBody="Once someone checks in, their live ticket and queue state will appear here.">
            {activeFlow.length === 0 ? null : activeFlow.map((arrival) => (
              <ArrivalCard key={arrival.id} arrival={arrival} actionLabel="Open command center" actionIcon={<Ticket className="h-4 w-4" />} actionHref="/admin/queue" isPending={isPending} />
            ))}
          </BoardSection>

          <BoardSection title={copy.resolvedTitle} body={copy.resolvedBody} emptyTitle="No resolved records yet" emptyBody="Completed and cancelled outcomes will collect here for the selected date.">
            {resolved.length === 0 ? null : resolved.map((arrival) => (
              <ArrivalCard key={arrival.id} arrival={arrival} actionLabel={arrival.linkedTicket ? 'View live board' : 'Rebook later'} actionIcon={arrival.linkedTicket ? <Ticket className="h-4 w-4" /> : <TimerReset className="h-4 w-4" />} actionHref={arrival.linkedTicket ? '/admin/queue' : undefined} isPending={isPending} />
            ))}
          </BoardSection>
        </div>

        <div className="space-y-6">
          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Next arrivals</p>
            <div className="mt-4 space-y-3">
              {upcomingMoments.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">Nothing else is scheduled on this date.</div>
              ) : (
                upcomingMoments.map((arrival) => (
                  <div key={arrival.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-slate-950">{arrival.customer_name}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {arrival.service?.name || 'General service'}
                          {arrival.department?.name ? ` · ${arrival.department.name}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-900">{formatClock(arrival.scheduled_at)}</p>
                        <p className="mt-1 text-xs text-slate-500">{isToday ? formatRelative(arrival.scheduled_at) : formatDateLabel(arrival.scheduled_at)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Service mix</p>
            <div className="mt-4 space-y-3">
              {serviceMixEntries.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-10 text-center text-sm text-slate-400">No active scheduled mix for this date.</div>
              ) : (
                serviceMixEntries.slice(0, 5).map(([serviceName, count]) => (
                  <div key={serviceName} className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm">
                    <span className="font-medium text-slate-900">{serviceName}</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{count}</span>
                  </div>
                ))
              )}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">{copy.playbookTitle}</p>
            <div className="mt-4 space-y-3">
              {copy.playbookItems.map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">{item}</div>
              ))}
            </div>
            <Link href="/admin/queue" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#10292f] transition hover:text-[#18383f]">
              Open command center
              <Ticket className="h-4 w-4" />
            </Link>
          </aside>
        </div>
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-2xl rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(20,27,26,0.12)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">{copy.createTitle}</h2>
                <p className="mt-2 text-sm leading-7 text-slate-600">Capture the customer, service, and slot once. Check-in will hand the visit directly into live operations.</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700">
                <XCircle className="h-4 w-4" />
              </button>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreate}>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={t.office}>
                  <select value={form.officeId} onChange={(event) => handleFormChange('officeId', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]">
                    {offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </select>
                </Field>
                <Field label={t.department}>
                  <select value={form.departmentId} onChange={(event) => handleFormChange('departmentId', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]">
                    {formDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                  </select>
                </Field>
                <Field label="Service">
                  <select value={form.serviceId} onChange={(event) => handleFormChange('serviceId', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]">
                    {formServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                  </select>
                </Field>
                <Field label={t.customer}>
                  <input value={form.customerName} onChange={(event) => handleFormChange('customerName', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]" placeholder={`${t.customer} name`} />
                </Field>
                <Field label="Phone">
                  <input value={form.customerPhone} onChange={(event) => handleFormChange('customerPhone', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]" placeholder="Optional" />
                </Field>
                <Field label="Email">
                  <input value={form.customerEmail} onChange={(event) => handleFormChange('customerEmail', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]" placeholder="Optional" />
                </Field>
                <Field label="Date">
                  <input type="date" value={form.date} onChange={(event) => handleFormChange('date', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]" />
                </Field>
                <Field label="Time">
                  <input type="time" value={form.time} onChange={(event) => handleFormChange('time', event.target.value)} className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]" />
                </Field>
              </div>

              <div className="rounded-[24px] border border-[#d9ebe7] bg-[#f0f6f5] px-4 py-4 text-sm text-[#35525a]">
                The live command center takes over after check-in. Use this board for the schedule, then operate the visit from `/admin/queue`.
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowCreate(false)} className="flex-1 rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">Cancel</button>
                <button type="submit" disabled={isPending} className="flex-1 rounded-full bg-[#10292f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:bg-slate-300">
                  {isPending ? 'Saving...' : copy.primaryLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <ToastContainer toasts={toasts} />
    </div>
  );
}

function BoardSection({
  title,
  body,
  emptyTitle,
  emptyBody,
  children,
}: {
  title: string;
  body: string;
  emptyTitle: string;
  emptyBody: string;
  children: ReactNode;
}) {
  const childCount = Array.isArray(children) ? children.length : children ? 1 : 0;

  return (
    <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-7 text-slate-500">{body}</p>
      </div>

      <div className="mt-5 space-y-4">
        {childCount === 0 ? (
          <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center">
            <p className="text-base font-semibold text-slate-900">{emptyTitle}</p>
            <p className="mt-2 text-sm text-slate-500">{emptyBody}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function ArrivalCard({
  arrival,
  actionLabel,
  actionIcon,
  actionHref,
  onAction,
  onCancel,
  isPending,
}: {
  arrival: ScheduledArrival;
  actionLabel: string;
  actionIcon: ReactNode;
  actionHref?: string;
  onAction?: () => void;
  onCancel?: () => void;
  isPending: boolean;
}) {
  const badge = getTicketBadge(arrival.linkedTicket?.status || arrival.status);
  const deskName = arrival.linkedTicket?.desk?.display_name || arrival.linkedTicket?.desk?.name || null;

  return (
    <article className="rounded-[26px] border border-slate-200 bg-[#fbfaf8] p-4 shadow-[0_10px_20px_rgba(20,27,26,0.03)]">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge}`}>{getTicketLabel(arrival)}</span>
            {arrival.linkedTicket?.ticket_number ? (
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                {arrival.linkedTicket.ticket_number}
              </span>
            ) : null}
          </div>

          <h3 className="mt-3 text-lg font-semibold text-slate-950">{arrival.customer_name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4" />
              {formatDateLabel(arrival.scheduled_at)} at {formatClock(arrival.scheduled_at)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 className="h-4 w-4" />
              {formatRelative(arrival.scheduled_at)}
            </span>
            {arrival.office?.name ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" />
                {arrival.office.name}
              </span>
            ) : null}
          </div>
        </div>

        {actionHref ? (
          <Link href={actionHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]">
            {actionIcon}
            {actionLabel}
          </Link>
        ) : onAction ? (
          <button type="button" onClick={onAction} disabled={isPending} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:bg-slate-300">
            {actionIcon}
            {actionLabel}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <InfoPill label="Service" value={arrival.service?.name || 'General service'} />
        <InfoPill label="Department" value={arrival.department?.name || '--'} />
        <InfoPill label="Desk / station" value={deskName || 'Not assigned yet'} />
      </div>

      {(arrival.customer_phone || arrival.customer_email || onCancel) ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 text-sm text-slate-500">
          <div className="flex flex-wrap items-center gap-4">
            {arrival.customer_phone ? <span>{arrival.customer_phone}</span> : null}
            {arrival.customer_email ? <span>{arrival.customer_email}</span> : null}
          </div>

          {onCancel ? (
            <button type="button" onClick={onCancel} disabled={isPending} className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
              <XCircle className="h-4 w-4" />
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function SummaryCard({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-white/8 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-1 text-sm text-white/65">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_24px_rgba(20,27,26,0.04)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}

function ToastContainer({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className={`rounded-2xl px-4 py-3 text-sm font-medium shadow-lg ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

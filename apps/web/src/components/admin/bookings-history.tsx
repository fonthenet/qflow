'use client';

import { useMemo } from 'react';
import { CalendarClock, Clock3, Ticket, Users } from 'lucide-react';
import { buildBookingCheckInPath, buildBookingPath } from '@/lib/office-links';
import { useI18n } from '@/components/providers/locale-provider';
import { PublicLinkActions } from './public-link-actions';

interface Office {
  id: string;
  name: string;
  is_active: boolean;
  settings?: Record<string, unknown> | null;
}

interface Service {
  id: string;
  name: string;
  code: string;
  department_id: string;
  is_active: boolean;
  sort_order: number | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
  office_id: string;
  is_active: boolean;
  sort_order: number | null;
  services: Service[];
}

interface AppointmentTicket {
  id: string;
  ticket_number: string;
  qr_token: string;
  status: string | null;
}

interface AppointmentRecord {
  id: string;
  office_id: string;
  department_id: string;
  service_id: string;
  staff_id?: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  created_at: string | null;
  status: string | null;
  ticket_id: string | null;
  calendar_token?: string | null;
  ticket?: AppointmentTicket | null;
}

interface BookingsHistoryProps {
  offices: Office[];
  departments: Department[];
  appointments: AppointmentRecord[];
}

function getStatusClasses(status: string | null) {
  switch (status) {
    case 'checked_in':
      return 'bg-emerald-50 text-emerald-700';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700';
    case 'confirmed':
      return 'bg-sky-50 text-sky-700';
    case 'served':
      return 'bg-indigo-50 text-indigo-700';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

export function BookingsHistory({
  offices,
  departments,
  appointments,
}: BookingsHistoryProps) {
  const { t, formatDateTime } = useI18n();
  const activeOffices = offices.filter((office) => office.is_active);
  const totalAppointments = appointments.length;
  const pendingAppointments = appointments.filter((entry) =>
    ['pending', 'confirmed'].includes(entry.status ?? 'pending')
  ).length;
  const checkedInAppointments = appointments.filter((entry) => entry.status === 'checked_in').length;
  const cancelledAppointments = appointments.filter((entry) => entry.status === 'cancelled').length;

  // Flatten all appointments for the history table
  const allAppointmentRows = useMemo(() => {
    const deptMap = new Map(departments.map((d) => [d.id, d]));
    const officeMap = new Map(offices.map((o) => [o.id, o]));
    return appointments
      .map((a) => {
        const dept = deptMap.get(a.department_id);
        const service = dept?.services?.find((s) => s.id === a.service_id);
        return { ...a, departmentName: dept?.name, departmentCode: dept?.code, serviceName: service?.name, serviceCode: service?.code, officeName: officeMap.get(a.office_id)?.name };
      })
      .sort((a, b) => new Date(b.scheduled_at).getTime() - new Date(a.scheduled_at).getTime());
  }, [appointments, departments, offices]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Appointments')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('Booking history, links, and QR codes.')}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">{t('Total')} <span className="font-semibold text-foreground">{totalAppointments}</span></span>
          <span className="text-muted-foreground">{t('Pending')} <span className="font-semibold text-amber-600">{pendingAppointments}</span></span>
          <span className="text-muted-foreground">{t('Checked in')} <span className="font-semibold text-emerald-600">{checkedInAppointments}</span></span>
        </div>
      </div>

      {/* ── 1. Booking Links ── */}
      {activeOffices.length > 0 ? (
        <section className="rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-sm font-semibold text-foreground">{t('Booking Links')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('Share links or QR codes so customers can book online.')}</p>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_300px] items-center gap-4 border-b border-border bg-muted/30 px-6 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Link')}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground text-right">{t('Actions')}</span>
          </div>

          <div className="divide-y divide-border">
            {activeOffices.map((office) => {
              const officeDepartments = departments
                .filter((d) => d.office_id === office.id && d.is_active)
                .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
              const compactBtn = 'rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted whitespace-nowrap';

              return (
                <div key={office.id} className="divide-y divide-border/50">
                  {/* Office booking link */}
                  <div className="grid grid-cols-[1fr_300px] items-center gap-4 px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{office.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t('Booking page')}</p>
                    </div>
                    <div className="flex justify-end">
                      <PublicLinkActions
                        path={buildBookingPath(office)}
                        qrTitle={t('{name} booking page', { name: office.name })}
                        qrDescription={t('Scan to book an appointment for this office.')}
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-office-booking.png`}
                        buttonClassName={compactBtn}
                      />
                    </div>
                  </div>

                  {/* Office check-in link */}
                  <div className="grid grid-cols-[1fr_300px] items-center gap-4 px-6 py-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{office.name}</p>
                      <p className="text-[11px] text-muted-foreground">{t('Arrival check-in')}</p>
                    </div>
                    <div className="flex justify-end">
                      <PublicLinkActions
                        path={buildBookingCheckInPath(office)}
                        qrTitle={t('{name} appointment check-in', { name: office.name })}
                        qrDescription={t('Scan to look up and check in an appointment.')}
                        downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-office-checkin.png`}
                        buttonClassName={compactBtn}
                      />
                    </div>
                  </div>

                  {/* Department links */}
                  {officeDepartments.map((department) => {
                    const activeServices = (department.services ?? [])
                      .filter((s) => s.is_active)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

                    return [
                      <div key={`dept-${department.id}`} className="grid grid-cols-[1fr_300px] items-center gap-4 bg-muted/20 px-6 py-3">
                        <div className="flex items-center gap-2 pl-3">
                          <p className="text-sm font-medium text-foreground">{department.name}</p>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{department.code}</span>
                        </div>
                        <div className="flex justify-end">
                          <PublicLinkActions
                            path={buildBookingPath(office, { departmentId: department.id })}
                            qrTitle={t('{office} {department} booking', { office: office.name, department: department.name })}
                            qrDescription={t('Scan to open booking directly in this department.')}
                            downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-${department.code.toLowerCase()}-booking.png`}
                            buttonClassName={compactBtn}
                          />
                        </div>
                      </div>,
                      ...activeServices.map((service) => (
                        <div key={`svc-${service.id}`} className="grid grid-cols-[1fr_300px] items-center gap-4 bg-muted/10 px-6 py-2.5">
                          <div className="flex items-center gap-2 pl-7">
                            <p className="text-sm text-foreground">{service.name}</p>
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{service.code}</span>
                          </div>
                          <div className="flex justify-end">
                            <PublicLinkActions
                              path={buildBookingPath(office, { departmentId: department.id, serviceId: service.id })}
                              qrTitle={t('{office} {service} booking', { office: office.name, service: service.name })}
                              qrDescription={t('Scan to book directly into this service category.')}
                              downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-${service.code.toLowerCase()}-booking.png`}
                              buttonClassName={compactBtn}
                            />
                          </div>
                        </div>
                      )),
                    ];
                  })}

                  {officeDepartments.length === 0 ? (
                    <div className="px-6 py-3 pl-9 text-xs text-muted-foreground">
                      {t('Add departments and services to create direct booking links.')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground shadow-sm">
          {t('No active offices. Add an office to enable booking links.')}
        </section>
      )}

      {/* ── 2. Recent Appointments ── */}
      <section className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Recent Appointments')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('Last 50 bookings across all offices.')}</p>
        </div>

        {allAppointmentRows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3">{t('No appointments yet.')}</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {allAppointmentRows.slice(0, 50).map((appointment) => (
              <div key={appointment.id} className="flex items-center gap-4 px-6 py-3.5">
                {/* Customer info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{appointment.customer_name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusClasses(appointment.status)}`}>
                      {t((appointment.status ?? 'pending').replace(/_/g, ' '))}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="h-3 w-3" />
                      {formatDateTime(appointment.scheduled_at, { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {appointment.customer_phone ? (
                      <span>{appointment.customer_phone}</span>
                    ) : null}
                  </div>
                </div>

                {/* Service tag */}
                <div className="hidden sm:flex shrink-0 flex-col items-end gap-1 text-right">
                  {appointment.serviceName ? (
                    <span className="text-xs text-muted-foreground">{appointment.serviceName}</span>
                  ) : null}
                  {appointment.departmentCode ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{appointment.departmentCode}</span>
                  ) : null}
                </div>

                {/* Ticket badge */}
                {appointment.ticket ? (
                  <div className="shrink-0 rounded-lg bg-muted px-2.5 py-1.5 text-xs font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Ticket className="h-3 w-3" />
                      {appointment.ticket.ticket_number}
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

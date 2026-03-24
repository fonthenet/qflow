'use client';

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
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  scheduled_at: string;
  created_at: string | null;
  status: string | null;
  ticket_id: string | null;
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

  return (
    <div className="space-y-6 p-6">
      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">{t('Bookings')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {t('Review recent appointment history by category and share the right booking link or QR code for each service.')}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('Recent bookings')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{totalAppointments}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('Pending')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{pendingAppointments}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('Checked in')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{checkedInAppointments}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('Cancelled')}
              </p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{cancelledAppointments}</p>
            </div>
          </div>
        </div>
      </section>

      {activeOffices.map((office) => {
        const officeDepartments = departments
          .filter((department) => department.office_id === office.id && department.is_active)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const officeAppointments = appointments.filter((entry) => entry.office_id === office.id);

        return (
          <section key={office.id} className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-foreground">{office.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('{count} recent appointment(s) across all booking categories.', {
                    count: officeAppointments.length,
                  })}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="font-medium text-foreground">{t('Office booking page')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('Share when the customer should choose a department and service themselves.')}
                  </p>
                  <div className="mt-4">
                    <PublicLinkActions
                      path={buildBookingPath(office)}
                      qrTitle={t('{name} booking page', { name: office.name })}
                      qrDescription={t('Scan to book an appointment for this office.')}
                      downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-office-booking.png`}
                    />
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <p className="font-medium text-foreground">{t('Office arrival check-in')}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('Share when customers need to find an existing appointment and check in.')}
                  </p>
                  <div className="mt-4">
                    <PublicLinkActions
                      path={buildBookingCheckInPath(office)}
                      qrTitle={t('{name} appointment check-in', { name: office.name })}
                      qrDescription={t('Scan to look up and check in an appointment.')}
                      downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-office-checkin.png`}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              {officeDepartments.map((department) => {
                const departmentAppointments = officeAppointments.filter(
                  (entry) => entry.department_id === department.id
                );

                return (
                  <div key={department.id} className="rounded-2xl border border-border bg-background p-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold text-foreground">{department.name}</h3>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                            {department.code}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('{count} recent booking(s) in this department.', {
                            count: departmentAppointments.length,
                          })}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-border p-4">
                        <p className="font-medium text-foreground">{t('Department booking page')}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('Start inside this department, then let the customer choose the service.')}
                        </p>
                        <div className="mt-4">
                          <PublicLinkActions
                            path={buildBookingPath(office, { departmentId: department.id })}
                            qrTitle={t('{office} {department} booking', {
                              office: office.name,
                              department: department.name,
                            })}
                            qrDescription={t('Scan to open booking directly in this department.')}
                            downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-${department.code.toLowerCase()}-booking.png`}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 xl:grid-cols-2">
                      {department.services
                        ?.filter((service) => service.is_active)
                        ?.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                        .map((service) => {
                          const serviceAppointments = departmentAppointments.filter(
                            (entry) => entry.service_id === service.id
                          );
                          const servicePendingCount = serviceAppointments.filter((entry) =>
                            ['pending', 'confirmed'].includes(entry.status ?? 'pending')
                          ).length;
                          const serviceCheckedInCount = serviceAppointments.filter(
                            (entry) => entry.status === 'checked_in'
                          ).length;

                          return (
                            <div key={service.id} className="rounded-2xl border border-border p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="font-semibold text-foreground">{service.name}</h4>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                      {service.code}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {t('Direct booking category for this service.')}
                                  </p>
                                </div>
                                <div className="flex gap-2 text-xs">
                                  <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">
                                    {t('{count} pending', { count: servicePendingCount })}
                                  </span>
                                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                                    {t('{count} checked in', { count: serviceCheckedInCount })}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-4 rounded-2xl border border-border bg-card p-4">
                                <p className="font-medium text-foreground">{t('Share booking link')}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {t('Customers land directly on this service when they open the link.')}
                                </p>
                                <div className="mt-4">
                                  <PublicLinkActions
                                    path={buildBookingPath(office, {
                                      departmentId: department.id,
                                      serviceId: service.id,
                                    })}
                                    qrTitle={t('{office} {service} booking', {
                                      office: office.name,
                                      service: service.name,
                                    })}
                                    qrDescription={t('Scan to book directly into this service category.')}
                                    downloadName={`${office.name.toLowerCase().replace(/\s+/g, '-')}-${service.code.toLowerCase()}-booking.png`}
                                  />
                                </div>
                              </div>

                              <div className="mt-4">
                                <div className="flex items-center gap-2">
                                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                                  <p className="text-sm font-medium text-foreground">{t('Recent history')}</p>
                                </div>

                                {serviceAppointments.length === 0 ? (
                                  <div className="mt-3 rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                                    {t('No recent bookings for this category.')}
                                  </div>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {serviceAppointments.slice(0, 5).map((appointment) => (
                                      <div
                                        key={appointment.id}
                                        className="rounded-2xl border border-border bg-background px-4 py-3"
                                      >
                                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                                          <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="font-medium text-foreground">
                                                {appointment.customer_name}
                                              </p>
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClasses(
                                                  appointment.status
                                                )}`}
                                              >
                                                {t((appointment.status ?? 'pending').replace(/_/g, ' '))}
                                              </span>
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
                                              <span className="inline-flex items-center gap-1.5">
                                                <Clock3 className="h-4 w-4" />
                                  {formatDateTime(appointment.scheduled_at, {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  })}
                                              </span>
                                              {appointment.customer_phone ? (
                                                <span className="inline-flex items-center gap-1.5">
                                                  <Users className="h-4 w-4" />
                                                  {appointment.customer_phone}
                                                </span>
                                              ) : null}
                                            </div>
                                          </div>

                                          {appointment.ticket ? (
                                            <div className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
                                              <span className="inline-flex items-center gap-1.5">
                                                <Ticket className="h-4 w-4" />
                                                {t('Ticket {number}', { number: appointment.ticket.ticket_number })}
                                              </span>
                                            </div>
                                          ) : null}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}

              {officeDepartments.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-background px-4 py-5 text-sm text-muted-foreground">
                  {t('Add departments and services to create shareable booking categories for this office.')}
                </div>
              ) : null}
            </div>
          </section>
        );
      })}

      {activeOffices.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          {t('There are no active offices yet, so booking categories and public QR links are not available.')}
        </section>
      ) : null}
    </div>
  );
}

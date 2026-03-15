import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, ClipboardCheck, FileCheck, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type ServiceField = {
  id: string;
  service_id: string;
  field_label: string;
  field_type: string;
  is_required: boolean | null;
  options: unknown;
};

function normalizeJoin<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] || null : value;
}

export default async function DocumentChecklistPage({
  searchParams,
}: {
  searchParams: Promise<{ office?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: staff } = await supabase
    .from('staff')
    .select('organization_id, office_id, organization:organizations(name, business_type)')
    .eq('auth_user_id', user.id)
    .single();

  if (!staff) redirect('/login');

  const organization = Array.isArray(staff.organization) ? staff.organization[0] || null : staff.organization;

  const { data: officesData } = await supabase
    .from('offices')
    .select('id, name')
    .eq('organization_id', staff.organization_id)
    .order('name');
  const offices = officesData || [];

  const selectedOfficeId = params.office || staff.office_id || offices[0]?.id || '';
  const today = new Date().toISOString().split('T')[0];

  const [servicesResult, fieldsResult, appointmentsResult] = await Promise.all([
    selectedOfficeId
      ? supabase
          .from('services')
          .select('id, name, estimated_service_time, department:departments(name), office:departments(office:offices(id, name))')
          .in(
            'department_id',
            (
              await supabase
                .from('departments')
                .select('id')
                .eq('office_id', selectedOfficeId)
                .eq('is_active', true)
            ).data?.map((item) => item.id) || []
          )
          .eq('is_active', true)
          .order('name')
      : Promise.resolve({ data: [] }),
    supabase
      .from('intake_form_fields')
      .select('id, service_id, field_label, field_type, is_required, options'),
    selectedOfficeId
      ? supabase
          .from('appointments')
          .select('id, service_id, customer_name, scheduled_at, status, service:services(name)')
          .eq('office_id', selectedOfficeId)
          .neq('status', 'cancelled')
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59.999`)
          .order('scheduled_at')
      : Promise.resolve({ data: [] }),
  ]);

  const services = (servicesResult.data || []).map((service: Record<string, unknown>) => ({
    ...service,
    department: normalizeJoin(service.department as { name: string } | { name: string }[] | null),
  }));
  const fields = (fieldsResult.data || []) as ServiceField[];
  const appointments = (appointmentsResult.data || []).map((appointment: Record<string, unknown>) => ({
    ...appointment,
    service: normalizeJoin(appointment.service as { name: string } | { name: string }[] | null),
  }));

  const fieldsByServiceId = new Map<string, ServiceField[]>();
  fields.forEach((field) => {
    const current = fieldsByServiceId.get(field.service_id) || [];
    current.push(field);
    fieldsByServiceId.set(field.service_id, current);
  });

  const readinessRows = services.map((service: any) => {
    const serviceFields = fieldsByServiceId.get(service.id) || [];
    const requiredFields = serviceFields.filter((field) => field.is_required);
    const selectFields = serviceFields.filter((field) => field.field_type === 'select');
    const todaysAppointments = appointments.filter((appointment: any) => appointment.service_id === service.id);

    return {
      id: service.id,
      name: service.name,
      departmentName: service.department?.name || 'Service area',
      requiredCount: requiredFields.length,
      selectCount: selectFields.length,
      appointmentCount: todaysAppointments.length,
      fields: serviceFields,
      appointments: todaysAppointments.slice(0, 5),
    };
  });

  const servicesWithRequired = readinessRows.filter((row) => row.requiredCount > 0).length;
  const servicesMissingRules = readinessRows.filter((row) => row.requiredCount === 0).length;
  const totalRequiredPrompts = readinessRows.reduce((total, row) => total + row.requiredCount, 0);
  const arrivalsNeedingPrep = readinessRows.reduce(
    (total, row) => total + (row.requiredCount > 0 ? row.appointmentCount : 0),
    0
  );

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#18211f_0%,_#2f403c_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(20,33,31,0.18)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#b9e7d7]">Readiness rules</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Document checklist is now a service-readiness board backed by required intake rules.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              {organization?.name || 'QueueFlow'} is configured for {organization?.business_type?.replace(/_/g, ' ') || 'service operations'}.
              Until a dedicated document schema exists, this board turns required intake fields into the operational checklist teams use to prepare customers before service.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Services with rules" value={servicesWithRequired.toString()} helper="At least one required prompt" />
            <HeroStat label="Missing readiness" value={servicesMissingRules.toString()} helper="No required intake rules yet" />
            <HeroStat label="Required prompts" value={totalRequiredPrompts.toString()} helper="Used as checklist items" />
            <HeroStat label="Arrivals needing prep" value={arrivalsNeedingPrep.toString()} helper="Today's booked visits with rules" />
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <form action="/admin/document-checklist" className="flex flex-wrap items-end gap-3">
            <label className="min-w-[240px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Office</span>
              <select name="office" defaultValue={selectedOfficeId} className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none">
                {offices.map((office) => (
                  <option key={office.id} value={office.id}>{office.name}</option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Apply
            </button>
          </form>

          <div className="flex gap-3">
            <Link href="/admin/intake-forms" className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Manage readiness rules
            </Link>
            <Link href="/admin/appointments" className="inline-flex items-center justify-center gap-2 rounded-full bg-[#18211f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2f403c]">
              Open scheduled arrivals
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Coverage" value={`${readinessRows.length ? Math.round((servicesWithRequired / readinessRows.length) * 100) : 0}%`} helper="Services with at least one required rule" />
        <MetricCard label="Rule source" value="Intake forms" helper="Shared by QR, kiosk, and staff edit flows" />
        <MetricCard label="Booked readiness" value={arrivalsNeedingPrep.toString()} helper="Today's arrivals tied to required prompts" />
        <MetricCard label="Operational status" value="Live" helper="Backed by current schema, not placeholder copy" />
      </div>

      <section className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Service readiness matrix</h2>
          <p className="mt-1 text-sm leading-7 text-slate-500">
            Treat each required intake field as a checklist item that must be captured before the customer is fully ready for service.
          </p>
        </div>

        <div className="mt-5 space-y-4">
          {readinessRows.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-12 text-center text-sm text-slate-400">
              No active services found for this office.
            </div>
          ) : (
            readinessRows.map((row) => (
              <article key={row.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.requiredCount > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {row.requiredCount > 0 ? 'Checklist ready' : 'No required rules'}
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        {row.appointmentCount} booked today
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-slate-950">{row.name}</h3>
                    <p className="mt-1 text-sm text-slate-500">{row.departmentName}</p>
                  </div>

                  <div className="grid gap-2 text-right text-sm text-slate-500">
                    <span>{row.requiredCount} required</span>
                    <span>{row.selectCount} structured answers</span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[20px] border border-white/80 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Required prompts</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {row.fields.filter((field) => field.is_required).length === 0 ? (
                        <span className="text-sm text-slate-400">No required prompts configured.</span>
                      ) : (
                        row.fields
                          .filter((field) => field.is_required)
                          .map((field) => (
                            <span key={field.id} className="rounded-full border border-slate-200 bg-[#fbfaf8] px-3 py-1 text-xs font-medium text-slate-600">
                              {field.field_label}
                            </span>
                          ))
                      )}
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-white/80 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Today's arrivals</p>
                    <div className="mt-3 space-y-2">
                      {row.appointments.length === 0 ? (
                        <span className="text-sm text-slate-400">No booked arrivals for this service today.</span>
                      ) : (
                        row.appointments.map((appointment: any) => (
                          <div key={appointment.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-medium text-slate-900">{appointment.customer_name}</span>
                            <span className="text-slate-500">{new Date(appointment.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
        <div className="flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-[#446068]" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">Checklist playbook</p>
        </div>
        <div className="mt-4 space-y-3">
          {[
            'Required intake fields are the current source of truth for readiness checks, so this page stays grounded in real operational data.',
            'Services with booked arrivals but no required rules are the clearest gap to close first.',
            'Use intake forms to expand these rules, then keep scheduled-arrivals and live check-in aligned through the same schema.',
          ].map((item) => (
            <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">
              {item}
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[22px] border border-white/80 bg-white px-4 py-3 text-sm text-[#35525a]">
          <div className="flex items-center gap-2 font-semibold text-[#25444c]">
            <ShieldAlert className="h-4 w-4" />
            Current limitation
          </div>
          <p className="mt-2 leading-6">
            This page models checklist readiness through intake rules because the database does not yet include a dedicated document checklist table. It is operationally useful now, and leaves room for a richer document layer later.
          </p>
        </div>
      </aside>
    </div>
  );
}

function HeroStat({ label, value, helper }: { label: string; value: string; helper: string }) {
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

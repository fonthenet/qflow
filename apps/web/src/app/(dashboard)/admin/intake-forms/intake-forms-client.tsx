'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ClipboardList,
  ListFilter,
  Pencil,
  Plus,
  Rows3,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  createIntakeFormField,
  deleteIntakeFormField,
  updateIntakeFormField,
} from '@/lib/actions/admin-actions';
import { useTerminology } from '@/lib/terminology-context';

type IntakeField = {
  id: string;
  service_id: string;
  field_label: string;
  field_name: string;
  field_type: string;
  is_required: boolean | null;
  options: unknown;
  sort_order: number | null;
  created_at: string | null;
};

type ServiceRecord = {
  id: string;
  name: string;
  department_id: string;
  estimated_service_time: number | null;
  department:
    | {
        id: string;
        name: string;
        office: { id: string; name: string } | { id: string; name: string }[] | null;
      }
    | {
        id: string;
        name: string;
        office: { id: string; name: string } | { id: string; name: string }[] | null;
      }[]
    | null;
};

type FormState = {
  serviceId: string;
  fieldLabel: string;
  fieldName: string;
  fieldType: string;
  sortOrder: string;
  options: string;
  isRequired: boolean;
};

const FIELD_TYPE_OPTIONS = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select list' },
  { value: 'checkbox', label: 'Checkbox' },
];

function normalizeOffice(
  value: ServiceRecord['department']
): { id: string; name: string } | null {
  if (!value) return null;
  const department = Array.isArray(value) ? value[0] || null : value;
  if (!department?.office) return null;
  return Array.isArray(department.office) ? department.office[0] || null : department.office;
}

function normalizeDepartment(
  value: ServiceRecord['department']
): { id: string; name: string; office: { id: string; name: string } | null } | null {
  if (!value) return null;
  const department = Array.isArray(value) ? value[0] || null : value;
  if (!department) return null;
  return {
    id: department.id,
    name: department.name,
    office: normalizeOffice(value),
  };
}

function toOptionsString(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.filter((item) => typeof item === 'string').join('\n');
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildInitialState(serviceId: string): FormState {
  return {
    serviceId,
    fieldLabel: '',
    fieldName: '',
    fieldType: 'text',
    sortOrder: '',
    options: '',
    isRequired: true,
  };
}

export function IntakeFormsClient({
  fields,
  services,
  currentServiceFilter,
}: {
  fields: IntakeField[];
  services: ServiceRecord[];
  currentServiceFilter: string;
}) {
  const t = useTerminology();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<IntakeField | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<FormState>(() =>
    buildInitialState(currentServiceFilter || services[0]?.id || '')
  );

  const normalizedServices = useMemo(
    () =>
      services.map((service) => {
        const department = normalizeDepartment(service.department);
        return {
          ...service,
          department,
        };
      }),
    [services]
  );

  const serviceMap = useMemo(
    () => new Map(normalizedServices.map((service) => [service.id, service])),
    [normalizedServices]
  );

  const totalServicesWithForms = new Set(fields.map((field) => field.service_id)).size;
  const requiredFields = fields.filter((field) => field.is_required).length;
  const selectFields = fields.filter((field) => field.field_type === 'select').length;

  const groupedFields = normalizedServices
    .filter((service) => !currentServiceFilter || service.id === currentServiceFilter)
    .map((service) => ({
      service,
      fields: fields
        .filter((field) => field.service_id === service.id)
        .sort((left, right) => (left.sort_order ?? 999) - (right.sort_order ?? 999)),
    }))
    .filter((group) => currentServiceFilter || group.fields.length > 0);

  function handleFilterChange(value: string) {
    const params = new URLSearchParams();
    if (value) params.set('service', value);
    router.push(`/admin/intake-forms${params.toString() ? `?${params.toString()}` : ''}`);
  }

  function openCreate() {
    setEditing(null);
    setError(null);
    setFormState(buildInitialState(currentServiceFilter || services[0]?.id || ''));
    setShowModal(true);
  }

  function openEdit(field: IntakeField) {
    setEditing(field);
    setError(null);
    setFormState({
      serviceId: field.service_id,
      fieldLabel: field.field_label,
      fieldName: field.field_name,
      fieldType: field.field_type,
      sortOrder: field.sort_order?.toString() || '',
      options: toOptionsString(field.options),
      isRequired: !!field.is_required,
    });
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateIntakeFormField(editing.id, formData)
        : await createIntakeFormField(formData);

      if (result?.error) {
        setError(result.error);
        return;
      }

      setShowModal(false);
      setEditing(null);
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this intake field?')) return;
    startTransition(async () => {
      const result = await deleteIntakeFormField(id);
      if (result?.error) setError(result.error);
    });
  }

  const previewService = serviceMap.get(formState.serviceId);

  return (
    <div className="space-y-6">
      <section className="rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,_#10292f_0%,_#173740_100%)] px-6 py-6 text-white shadow-[0_24px_70px_rgba(10,26,31,0.14)] sm:px-8 sm:py-8">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#8de2d5]">Pre-arrival capture</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
              Intake forms now shape the visit before the {t.customer.toLowerCase()} reaches the live board.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/72">
              Configure fields per service so scheduled arrivals, kiosk check-in, and remote joins all collect the right information before staff starts service.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <HeroStat label="Fields live" value={fields.length.toString()} helper="Across every configured service" />
            <HeroStat label="Services covered" value={totalServicesWithForms.toString()} helper="At least one field attached" />
            <HeroStat label="Required prompts" value={requiredFields.toString()} helper="Must be completed at check-in" />
            <HeroStat label="Select workflows" value={selectFields.toString()} helper="Uses predefined answer options" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="Form builders" value={normalizedServices.length.toString()} helper="Active services ready for configuration" />
        <MetricCard label="Reusable schema" value="1 source" helper="Public check-in and staff edits share the same fields" />
        <MetricCard label="Required coverage" value={`${fields.length ? Math.round((requiredFields / fields.length) * 100) : 0}%`} helper="Share of prompts marked required" />
        <MetricCard label="Customer prep" value="Faster" helper="Collect details before the live handoff" />
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-[0_14px_30px_rgba(20,27,26,0.04)] md:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[260px]">
              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Service filter</span>
              <select
                value={currentServiceFilter}
                onChange={(event) => handleFilterChange(event.target.value)}
                className="w-full rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-[#10292f]"
              >
                <option value="">All services with forms</option>
                {normalizedServices.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                    {service.department ? ` - ${service.department.name}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-[#fbfaf8] px-4 py-2.5 text-sm text-slate-600">
              <ListFilter className="h-4 w-4 text-slate-400" />
              Fields render in kiosk, QR, and customer edit flows automatically.
            </div>
          </div>

          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[#10292f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18383f]"
          >
            <Plus className="h-4 w-4" />
            Add field
          </button>
        </div>
      </section>

      {error ? (
        <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          {groupedFields.length === 0 ? (
            <div className="rounded-[30px] border border-slate-200 bg-white p-10 text-center shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
              <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
              <h2 className="mt-4 text-lg font-semibold text-slate-950">No intake fields configured yet</h2>
              <p className="mt-2 text-sm leading-7 text-slate-500">
                Start with the services that need identity checks, symptom capture, consent, document readiness, or any other pre-service information.
              </p>
            </div>
          ) : (
            groupedFields.map(({ service, fields: serviceFields }) => (
              <section key={service.id} className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      {service.department?.office?.name || 'Workspace'} · {service.department?.name || 'Service'}
                    </p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-950">{service.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {serviceFields.length} field{serviceFields.length === 1 ? '' : 's'} · {service.estimated_service_time ? `${service.estimated_service_time} min service target` : 'No duration set'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFormState((current) => ({ ...buildInitialState(service.id), fieldType: current.fieldType }));
                      setEditing(null);
                      setError(null);
                      setShowModal(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                  >
                    <Plus className="h-4 w-4" />
                    Add to this service
                  </button>
                </div>

                <div className="mt-5 space-y-3">
                  {serviceFields.length === 0 ? (
                    <div className="rounded-[22px] border border-dashed border-slate-200 bg-[#fbfaf8] px-4 py-8 text-center text-sm text-slate-400">
                      No fields configured for this service yet.
                    </div>
                  ) : (
                    serviceFields.map((field) => (
                      <article key={field.id} className="rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
                        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                {field.field_type}
                              </span>
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                Order {field.sort_order ?? 'auto'}
                              </span>
                              {field.is_required ? (
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                                  Required
                                </span>
                              ) : (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                                  Optional
                                </span>
                              )}
                            </div>
                            <h3 className="mt-3 text-lg font-semibold text-slate-950">{field.field_label}</h3>
                            <p className="mt-1 font-mono text-xs text-slate-500">{field.field_name}</p>
                            {field.field_type === 'select' && Array.isArray(field.options) ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {field.options.filter((option) => typeof option === 'string').map((option) => (
                                  <span key={option as string} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                                    {option as string}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(field)}
                              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(field.id)}
                              disabled={isPending}
                              className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ))
          )}
        </div>

        <div className="space-y-6">
          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Builder preview</p>
            <div className="mt-4 rounded-[24px] border border-slate-200 bg-[#fbfaf8] p-4">
              <p className="text-sm font-semibold text-slate-950">{previewService?.name || 'Select a service'}</p>
              <p className="mt-1 text-sm text-slate-500">
                {previewService?.department?.office?.name || 'Workspace'}
                {previewService?.department ? ` · ${previewService.department.name}` : ''}
              </p>

              <div className="mt-4 rounded-[20px] border border-white/80 bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Preview field</p>
                <p className="mt-3 text-sm font-medium text-slate-900">
                  {formState.fieldLabel || 'Field label'}
                  {formState.isRequired ? <span className="ml-1 text-rose-500">*</span> : null}
                </p>
                <div className="mt-2 rounded-[16px] border border-slate-200 bg-[#fbfaf8] px-4 py-3 text-sm text-slate-400">
                  {formState.fieldType === 'select'
                    ? 'Select option'
                    : formState.fieldType === 'checkbox'
                      ? 'Checkbox control'
                      : `${FIELD_TYPE_OPTIONS.find((option) => option.value === formState.fieldType)?.label || 'Field'} input`}
                </div>
              </div>
            </div>
          </aside>

          <aside className="rounded-[30px] border border-[#d9ebe7] bg-[#f0f6f5] p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#446068]">Why this matters</p>
            <div className="mt-4 space-y-3">
              {[
                'Use per-service prompts so healthcare, banking, government, and hospitality teams can capture only what matters for that visit.',
                'The same schema powers public QR check-in and in-staff customer edits, which keeps data capture consistent across entry points.',
                'Required fields let you block incomplete arrivals before they hit the command center and slow down live service.',
              ].map((item) => (
                <div key={item} className="rounded-[20px] border border-white/80 bg-white px-4 py-3 text-sm leading-6 text-[#35525a]">
                  {item}
                </div>
              ))}
            </div>
          </aside>

          <aside className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_12px_24px_rgba(20,27,26,0.04)]">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Supported field types</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {FIELD_TYPE_OPTIONS.map((option) => (
                <span key={option.value} className="rounded-full border border-slate-200 bg-[#fbfaf8] px-3 py-1 text-xs font-medium text-slate-600">
                  {option.label}
                </span>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="w-full max-w-2xl rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_24px_48px_rgba(20,27,26,0.12)]" onClick={(event) => event.stopPropagation()}>
            <h2 className="text-2xl font-semibold text-slate-950">
              {editing ? 'Edit intake field' : 'Create intake field'}
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Configure what the {t.customer.toLowerCase()} must provide before joining the live service flow.
            </p>

            {error ? (
              <div className="mt-4 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <form action={handleSubmit} className="mt-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Service">
                  <select
                    name="service_id"
                    value={formState.serviceId}
                    onChange={(event) => setFormState((current) => ({ ...current, serviceId: event.target.value }))}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]"
                  >
                    {normalizedServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                        {service.department ? ` - ${service.department.name}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Field type">
                  <select
                    name="field_type"
                    value={formState.fieldType}
                    onChange={(event) => setFormState((current) => ({ ...current, fieldType: event.target.value }))}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]"
                  >
                    {FIELD_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Label">
                  <input
                    name="field_label"
                    value={formState.fieldLabel}
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        fieldLabel: event.target.value,
                        fieldName:
                          editing || current.fieldName
                            ? current.fieldName
                            : slugify(event.target.value),
                      }))
                    }
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]"
                    placeholder="Insurance provider"
                    required
                  />
                </Field>

                <Field label="Field key">
                  <input
                    name="field_name"
                    value={formState.fieldName}
                    onChange={(event) => setFormState((current) => ({ ...current, fieldName: slugify(event.target.value) }))}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 font-mono text-sm text-slate-700 outline-none focus:border-[#10292f]"
                    placeholder="insurance_provider"
                    required
                  />
                </Field>

                <Field label="Sort order">
                  <input
                    name="sort_order"
                    type="number"
                    min={1}
                    value={formState.sortOrder}
                    onChange={(event) => setFormState((current) => ({ ...current, sortOrder: event.target.value }))}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]"
                    placeholder="1"
                  />
                </Field>

                <label className="flex items-center gap-3 rounded-[18px] border border-slate-200 px-4 py-3">
                  <input
                    type="checkbox"
                    name="is_required"
                    value="true"
                    checked={formState.isRequired}
                    onChange={(event) => setFormState((current) => ({ ...current, isRequired: event.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-sm font-medium text-slate-700">Required at check-in</span>
                </label>
              </div>

              {formState.fieldType === 'select' ? (
                <Field label="Select options">
                  <textarea
                    name="options"
                    rows={4}
                    value={formState.options}
                    onChange={(event) => setFormState((current) => ({ ...current, options: event.target.value }))}
                    className="w-full rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none focus:border-[#10292f]"
                    placeholder={'Pending review\nApproved\nNeeds follow-up'}
                  />
                </Field>
              ) : (
                <input type="hidden" name="options" value="" />
              )}

              <div className="rounded-[24px] border border-[#d9ebe7] bg-[#f0f6f5] px-4 py-4 text-sm text-[#35525a]">
                Use stable field keys because stored customer data maps to these names across queue check-in, scheduled arrivals, and staff-side edits.
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-full border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-full bg-[#10292f] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#18383f] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {isPending ? 'Saving...' : editing ? 'Update field' : 'Create field'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

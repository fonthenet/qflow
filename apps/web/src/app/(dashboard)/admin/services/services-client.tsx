'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/components/providers/locale-provider';
import {
  createService,
  updateService,
  deleteService,
} from '@/lib/actions/admin-actions';

type Service = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  department_id: string;
  estimated_service_time: number | null;
  priority: number | null;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  department: {
    id: string;
    name: string;
    office: { id: string; name: string } | null;
  } | null;
};

type Department = {
  id: string;
  name: string;
  office: any;
};

export function ServicesClient({
  services,
  departments,
  currentDepartmentFilter,
}: {
  services: Service[];
  departments: Department[];
  currentDepartmentFilter: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(svc: Service) {
    setEditing(svc);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateService(editing.id, formData)
        : await createService(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm(t('Are you sure you want to delete this service?'))) return;
    startTransition(async () => {
      const result = await deleteService(id);
      if (result?.error) setError(result.error);
    });
  }

  function handleFilterChange(departmentId: string) {
    if (departmentId) {
      router.push(`/admin/services?department=${departmentId}`);
    } else {
      router.push('/admin/services');
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Services')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Set up the visit types and services customers can choose.')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('New Service')}
        </button>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <select
          value={currentDepartmentFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t('All Departments')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.office ? `(${d.office.name})` : ''}
            </option>
          ))}
        </select>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Name')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Code')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Department')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Est. Time')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Status')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {services.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('No services yet. Add a service so customers know what they can request.')}
                </td>
              </tr>
            )}
            {services.map((svc) => (
              <tr key={svc.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">{svc.name}</td>
                <td className="px-4 py-3">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {svc.code}
                  </code>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {svc.department?.name ?? '---'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {svc.estimated_service_time ? `${svc.estimated_service_time} min` : '---'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      svc.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {svc.is_active ? t('Active') : t('Inactive')}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(svc)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {t('Edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(svc.id)}
                      disabled={isPending}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      {t('Delete')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? t('Edit Service') : t('Create Service')}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Name')} <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Code')} <span className="text-destructive">*</span>
                </label>
                <input
                  name="code"
                  required
                  defaultValue={editing?.code ?? ''}
                  placeholder="e.g. SVC-001"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Description')}
                </label>
                <input
                  name="description"
                  defaultValue={editing?.description ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Department')} <span className="text-destructive">*</span>
                </label>
                <select
                  name="department_id"
                  required
                  defaultValue={editing?.department_id ?? currentDepartmentFilter ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('Select department...')}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.office ? `(${d.office.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    {t('Estimated time (min)')}
                  </label>
                  <input
                    name="estimated_service_time"
                    type="number"
                    min="1"
                    defaultValue={editing?.estimated_service_time ?? ''}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    {t('Priority')}
                  </label>
                  <input
                    name="priority"
                    type="number"
                    min="0"
                    defaultValue={editing?.priority ?? ''}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Sort Order')}
                </label>
                <input
                  name="sort_order"
                  type="number"
                  defaultValue={editing?.sort_order ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked={editing?.is_active ?? true}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-medium text-foreground">{t('Active')}</label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? t('Saving...') : editing ? t('Update') : t('Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

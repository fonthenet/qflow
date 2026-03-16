'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDesk, updateDesk, deleteDesk } from '@/lib/actions/admin-actions';

type Desk = {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string;
  current_staff_id: string | null;
  status: string | null;
  is_active: boolean | null;
  created_at: string | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  current_staff: { id: string; full_name: string } | null;
};

type Office = { id: string; name: string };
type Department = {
  id: string;
  name: string;
  office_id: string;
  office: any;
};
type Staff = { id: string; full_name: string; office_id: string | null };

export function DesksClient({
  desks,
  offices,
  departments,
  staffList,
  currentOfficeFilter,
  currentDepartmentFilter,
}: {
  desks: Desk[];
  offices: Office[];
  departments: Department[];
  staffList: Staff[];
  currentOfficeFilter: string;
  currentDepartmentFilter: string;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Desk | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(desk: Desk) {
    setEditing(desk);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateDesk(editing.id, formData)
        : await createDesk(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this desk?')) return;
    startTransition(async () => {
      const result = await deleteDesk(id);
      if (result?.error) setError(result.error);
    });
  }

  function handleFilterChange(key: string, value: string) {
    const p = new URLSearchParams();
    if (key === 'office') {
      if (value) p.set('office', value);
      if (currentDepartmentFilter) p.set('department', currentDepartmentFilter);
    } else {
      if (currentOfficeFilter) p.set('office', currentOfficeFilter);
      if (value) p.set('department', value);
    }
    const qs = p.toString();
    router.push(`/admin/desks${qs ? `?${qs}` : ''}`);
  }

  const statusColors: Record<string, string> = {
    open: 'bg-success/10 text-success',
    closed: 'bg-muted text-muted-foreground',
    serving: 'bg-primary/10 text-primary',
    paused: 'bg-warning/10 text-warning',
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Desks</h1>
          <p className="text-sm text-muted-foreground">
            Set up the service points where staff call and serve customers.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          New Desk
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={currentOfficeFilter}
          onChange={(e) => handleFilterChange('office', e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Locations</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          value={currentDepartmentFilter}
          onChange={(e) => handleFilterChange('department', e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.office ? `(${Array.isArray(d.office) ? d.office[0]?.name : d.office.name})` : ''}
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
              <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Department</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Office</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Assigned Staff</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {desks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No desks yet. Add a desk so staff can start serving from this dashboard.
                </td>
              </tr>
            )}
            {desks.map((desk) => (
              <tr key={desk.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{desk.name}</div>
                  {desk.display_name && (
                    <div className="text-xs text-muted-foreground">{desk.display_name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {desk.department?.name ?? '---'}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {desk.office?.name ?? '---'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      statusColors[desk.status ?? 'closed'] ?? statusColors.closed
                    }`}
                  >
                    {desk.status ?? 'closed'}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {desk.current_staff?.full_name ?? '---'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(desk)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(desk.id)}
                      disabled={isPending}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                    >
                      Delete
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
              {editing ? 'Edit Desk' : 'Create Desk'}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Name <span className="text-destructive">*</span>
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
                  Display Name
                </label>
                <input
                  name="display_name"
                  defaultValue={editing?.display_name ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Office <span className="text-destructive">*</span>
                </label>
                <select
                  name="office_id"
                  required
                  defaultValue={editing?.office_id ?? currentOfficeFilter ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select location...</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Department <span className="text-destructive">*</span>
                </label>
                <select
                  name="department_id"
                  required
                  defaultValue={editing?.department_id ?? currentDepartmentFilter ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Select department...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.office ? `(${Array.isArray(d.office) ? d.office[0]?.name : d.office.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Status
                </label>
                <select
                  name="status"
                  defaultValue={editing?.status ?? 'closed'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                  <option value="serving">Serving</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Assigned team member
                </label>
                <select
                  name="current_staff_id"
                  defaultValue={editing?.current_staff_id ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">None</option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="is_active"
                  value="true"
                  defaultChecked={editing?.is_active ?? true}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-medium text-foreground">Active</label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

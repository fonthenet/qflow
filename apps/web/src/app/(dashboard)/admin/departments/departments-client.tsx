'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '@/lib/actions/admin-actions';

type Department = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  office_id: string;
  is_active: boolean | null;
  sort_order: number | null;
  created_at: string | null;
  office: { id: string; name: string } | null;
};

type Office = { id: string; name: string };

export function DepartmentsClient({
  departments,
  offices,
  currentOfficeFilter,
}: {
  departments: Department[];
  offices: Office[];
  currentOfficeFilter: string;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(dept: Department) {
    setEditing(dept);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateDepartment(editing.id, formData)
        : await createDepartment(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this department?')) return;
    startTransition(async () => {
      const result = await deleteDepartment(id);
      if (result?.error) setError(result.error);
    });
  }

  function handleFilterChange(officeId: string) {
    if (officeId) {
      router.push(`/admin/departments?office=${officeId}`);
    } else {
      router.push('/admin/departments');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Departments</h1>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Organize the main areas customers choose from at each location.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
        >
          New Department
        </button>
      </div>

      {/* Filter */}
      <div className="mb-4">
        <select
          value={currentOfficeFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
          className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">All Locations</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/30">
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Code</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Office</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No departments yet. Add your first department to organize customer flow.
                </td>
              </tr>
            )}
            {departments.map((dept) => (
              <tr key={dept.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3.5 font-medium text-foreground">{dept.name}</td>
                <td className="px-5 py-3.5">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {dept.code}
                  </code>
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">
                  {dept.office?.name ?? '---'}
                </td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                      dept.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {dept.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(dept)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(dept.id)}
                      disabled={isPending}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
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
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? 'Edit Department' : 'Create Department'}
            </h2>

            {error && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="name"
                  required
                  defaultValue={editing?.name ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Code <span className="text-destructive">*</span>
                </label>
                <input
                  name="code"
                  required
                  defaultValue={editing?.code ?? ''}
                  placeholder="e.g. GEN, HR, FIN"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Description
                </label>
                <input
                  name="description"
                  defaultValue={editing?.description ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Office <span className="text-destructive">*</span>
                </label>
                <select
                  name="office_id"
                  required
                  defaultValue={editing?.office_id ?? currentOfficeFilter ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
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
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sort Order
                </label>
                <input
                  name="sort_order"
                  type="number"
                  defaultValue={editing?.sort_order ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
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
                <label className="text-sm font-medium text-foreground">Active</label>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50"
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

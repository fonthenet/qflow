'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { createOffice, updateOffice, deleteOffice } from '@/lib/actions/admin-actions';
import type { Database } from '@/lib/supabase/database.types';

type Office = Database['public']['Tables']['offices']['Row'];

export function OfficesClient({ offices }: { offices: Office[] }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Office | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(office: Office) {
    setEditing(office);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateOffice(editing.id, formData)
        : await createOffice(formData);

      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this office?')) return;
    startTransition(async () => {
      const result = await deleteOffice(id);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Locations</h1>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Add and update the places where customers can be served.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90"
        >
          Add Location
        </button>
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
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Branch Type</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Address</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timezone</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
              <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {offices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No locations found. Add your first location to get started.
                </td>
              </tr>
            )}
            {offices.map((office) => (
              <tr key={office.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-5 py-3.5 font-medium text-foreground">{office.name}</td>
                <td className="px-5 py-3.5 text-muted-foreground">
                  {((office.settings as Record<string, any> | null)?.branch_type as string | undefined)?.replace(/_/g, ' ') ?? '---'}
                </td>
                <td className="px-5 py-3.5 text-muted-foreground">{office.address || '---'}</td>
                <td className="px-5 py-3.5 text-muted-foreground">{office.timezone || '---'}</td>
                <td className="px-5 py-3.5">
                  <span
                    className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                      office.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {office.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/admin/departments?office=${office.id}`}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      Departments
                    </Link>
                    <button
                      onClick={() => openEdit(office)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(office.id)}
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
              {editing ? 'Edit Location' : 'Create Location'}
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
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Address
                </label>
                <input
                  name="address"
                  defaultValue={editing?.address ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Timezone
                </label>
                <input
                  name="timezone"
                  defaultValue={editing?.timezone ?? ''}
                  placeholder="e.g. America/New_York"
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Branch Type
                </label>
                <select
                  name="branch_type"
                  defaultValue={((editing?.settings as Record<string, any> | null)?.branch_type as string | undefined) ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="">Use template default</option>
                  <option value="service_center">Service Center</option>
                  <option value="branch_office">Branch Office</option>
                  <option value="community_clinic">Community Clinic</option>
                  <option value="restaurant_floor">Restaurant Floor</option>
                  <option value="salon_shop">Salon Shop</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Operating Model
                </label>
                <select
                  name="platform_operating_model"
                  defaultValue={((editing?.settings as Record<string, any> | null)?.platform_operating_model as string | undefined) ?? ''}
                  className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                >
                  <option value="">Use template default</option>
                  <option value="department_first">Department First</option>
                  <option value="service_routing">Service Routing</option>
                  <option value="appointments_first">Appointments First</option>
                  <option value="waitlist">Waitlist</option>
                </select>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  name="privacy_safe_display"
                  value="true"
                  defaultChecked={((editing?.settings as Record<string, any> | null)?.privacy_safe_display as boolean | undefined) ?? false}
                  className="h-4 w-4 rounded border-input"
                />
                <label className="text-sm font-medium text-foreground">
                  Privacy-safe display mode
                </label>
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

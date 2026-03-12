'use client';

import { useState, useTransition } from 'react';
import {
  createStaffMember,
  updateStaffMember,
} from '@/lib/actions/admin-actions';

type StaffMember = {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  organization_id: string;
  is_active: boolean | null;
  created_at: string | null;
  office: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
};

type Office = { id: string; name: string };
type Department = {
  id: string;
  name: string;
  office: any;
};

export function StaffClient({
  staff,
  offices,
  departments,
}: {
  staff: StaffMember[];
  offices: Office[];
  departments: Department[];
}) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setError(null);
    setShowModal(true);
  }

  function openEdit(member: StaffMember) {
    setEditing(member);
    setError(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateStaffMember(editing.id, formData)
        : await createStaffMember(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowModal(false);
        setEditing(null);
      }
    });
  }

  const roleLabels: Record<string, string> = {
    admin: 'Admin',
    manager: 'Manager',
    agent: 'Agent',
    receptionist: 'Receptionist',
  };

  const roleBadgeColors: Record<string, string> = {
    admin: 'bg-primary/10 text-primary',
    manager: 'bg-warning/10 text-warning',
    agent: 'bg-secondary text-secondary-foreground',
    receptionist: 'bg-accent text-accent-foreground',
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staff</h1>
          <p className="text-sm text-muted-foreground">
            Manage staff members and their roles.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Add Staff Member
        </button>
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
              <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Office</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No staff members found.
                </td>
              </tr>
            )}
            {staff.map((member) => (
              <tr key={member.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-medium text-foreground">
                  {member.full_name}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{member.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                      roleBadgeColors[member.role] ?? 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {roleLabels[member.role] ?? member.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {member.office?.name ?? '---'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      member.is_active
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {member.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => openEdit(member)}
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    Edit
                  </button>
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
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? 'Edit Staff Member' : 'Create Staff Member'}
            </h2>

            {error && (
              <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <form action={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  name="full_name"
                  required
                  defaultValue={editing?.full_name ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Email <span className="text-destructive">*</span>
                </label>
                <input
                  name="email"
                  type="email"
                  required
                  defaultValue={editing?.email ?? ''}
                  disabled={!!editing}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>

              {/* Password only for new staff */}
              {!editing && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Password <span className="text-destructive">*</span>
                  </label>
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={6}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Minimum 6 characters. The user can change it later.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Role <span className="text-destructive">*</span>
                </label>
                <select
                  name="role"
                  required
                  defaultValue={editing?.role ?? 'agent'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="agent">Agent</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Office
                </label>
                <select
                  name="office_id"
                  defaultValue={editing?.office_id ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No office assigned</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  Department
                </label>
                <select
                  name="department_id"
                  defaultValue={editing?.department_id ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No department assigned</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.office ? `(${d.office.name})` : ''}
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

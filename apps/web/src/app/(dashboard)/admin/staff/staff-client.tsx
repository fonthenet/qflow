'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { RoleDefinition } from '@queueflow/shared';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@queueflow/shared';
import {
  createStaffMember,
  sendStaffPasswordReset,
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
  office: { id: string; name: string } | null;
};

const roleBadgeColors: Record<string, string> = {
  [STAFF_ROLES.ADMIN]: 'bg-primary/10 text-primary',
  [STAFF_ROLES.MANAGER]: 'bg-warning/10 text-warning',
  [STAFF_ROLES.BRANCH_ADMIN]: 'bg-blue-100 text-blue-700',
  [STAFF_ROLES.DESK_OPERATOR]: 'bg-secondary text-secondary-foreground',
  [STAFF_ROLES.RECEPTIONIST]: 'bg-accent text-accent-foreground',
  [STAFF_ROLES.FLOOR_MANAGER]: 'bg-emerald-100 text-emerald-700',
  [STAFF_ROLES.ANALYST]: 'bg-slate-200 text-slate-700',
  [STAFF_ROLES.AGENT]: 'bg-secondary text-secondary-foreground',
};

function permissionSummary(roleDefinition: RoleDefinition | undefined, vocab: StaffVocabulary) {
  if (!roleDefinition) {
    return [`${vocab.deskLabel} access`];
  }

  const items = new Set<string>();

  if (roleDefinition.adminAccess) items.add('Business setup');
  if (roleDefinition.allowedNavigation.includes('/desk')) items.add(vocab.deskLabel);
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/bookings'))) items.add('Bookings');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/analytics'))) items.add('Reports');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/kiosk'))) items.add('Kiosk');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/displays'))) items.add('Displays');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/staff'))) items.add('Team');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/customers'))) items.add(`${vocab.customerLabel}s`);

  return Array.from(items);
}

function roleHelpText(role: string, vocab: StaffVocabulary) {
  const desk = vocab.deskLabel.toLowerCase();
  const customer = vocab.customerLabel.toLowerCase();
  switch (role) {
    case STAFF_ROLES.ADMIN:
      return `Full business control, including setup, team, reports, and live ${vocab.queueLabel ?? 'queue'} management.`;
    case STAFF_ROLES.MANAGER:
      return 'Runs the business day to day, with setup access and reporting.';
    case STAFF_ROLES.BRANCH_ADMIN:
      return `Manages one ${vocab.officeLabel.toLowerCase()} and its service flow.`;
    case STAFF_ROLES.RECEPTIONIST:
      return `Checks ${customer}s in and helps at the front ${desk}.`;
    case STAFF_ROLES.DESK_OPERATOR:
      return `Calls and serves ${customer}s at a ${desk}.`;
    case STAFF_ROLES.FLOOR_MANAGER:
      return 'Supervises live operations and helps unblock queues.';
    case STAFF_ROLES.ANALYST:
      return `Views reports, ${customer} history, and business activity.`;
    case STAFF_ROLES.AGENT:
      return `Legacy basic ${desk} access.`;
    default:
      return 'Business access based on the assigned role.';
  }
}

interface StaffVocabulary {
  deskLabel: string;
  departmentLabel: string;
  officeLabel: string;
  serviceLabel: string;
  customerLabel: string;
  queueLabel?: string;
}

export function StaffClient({
  staff,
  offices,
  departments,
  roleDefinitions,
  vocabulary,
}: {
  staff: StaffMember[];
  offices: Office[];
  departments: Department[];
  roleDefinitions: RoleDefinition[];
  vocabulary: StaffVocabulary;
}) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isResetPending, startResetTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>(STAFF_ROLES.DESK_OPERATOR);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('');

  const availableDepartments = useMemo(
    () =>
      selectedOfficeId
        ? departments.filter((department) => department.office?.id === selectedOfficeId)
        : departments,
    [departments, selectedOfficeId]
  );

  const selectedRoleDefinition = roleDefinitions.find((entry) => entry.role === selectedRole);

  function openCreate() {
    setEditing(null);
    setSelectedRole(STAFF_ROLES.DESK_OPERATOR);
    setSelectedOfficeId('');
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  function openEdit(member: StaffMember) {
    setEditing(member);
    setSelectedRole(member.role);
    setSelectedOfficeId(member.office_id ?? '');
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = editing
        ? await updateStaffMember(editing.id, formData)
        : await createStaffMember(formData);

      if (result?.error) {
        setError(result.error);
        return;
      }

      setShowModal(false);
      setEditing(null);
      setSuccess(editing ? 'Team member updated.' : 'Team member added and login account created.');
    });
  }

  function handleSendReset(member: StaffMember) {
    setError(null);
    setSuccess(null);

    startResetTransition(async () => {
      const result = await sendStaffPasswordReset(member.id);
      if (result?.error) {
        setError(result.error);
        return;
      }

      setSuccess(`Password setup email sent to ${member.email}.`);
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Access</h1>
            <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
              Add business users, choose what they can access, and keep each person tied to the right role.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/admin/staff/setup')}
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors"
            >
              Add Team Member
            </button>
            <button
              onClick={openCreate}
              className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              Quick Add
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {roleDefinitions.map((roleDefinition) => (
            <div key={roleDefinition.role} className="rounded-2xl border border-border/60 bg-card shadow-sm p-5">
              <p className="text-sm font-semibold text-foreground">
                {STAFF_ROLE_LABELS[roleDefinition.role] ?? roleDefinition.label}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{roleHelpText(roleDefinition.role, vocabulary)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {permissionSummary(roleDefinition, vocabulary).map((item) => (
                  <span key={item} className="rounded-lg bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30">
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Team member</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{vocabulary.officeLabel}</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Login</th>
                <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                    No team members yet.
                  </td>
                </tr>
              ) : null}
              {staff.map((member) => (
                <tr key={member.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-foreground">{member.full_name}</p>
                    <p className="text-muted-foreground">{member.email}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                        roleBadgeColors[member.role] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {STAFF_ROLE_LABELS[member.role as keyof typeof STAFF_ROLE_LABELS] ?? member.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {member.office?.name ?? `All ${vocabulary.officeLabel.toLowerCase()}s`}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                        member.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {member.is_active ? 'Can sign in' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleSendReset(member)}
                        disabled={isResetPending}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                      >
                        Send setup email
                      </button>
                      <button
                        onClick={() => openEdit(member)}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {showModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)} />
            <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
              <h2 className="text-lg font-semibold text-foreground">
                {editing ? 'Edit team member' : 'Add team member'}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                {editing
                  ? 'Update this person\u2019s role, location access, and active status.'
                  : 'Create a login for someone on your business team and choose what they can access.'}
              </p>

              {error ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <form action={handleSubmit} className="mt-5 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full name</label>
                    <input
                      name="full_name"
                      required
                      defaultValue={editing?.full_name ?? ''}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</label>
                    {editing && <input type="hidden" name="email" value={editing.email} />}
                    <input
                      name="email"
                      type="email"
                      required
                      defaultValue={editing?.email ?? ''}
                      disabled={!!editing}
                      className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {!editing ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Temporary password</label>
                      <input
                        name="password"
                        type="password"
                        required
                        minLength={6}
                        className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        They can use this right away, then change it later.
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                      <label className="inline-flex items-start gap-2 text-sm text-foreground">
                        <input type="checkbox" name="send_setup_email" value="true" defaultChecked className="mt-0.5" />
                        <span>
                          <span className="font-medium">Send setup email</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            Sends a password setup email so they can sign in without you sharing the password.
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="space-y-4">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</label>
                      <select
                        name="role"
                        required
                        value={selectedRole}
                        onChange={(event) => setSelectedRole(event.target.value)}
                        className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                      >
                        {roleDefinitions.map((roleDefinition) => (
                          <option key={roleDefinition.role} value={roleDefinition.role}>
                            {STAFF_ROLE_LABELS[roleDefinition.role] ?? roleDefinition.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{vocabulary.officeLabel}</label>
                        <select
                          name="office_id"
                          value={selectedOfficeId}
                          onChange={(event) => setSelectedOfficeId(event.target.value)}
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                        >
                          <option value="">All {vocabulary.officeLabel.toLowerCase()}s</option>
                          {offices.map((office) => (
                            <option key={office.id} value={office.id}>
                              {office.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">{vocabulary.departmentLabel}</label>
                        <select
                          name="department_id"
                          defaultValue={editing?.department_id ?? ''}
                          className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
                        >
                          <option value="">No {vocabulary.departmentLabel.toLowerCase()} limit</option>
                          {availableDepartments.map((department) => (
                            <option key={department.id} value={department.id}>
                              {department.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <label className="inline-flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        name="is_active"
                        value="true"
                        defaultChecked={editing?.is_active ?? true}
                      />
                      This person can sign in now
                    </label>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
                    <p className="text-sm font-semibold text-foreground">
                      {STAFF_ROLE_LABELS[selectedRole as keyof typeof STAFF_ROLE_LABELS] ?? selectedRole}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{roleHelpText(selectedRole, vocabulary)}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {permissionSummary(selectedRoleDefinition, vocabulary).map((item) => (
                        <span key={item} className="rounded-lg bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
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
                    {isPending ? 'Saving...' : editing ? 'Save changes' : 'Create login'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

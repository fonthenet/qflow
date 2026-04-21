'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { RoleDefinition } from '@qflo/shared';
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@qflo/shared';
import { useI18n } from '@/components/providers/locale-provider';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  assignStaffToDesk,
  checkStaffEmailAvailability,
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
type Desk = {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string | null;
  current_staff_id: string | null;
  is_active: boolean | null;
  office: { id: string; name: string; is_active: boolean | null } | null;
  department: { id: string; name: string } | null;
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

function permissionSummary(roleDefinition?: RoleDefinition) {
  if (!roleDefinition) {
    return ['Desk access'];
  }

  const items = new Set<string>();

  if (roleDefinition.adminAccess) items.add('Business setup');
  if (roleDefinition.allowedNavigation.includes('/desk')) items.add('Desk');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/bookings'))) items.add('Bookings');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/analytics'))) items.add('Reports');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/kiosk'))) items.add('Kiosk');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/displays'))) items.add('Displays');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/staff'))) items.add('Team');
  if (roleDefinition.allowedNavigation.some((entry) => entry.includes('/admin/customers'))) items.add('Customers');

  return Array.from(items);
}

function roleHelpText(role: string) {
  switch (role) {
    case STAFF_ROLES.ADMIN:
      return 'Full business control, including setup, team, reports, and live queue management.';
    case STAFF_ROLES.MANAGER:
      return 'Runs the business day to day, with setup access and reporting.';
    case STAFF_ROLES.BRANCH_ADMIN:
      return 'Manages one location and its service flow.';
    case STAFF_ROLES.RECEPTIONIST:
      return 'Checks customers in and helps at the front desk.';
    case STAFF_ROLES.DESK_OPERATOR:
      return 'Calls and serves customers at a desk or counter.';
    case STAFF_ROLES.FLOOR_MANAGER:
      return 'Supervises live operations and helps unblock queues.';
    case STAFF_ROLES.ANALYST:
      return 'Views reports, customer history, and business activity.';
    case STAFF_ROLES.AGENT:
      return 'Legacy basic desk access.';
    default:
      return 'Business access based on the assigned role.';
  }
}

export function StaffClient({
  staff,
  offices,
  departments,
  desks,
  roleDefinitions,
  currentUserRole,
}: {
  staff: StaffMember[];
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  roleDefinitions: RoleDefinition[];
  currentUserRole: string;
}) {
  const { t } = useI18n();
  const { confirm: styledConfirm } = useConfirmDialog();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [assigning, setAssigning] = useState<StaffMember | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAssignPending, startAssignTransition] = useTransition();
  const [isResetPending, startResetTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showAllOffices, setShowAllOffices] = useState(false);

  const canCrossOffice = currentUserRole === STAFF_ROLES.ADMIN || currentUserRole === STAFF_ROLES.MANAGER;

  // Map staff -> their current desk for the "Assigned desk" column
  const deskByStaffId = useMemo(() => {
    const map = new Map<string, Desk>();
    for (const desk of desks) {
      if (desk.current_staff_id) map.set(desk.current_staff_id, desk);
    }
    return map;
  }, [desks]);

  const occupantNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of staff) map.set(s.id, s.full_name);
    return map;
  }, [staff]);
  const [selectedRole, setSelectedRole] = useState<string>(STAFF_ROLES.DESK_OPERATOR);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('');
  const [emailValue, setEmailValue] = useState('');
  type EmailCheck = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';
  const [emailCheck, setEmailCheck] = useState<EmailCheck>('idle');
  const emailCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) { setEmailCheck('idle'); return; }
    if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current);
    const trimmed = emailValue.trim().toLowerCase();
    if (!trimmed) { setEmailCheck('idle'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setEmailCheck('invalid'); return; }
    setEmailCheck('checking');
    emailCheckTimer.current = setTimeout(async () => {
      try {
        const result = await checkStaffEmailAvailability(trimmed);
        if (!result.valid) { setEmailCheck('invalid'); return; }
        setEmailCheck(result.available ? 'available' : 'taken');
      } catch {
        setEmailCheck('idle');
      }
    }, 500);
    return () => { if (emailCheckTimer.current) clearTimeout(emailCheckTimer.current); };
  }, [emailValue, editing]);

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
    setEmailValue('');
    setEmailCheck('idle');
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  function openEdit(member: StaffMember) {
    setEditing(member);
    setSelectedRole(member.role);
    setSelectedOfficeId(member.office_id ?? '');
    setEmailValue(member.email);
    setEmailCheck('idle');
    setError(null);
    setSuccess(null);
    setShowModal(true);
  }

  function handleSubmit(formData: FormData) {
    if (!editing && emailCheck === 'taken') {
      setError(t('A team member with this email already exists in your business.'));
      return;
    }
    if (!editing && emailCheck === 'invalid') {
      setError(t('Please enter a valid email address.'));
      return;
    }
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
      setSuccess(editing ? t('Team member updated.') : t('Team member added and login account created.'));
    });
  }

  function openAssign(member: StaffMember) {
    setAssigning(member);
    setShowAllOffices(false);
    setError(null);
    setSuccess(null);
  }

  async function runAssign(
    member: StaffMember,
    deskId: string | null,
    allowOfficeChange = false
  ) {
    startAssignTransition(async () => {
      const result = await assignStaffToDesk({
        staffId: member.id,
        deskId,
        allowOfficeChange,
      });

      if (result?.error === 'CROSS_OFFICE') {
        const target = desks.find((d) => d.id === deskId);
        const targetName = target?.office?.name ?? t('another location');
        const ok = await styledConfirm(
          t('Move {name} to {office}? Their location will be updated to match the new desk.', {
            name: member.full_name,
            office: targetName,
          }),
          { variant: 'info', confirmLabel: t('Move') }
        );
        if (!ok) return;
        const retry = await assignStaffToDesk({
          staffId: member.id,
          deskId,
          allowOfficeChange: true,
        });
        if (retry?.error) {
          setError(retry.error);
          return;
        }
        setSuccess(t('{name} assigned to {desk}.', { name: member.full_name, desk: target?.name ?? '' }));
        setAssigning(null);
        return;
      }

      if (result?.error) {
        setError(result.error);
        return;
      }

      if (deskId) {
        const target = desks.find((d) => d.id === deskId);
        setSuccess(t('{name} assigned to {desk}.', { name: member.full_name, desk: target?.name ?? '' }));
      } else {
        setSuccess(t('{name} unassigned from their desk.', { name: member.full_name }));
      }
      setAssigning(null);
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

      setSuccess(t('Password setup email sent to {email}.', { email: member.email }));
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Team Access')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Add business users, choose what they can access, and keep each person tied to the right role.')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('Add Team Member')}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {roleDefinitions.map((roleDefinition) => (
          <div key={roleDefinition.role} className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">
              {STAFF_ROLE_LABELS[roleDefinition.role] ?? roleDefinition.label}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{roleHelpText(roleDefinition.role)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {permissionSummary(roleDefinition).map((item) => (
                <span key={item} className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Team member')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Role')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Location')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Assigned desk')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Login')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('No team members yet.')}
                </td>
              </tr>
            ) : null}
            {staff.map((member) => {
              const assignedDesk = deskByStaffId.get(member.id) ?? null;
              const orphanedOffice =
                member.office && member.office_id && !offices.some((o) => o.id === member.office_id);
              return (
              <tr key={member.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{member.full_name}</p>
                  <p className="text-muted-foreground">{member.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      roleBadgeColors[member.role] ?? 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {STAFF_ROLE_LABELS[member.role as keyof typeof STAFF_ROLE_LABELS] ?? member.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {member.office?.name ?? t('All locations')}
                  {orphanedOffice ? (
                    <span className="ml-1 inline-flex items-center rounded-full bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium text-warning" title={t('This location is closed')}>
                      ⚠ {t('closed')}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  {assignedDesk ? (
                    <div>
                      <span className="font-medium text-foreground">{assignedDesk.name}</span>
                      {assignedDesk.office?.name ? (
                        <span className="text-muted-foreground"> · {assignedDesk.office.name}</span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      member.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {member.is_active ? t('Can sign in') : t('Inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => openAssign(member)}
                      disabled={!member.is_active}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      title={!member.is_active ? t('Reactivate this person to assign a desk') : undefined}
                    >
                      {assignedDesk ? t('Change desk') : t('Assign desk')}
                    </button>
                    <button
                      onClick={() => handleSendReset(member)}
                      disabled={isResetPending}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                    >
                      {t('Send setup email')}
                    </button>
                    <button
                      onClick={() => openEdit(member)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {t('Edit')}
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {assigning ? (
        <AssignDeskModal
          member={assigning}
          desks={desks}
          occupantNameById={occupantNameById}
          showAllOffices={showAllOffices}
          canCrossOffice={canCrossOffice}
          isPending={isAssignPending}
          onToggleAllOffices={setShowAllOffices}
          onClose={() => setAssigning(null)}
          onAssign={(deskId) => runAssign(assigning, deskId)}
          t={t}
        />
      ) : null}

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-foreground">
              {editing ? t('Edit team member') : t('Add team member')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editing
                ? t('Update this person’s role, location access, and active status.')
                : t('Create a login for someone on your business team and choose what they can access.')}
            </p>

            {error ? (
              <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <form action={handleSubmit} className="mt-5 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">{t('Full name')}</label>
                  <input
                    name="full_name"
                    required
                    defaultValue={editing?.full_name ?? ''}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">{t('Email')}</label>
                  {editing && <input type="hidden" name="email" value={editing.email} />}
                  <input
                    name="email"
                    type="email"
                    required
                    value={emailValue}
                    onChange={(e) => setEmailValue(e.target.value)}
                    disabled={!!editing}
                    className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60 disabled:cursor-not-allowed ${
                      !editing && (emailCheck === 'taken' || emailCheck === 'invalid')
                        ? 'border-destructive'
                        : !editing && emailCheck === 'available'
                        ? 'border-emerald-500'
                        : 'border-input'
                    }`}
                  />
                  {!editing && emailCheck !== 'idle' && (
                    <p
                      className={`mt-1 text-xs font-medium ${
                        emailCheck === 'available'
                          ? 'text-emerald-600'
                          : emailCheck === 'taken' || emailCheck === 'invalid'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {emailCheck === 'checking'
                        ? t('Checking availability…')
                        : emailCheck === 'available'
                        ? '✓ ' + t('Email available')
                        : emailCheck === 'taken'
                        ? '✗ ' + t('A team member with this email already exists in your business.')
                        : emailCheck === 'invalid'
                        ? '✗ ' + t('Please enter a valid email address.')
                        : ''}
                    </p>
                  )}
                </div>
              </div>

              {!editing ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                      <label className="mb-1 block text-sm font-medium text-foreground">{t('Temporary password')}</label>
                    <input
                      name="password"
                      type="password"
                      required
                      minLength={6}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('They can use this right away, then change it later.')}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <label className="inline-flex items-start gap-2 text-sm text-foreground">
                      <input type="checkbox" name="send_setup_email" value="true" defaultChecked className="mt-0.5" />
                      <span>
                        <span className="font-medium">{t('Send setup email')}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('Sends a password setup email so they can sign in without you sharing the password.')}
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">{t('Role')}</label>
                    <select
                      name="role"
                      required
                      value={selectedRole}
                      onChange={(event) => setSelectedRole(event.target.value)}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
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
                      <label className="mb-1 block text-sm font-medium text-foreground">{t('Location')}</label>
                      <select
                        name="office_id"
                        value={selectedOfficeId}
                        onChange={(event) => setSelectedOfficeId(event.target.value)}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">{t('All locations')}</option>
                        {offices.map((office) => (
                          <option key={office.id} value={office.id}>
                            {office.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-foreground">{t('Department')}</label>
                      <select
                        name="department_id"
                        defaultValue={editing?.department_id ?? ''}
                        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                      >
                        <option value="">{t('No department limit')}</option>
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
                    {t('This person can sign in now')}
                  </label>
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    {STAFF_ROLE_LABELS[selectedRole as keyof typeof STAFF_ROLE_LABELS] ?? selectedRole}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">{roleHelpText(selectedRole)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {permissionSummary(selectedRoleDefinition).map((item) => (
                      <span key={item} className="rounded-full bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
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
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  {t('Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {isPending ? t('Saving...') : editing ? t('Save changes') : t('Create login')}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AssignDeskModal({
  member,
  desks,
  occupantNameById,
  showAllOffices,
  canCrossOffice,
  isPending,
  onToggleAllOffices,
  onClose,
  onAssign,
  t,
}: {
  member: StaffMember;
  desks: Desk[];
  occupantNameById: Map<string, string>;
  showAllOffices: boolean;
  canCrossOffice: boolean;
  isPending: boolean;
  onToggleAllOffices: (value: boolean) => void;
  onClose: () => void;
  onAssign: (deskId: string | null) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const memberOfficeId = member.office_id ?? null;

  // Filter: desk must be active, office must be active. Scope to member's
  // office unless the user flipped "show other locations" on.
  const scoped = useMemo(() => {
    return desks.filter((desk) => {
      if (desk.is_active === false) return false;
      if (desk.office?.is_active === false) return false;
      if (!showAllOffices && memberOfficeId && desk.office_id !== memberOfficeId) return false;
      return true;
    });
  }, [desks, showAllOffices, memberOfficeId]);

  // Group by office for readability
  const grouped = useMemo(() => {
    const map = new Map<string, { officeName: string; officeId: string; desks: Desk[] }>();
    for (const desk of scoped) {
      const key = desk.office_id;
      if (!map.has(key)) {
        map.set(key, {
          officeName: desk.office?.name ?? t('Unknown location'),
          officeId: key,
          desks: [],
        });
      }
      map.get(key)!.desks.push(desk);
    }
    return Array.from(map.values()).sort((a, b) => a.officeName.localeCompare(b.officeName));
  }, [scoped, t]);

  const currentDesk = desks.find((d) => d.current_staff_id === member.id) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('Assign desk for {name}', { name: member.full_name })}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {currentDesk
                ? t('Currently on {desk} · {office}', {
                    desk: currentDesk.name,
                    office: currentDesk.office?.name ?? '',
                  })
                : t('Not currently on any desk.')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            aria-label={t('Close')}
          >
            ✕
          </button>
        </div>

        {canCrossOffice ? (
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={showAllOffices}
              onChange={(event) => onToggleAllOffices(event.target.checked)}
            />
            {t('Show desks in other locations')}
          </label>
        ) : null}

        <div className="mt-4 space-y-5">
          {grouped.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              {showAllOffices || !memberOfficeId
                ? t('No desks available. Create one in Desks settings first.')
                : t('No desks in this person’s location. Turn on "Show desks in other locations" or create one.')}
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.officeId} className="rounded-xl border border-border bg-background">
                <div className="border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.officeName}
                  {memberOfficeId && group.officeId !== memberOfficeId ? (
                    <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium normal-case text-warning">
                      {t('Other location')}
                    </span>
                  ) : null}
                </div>
                <ul className="divide-y divide-border">
                  {group.desks.map((desk) => {
                    const occupantId = desk.current_staff_id;
                    const isSelf = occupantId === member.id;
                    const occupantName = occupantId ? occupantNameById.get(occupantId) : null;
                    return (
                      <li key={desk.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{desk.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {desk.department?.name ? `${desk.department.name} · ` : ''}
                            {isSelf
                              ? t('Currently assigned to this person')
                              : occupantName
                              ? t('Currently on: {name}', { name: occupantName })
                              : t('Free')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={isPending || isSelf}
                          onClick={() => onAssign(desk.id)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          {isSelf ? t('Assigned') : occupantName ? t('Take over') : t('Assign')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 flex justify-between gap-3">
          <button
            type="button"
            onClick={() => onAssign(null)}
            disabled={isPending || !currentDesk}
            className="rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50"
          >
            {t('Unassign from desk')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {t('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}

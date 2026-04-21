'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF_ROLES } from '@qflo/shared';
import { assignStaffToDesk, createDesk, updateDesk, deleteDesk } from '@/lib/actions/admin-actions';
import { useI18n } from '@/components/providers/locale-provider';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';

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
type Staff = {
  id: string;
  full_name: string;
  office_id: string | null;
  is_active?: boolean | null;
  office?: { id: string; name: string; is_active: boolean | null } | null;
};

export function DesksClient({
  desks,
  offices,
  departments,
  staffList,
  currentOfficeFilter,
  currentDepartmentFilter,
  currentUserRole,
}: {
  desks: Desk[];
  offices: Office[];
  departments: Department[];
  staffList: Staff[];
  currentOfficeFilter: string;
  currentDepartmentFilter: string;
  currentUserRole: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { confirm: styledConfirm } = useConfirmDialog();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Desk | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isAssignPending, startAssignTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'roster'>('table');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);

  const canCrossOffice =
    currentUserRole === STAFF_ROLES.ADMIN || currentUserRole === STAFF_ROLES.MANAGER;

  // staff → assigned desk lookup
  const deskByStaffId = useMemo(() => {
    const map = new Map<string, Desk>();
    for (const desk of desks) {
      if (desk.current_staff_id) map.set(desk.current_staff_id, desk);
    }
    return map;
  }, [desks]);

  // For the per-desk dropdown: staff scoped to the desk's office unless admin
  // (in which case all org staff can be picked). Staff already on another desk
  // are still eligible — picking them "takes over" the desk.
  function staffPickerFor(desk: Desk | null): Staff[] {
    if (!desk) return staffList;
    if (canCrossOffice) return staffList;
    return staffList.filter((s) => !s.office_id || s.office_id === desk.office_id);
  }

  async function runAssign(staffId: string, deskId: string | null) {
    const staff = staffList.find((s) => s.id === staffId);
    const desk = deskId ? desks.find((d) => d.id === deskId) : null;

    startAssignTransition(async () => {
      const result = await assignStaffToDesk({ staffId, deskId });

      if (result?.error === 'CROSS_OFFICE') {
        const ok = await styledConfirm(
          t('Move {name} to {office}? Their location will be updated to match the new desk.', {
            name: staff?.full_name ?? '',
            office: desk?.office?.name ?? '',
          }),
          { variant: 'info', confirmLabel: t('Move') }
        );
        if (!ok) return;
        const retry = await assignStaffToDesk({ staffId, deskId, allowOfficeChange: true });
        if (retry?.error) {
          setError(retry.error);
          return;
        }
        router.refresh();
        return;
      }

      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

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

  async function handleDelete(id: string) {
    if (!await styledConfirm(t('Are you sure you want to delete this desk?'), { variant: 'danger', confirmLabel: 'Delete' })) return;
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
    on_break: 'bg-warning/10 text-warning',
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Desks')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('Set up the service points where staff call and serve customers.')}
          </p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t('New Desk')}
        </button>
      </div>

      {/* Filters + view toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={currentOfficeFilter}
          onChange={(e) => handleFilterChange('office', e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">{t('All Locations')}</option>
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
          <option value="">{t('All Departments')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} {d.office ? `(${Array.isArray(d.office) ? d.office[0]?.name : d.office.name})` : ''}
            </option>
          ))}
        </select>

        <div className="ml-auto inline-flex rounded-lg border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setView('table')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('Table')}
          </button>
          <button
            type="button"
            onClick={() => setView('roster')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              view === 'roster' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {t('Roster')}
          </button>
        </div>
      </div>

      {error && !showModal && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {view === 'roster' ? (
        <RosterView
          desks={desks}
          staffList={staffList}
          deskByStaffId={deskByStaffId}
          selectedStaffId={selectedStaffId}
          onSelectStaff={setSelectedStaffId}
          onAssign={runAssign}
          isPending={isAssignPending}
          canCrossOffice={canCrossOffice}
          t={t}
        />
      ) : (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Name')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Department')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Office')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Status')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">{t('Assigned Staff')}</th>
              <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {desks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('No desks yet. Add a desk so staff can start serving from this dashboard.')}
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
                    {(desk.status ?? 'closed').replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={desk.current_staff_id ?? ''}
                    disabled={isAssignPending}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value) runAssign(value, desk.id);
                      else if (desk.current_staff_id) runAssign(desk.current_staff_id, null);
                    }}
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">{t('Unassigned')}</option>
                    {staffPickerFor(desk).map((s) => {
                      const onDesk = deskByStaffId.get(s.id);
                      const onOther = onDesk && onDesk.id !== desk.id;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                          {onOther ? ` · ${t('on')} ${onDesk?.name}` : ''}
                          {s.office_id !== desk.office_id && s.office?.name
                            ? ` (${s.office.name})`
                            : ''}
                        </option>
                      );
                    })}
                  </select>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEdit(desk)}
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                    >
                      {t('Edit')}
                    </button>
                    <button
                      onClick={() => handleDelete(desk.id)}
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
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setShowModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {editing ? t('Edit Desk') : t('Create Desk')}
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
                  {t('Display Name')}
                </label>
                <input
                  name="display_name"
                  defaultValue={editing?.display_name ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Office')} <span className="text-destructive">*</span>
                </label>
                <select
                  name="office_id"
                  required
                  defaultValue={editing?.office_id ?? currentOfficeFilter ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('Select location...')}</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
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
                      {d.name} {d.office ? `(${Array.isArray(d.office) ? d.office[0]?.name : d.office.name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Status')}
                </label>
                <select
                  name="status"
                  defaultValue={editing?.status ?? 'closed'}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="closed">{t('Closed')}</option>
                  <option value="open">{t('Open')}</option>
                  <option value="on_break">{t('On Break')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t('Assigned team member')}
                </label>
                <select
                  name="current_staff_id"
                  defaultValue={editing?.current_staff_id ?? ''}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">{t('None')}</option>
                  {staffList
                    .filter((s) => {
                      // In the edit modal, scope to staff in the desk's own office.
                      // Cross-office moves must use the inline assign (which also
                      // updates staff.office_id). This keeps createDesk/updateDesk
                      // consistent with assertStaffAssignment's same-office rule.
                      const officeId = editing?.office_id ?? currentOfficeFilter;
                      if (!officeId) return true;
                      return !s.office_id || s.office_id === officeId;
                    })
                    .map((s) => {
                      const onDesk = deskByStaffId.get(s.id);
                      const onOther = onDesk && onDesk.id !== editing?.id;
                      return (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                          {onOther ? ` · ${t('on')} ${onDesk?.name}` : ''}
                        </option>
                      );
                    })}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('To move someone across locations, close this and use the Assigned Staff dropdown in the row.')}
                </p>
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

function RosterView({
  desks,
  staffList,
  deskByStaffId,
  selectedStaffId,
  onSelectStaff,
  onAssign,
  isPending,
  canCrossOffice,
  t,
}: {
  desks: Desk[];
  staffList: Staff[];
  deskByStaffId: Map<string, Desk>;
  selectedStaffId: string | null;
  onSelectStaff: (id: string | null) => void;
  onAssign: (staffId: string, deskId: string | null) => void;
  isPending: boolean;
  canCrossOffice: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const selectedStaff = selectedStaffId ? staffList.find((s) => s.id === selectedStaffId) ?? null : null;

  // Split staff into on-desk vs. unassigned
  const unassignedStaff = staffList.filter((s) => !deskByStaffId.has(s.id));
  const assignedStaff = staffList.filter((s) => deskByStaffId.has(s.id));

  // Order desks: in the same office as selected first, then the rest
  const orderedDesks = useMemo(() => {
    if (!selectedStaff?.office_id) return desks;
    return [...desks].sort((a, b) => {
      const aSame = a.office_id === selectedStaff.office_id ? 0 : 1;
      const bSame = b.office_id === selectedStaff.office_id ? 0 : 1;
      return aSame - bSame;
    });
  }, [desks, selectedStaff?.office_id]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* STAFF COLUMN */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('Team members')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedStaff
              ? t('Pick a desk on the right to assign {name}.', { name: selectedStaff.full_name })
              : t('Click someone to assign them to a desk.')}
          </p>
        </div>

        {unassignedStaff.length > 0 ? (
          <div>
            <div className="flex items-center justify-between bg-warning/5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
              <span>{t('Unassigned')}</span>
              <span>{unassignedStaff.length}</span>
            </div>
            <ul className="divide-y divide-border">
              {unassignedStaff.map((s) => (
                <RosterStaffRow
                  key={s.id}
                  staff={s}
                  desk={null}
                  selected={selectedStaffId === s.id}
                  onSelect={() => onSelectStaff(selectedStaffId === s.id ? null : s.id)}
                  t={t}
                />
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{t('On duty')}</span>
          <span>{assignedStaff.length}</span>
        </div>
        {assignedStaff.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('No one is on a desk yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {assignedStaff.map((s) => (
              <RosterStaffRow
                key={s.id}
                staff={s}
                desk={deskByStaffId.get(s.id) ?? null}
                selected={selectedStaffId === s.id}
                onSelect={() => onSelectStaff(selectedStaffId === s.id ? null : s.id)}
                onUnassign={() => onAssign(s.id, null)}
                isPending={isPending}
                t={t}
              />
            ))}
          </ul>
        )}
      </div>

      {/* DESKS COLUMN */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('Desks')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedStaff ? t('Click a desk to assign.') : t('Who is on each desk right now.')}
          </p>
        </div>
        {orderedDesks.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('No desks yet.')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {orderedDesks.map((desk) => {
              const occupantId = desk.current_staff_id;
              const occupant = occupantId ? staffList.find((s) => s.id === occupantId) ?? null : null;
              const isDeskAvailable = desk.is_active !== false;
              const crossOffice =
                selectedStaff && selectedStaff.office_id && selectedStaff.office_id !== desk.office_id;
              const disabled =
                !selectedStaff || !isDeskAvailable || (crossOffice && !canCrossOffice) || isPending;
              const isSelfOnDesk = selectedStaff && occupantId === selectedStaff.id;
              return (
                <li
                  key={desk.id}
                  className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${
                    selectedStaff && !disabled ? 'cursor-pointer hover:bg-muted/40' : ''
                  } ${isSelfOnDesk ? 'bg-emerald-50/50' : ''}`}
                  onClick={() => {
                    if (!selectedStaff || disabled || isSelfOnDesk) return;
                    onAssign(selectedStaff.id, desk.id);
                    onSelectStaff(null);
                  }}
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {desk.name}
                      {desk.office?.name ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          · {desk.office.name}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {occupant ? (
                        <>👤 {occupant.full_name}</>
                      ) : (
                        <span className="text-emerald-600">{t('Free')}</span>
                      )}
                      {crossOffice && !canCrossOffice ? (
                        <span className="ml-2 text-warning">· {t('Different location')}</span>
                      ) : null}
                    </p>
                  </div>
                  {selectedStaff && !isSelfOnDesk ? (
                    <button
                      type="button"
                      disabled={disabled}
                      className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40"
                    >
                      {occupant ? t('Take over') : t('Assign')}
                    </button>
                  ) : isSelfOnDesk ? (
                    <span className="text-xs font-medium text-emerald-700">✓ {t('Assigned')}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function RosterStaffRow({
  staff,
  desk,
  selected,
  onSelect,
  onUnassign,
  isPending,
  t,
}: {
  staff: Staff;
  desk: Desk | null;
  selected: boolean;
  onSelect: () => void;
  onUnassign?: () => void;
  isPending?: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <li
      className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${
        selected ? 'bg-primary/5' : 'hover:bg-muted/30'
      } cursor-pointer`}
      onClick={onSelect}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{staff.full_name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {desk ? (
            <>
              → {desk.name}
              {desk.office?.name ? ` · ${desk.office.name}` : ''}
            </>
          ) : staff.office?.name ? (
            staff.office.name + (staff.office.is_active === false ? ` ⚠ ${t('closed')}` : '')
          ) : (
            t('All locations')
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {selected ? (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {t('Selected')}
          </span>
        ) : null}
        {desk && onUnassign ? (
          <button
            type="button"
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              onUnassign();
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {t('Unassign')}
          </button>
        ) : null}
      </div>
    </li>
  );
}

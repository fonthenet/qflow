'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Layers,
  Monitor,
  ChevronRight,
  ChevronDown,
  Plus,
  Pencil,
  Trash2,
  Grid3X3,
  Users,
  MapPin,
} from 'lucide-react';
import { SlideOver } from '@/components/admin/slide-over';
import {
  createOffice,
  updateOffice,
  deleteOffice,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createDesk,
  updateDesk,
  deleteDesk,
} from '@/lib/actions/admin-actions';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Desk {
  id: string;
  name: string;
  display_name: string | null;
  status: string;
  is_active: boolean;
  department_id: string;
  office_id: string;
  current_staff: { id: string; full_name: string } | null;
}

interface Service {
  id: string;
  name: string;
  code: string;
  department_id: string;
  is_active: boolean;
  sort_order: number | null;
}

interface Department {
  id: string;
  name: string;
  code: string;
  office_id: string;
  is_active: boolean;
  sort_order: number | null;
  desks: Desk[];
  services: Service[];
}

interface Office {
  id: string;
  name: string;
  address: string | null;
  timezone: string | null;
  is_active: boolean;
  departments: Department[];
}

interface StaffMember {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  office_id: string | null;
  department_id: string | null;
}

interface Vocabulary {
  officeLabel: string;
  departmentLabel: string;
  serviceLabel: string;
  deskLabel: string;
  customerLabel: string;
  bookingLabel: string;
  queueLabel: string;
}

interface BusinessMapProps {
  organizationName: string;
  offices: Office[];
  allStaff: StaffMember[];
  vocabulary: Vocabulary;
}

type SlideOverState =
  | null
  | { type: 'office'; mode: 'create' }
  | { type: 'office'; mode: 'edit'; data: Office }
  | { type: 'department'; mode: 'create'; officeId: string }
  | { type: 'department'; mode: 'edit'; data: Department }
  | { type: 'desk'; mode: 'create'; officeId: string; departmentId: string }
  | { type: 'desk'; mode: 'edit'; data: Desk };

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function BusinessMapClient({
  organizationName,
  offices,
  allStaff,
  vocabulary,
}: BusinessMapProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    offices.forEach((o) => initial.add(`office:${o.id}`));
    return initial;
  });
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalDepts = offices.reduce((s, o) => s + o.departments.length, 0);
  const totalDesks = offices.reduce(
    (s, o) => s + o.departments.reduce((s2, d) => s2 + d.desks.length, 0),
    0,
  );
  const assignedDesks = offices.reduce(
    (s, o) =>
      s +
      o.departments.reduce(
        (s2, d) => s2 + d.desks.filter((dk) => dk.current_staff).length,
        0,
      ),
    0,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Business Overview
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Your complete business structure — {vocabulary.officeLabel.toLowerCase()}s,{' '}
          {vocabulary.departmentLabel.toLowerCase()}s,{' '}
          {vocabulary.deskLabel.toLowerCase()}s, and team assignments.
        </p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label={`${vocabulary.officeLabel}s`}
          value={offices.length}
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          label={`${vocabulary.departmentLabel}s`}
          value={totalDepts}
        />
        <StatCard
          icon={<Monitor className="h-4 w-4" />}
          label={`${vocabulary.deskLabel}s`}
          value={`${assignedDesks}/${totalDesks} staffed`}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Active Staff"
          value={allStaff.length}
        />
      </div>

      {/* Tree */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm">
        {/* Org header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MapPin className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">
                {organizationName}
              </p>
              <p className="text-xs text-muted-foreground">
                {offices.length} {vocabulary.officeLabel.toLowerCase()}
                {offices.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => setSlideOver({ type: 'office', mode: 'create' })}
            className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add {vocabulary.officeLabel}
          </button>
        </div>

        {/* Office nodes */}
        <div className="divide-y divide-border/40">
          {offices.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No {vocabulary.officeLabel.toLowerCase()}s configured yet. Add your
              first {vocabulary.officeLabel.toLowerCase()} to get started.
            </div>
          ) : (
            offices.map((office) => (
              <OfficeNode
                key={office.id}
                office={office}
                allStaff={allStaff}
                vocabulary={vocabulary}
                isExpanded={expanded.has(`office:${office.id}`)}
                expandedDepts={expanded}
                onToggle={toggle}
                onEdit={(o) =>
                  setSlideOver({ type: 'office', mode: 'edit', data: o })
                }
                onAddDept={(officeId) =>
                  setSlideOver({
                    type: 'department',
                    mode: 'create',
                    officeId,
                  })
                }
                onEditDept={(d) =>
                  setSlideOver({ type: 'department', mode: 'edit', data: d })
                }
                onAddDesk={(officeId, departmentId) =>
                  setSlideOver({
                    type: 'desk',
                    mode: 'create',
                    officeId,
                    departmentId,
                  })
                }
                onEditDesk={(d) =>
                  setSlideOver({ type: 'desk', mode: 'edit', data: d })
                }
              />
            ))
          )}
        </div>
      </div>

      {/* SlideOver */}
      <SlideOver
        open={slideOver !== null}
        onClose={() => setSlideOver(null)}
        title={getSlideOverTitle(slideOver, vocabulary)}
      >
        {slideOver && (
          <SlideOverForm
            state={slideOver}
            vocabulary={vocabulary}
            allStaff={allStaff}
            offices={offices}
            onDone={() => {
              setSlideOver(null);
              router.refresh();
            }}
          />
        )}
      </SlideOver>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Office Node                                                        */
/* ------------------------------------------------------------------ */

function OfficeNode({
  office,
  allStaff,
  vocabulary,
  isExpanded,
  expandedDepts,
  onToggle,
  onEdit,
  onAddDept,
  onEditDept,
  onAddDesk,
  onEditDesk,
}: {
  office: Office;
  allStaff: StaffMember[];
  vocabulary: Vocabulary;
  isExpanded: boolean;
  expandedDepts: Set<string>;
  onToggle: (key: string) => void;
  onEdit: (o: Office) => void;
  onAddDept: (officeId: string) => void;
  onEditDept: (d: Department) => void;
  onAddDesk: (officeId: string, departmentId: string) => void;
  onEditDesk: (d: Desk) => void;
}) {
  const officeStaff = allStaff.filter((s) => s.office_id === office.id);

  return (
    <div>
      {/* Office row */}
      <div className="group flex items-center gap-2 px-5 py-3 hover:bg-muted/30 transition-colors">
        <button
          onClick={() => onToggle(`office:${office.id}`)}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <StatusDot active={office.is_active} />
        <Building2 className="h-4 w-4 text-blue-500" />
        <span className="font-medium text-foreground">{office.name}</span>
        <span className="text-xs text-muted-foreground">
          {office.departments.length} {vocabulary.departmentLabel.toLowerCase()}
          {office.departments.length !== 1 ? 's' : ''}
          {' · '}
          {officeStaff.length} staff
        </span>
        {/* Actions (visible on hover) */}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<Plus className="h-3.5 w-3.5" />}
            title={`Add ${vocabulary.departmentLabel}`}
            onClick={() => onAddDept(office.id)}
          />
          <IconButton
            icon={<Pencil className="h-3.5 w-3.5" />}
            title="Edit"
            onClick={() => onEdit(office)}
          />
        </div>
      </div>

      {/* Departments */}
      {isExpanded && (
        <div className="ml-5 border-l border-border/40">
          {office.departments.length === 0 ? (
            <div className="py-3 pl-8 text-xs text-muted-foreground">
              No {vocabulary.departmentLabel.toLowerCase()}s yet.{' '}
              <button
                onClick={() => onAddDept(office.id)}
                className="text-primary hover:underline"
              >
                Add one
              </button>
            </div>
          ) : (
            office.departments.map((dept) => (
              <DepartmentNode
                key={dept.id}
                dept={dept}
                vocabulary={vocabulary}
                isExpanded={expandedDepts.has(`dept:${dept.id}`)}
                onToggle={onToggle}
                onEdit={onEditDept}
                onAddDesk={(deptId) => onAddDesk(office.id, deptId)}
                onEditDesk={onEditDesk}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Department Node                                                    */
/* ------------------------------------------------------------------ */

function DepartmentNode({
  dept,
  vocabulary,
  isExpanded,
  onToggle,
  onEdit,
  onAddDesk,
  onEditDesk,
}: {
  dept: Department;
  vocabulary: Vocabulary;
  isExpanded: boolean;
  onToggle: (key: string) => void;
  onEdit: (d: Department) => void;
  onAddDesk: (deptId: string) => void;
  onEditDesk: (d: Desk) => void;
}) {
  return (
    <div>
      <div className="group flex items-center gap-2 py-2.5 pl-6 pr-5 hover:bg-muted/20 transition-colors">
        <button
          onClick={() => onToggle(`dept:${dept.id}`)}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <StatusDot active={dept.is_active} />
        <Layers className="h-4 w-4 text-violet-500" />
        <span className="text-sm font-medium text-foreground">{dept.name}</span>
        <span className="text-xs text-muted-foreground">
          {dept.desks.length} {vocabulary.deskLabel.toLowerCase()}
          {dept.desks.length !== 1 ? 's' : ''}
          {dept.services.length > 0 && (
            <>
              {' · '}
              {dept.services.length} {vocabulary.serviceLabel.toLowerCase()}
              {dept.services.length !== 1 ? 's' : ''}
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<Plus className="h-3.5 w-3.5" />}
            title={`Add ${vocabulary.deskLabel}`}
            onClick={() => onAddDesk(dept.id)}
          />
          <IconButton
            icon={<Pencil className="h-3.5 w-3.5" />}
            title="Edit"
            onClick={() => onEdit(dept)}
          />
        </div>
      </div>

      {/* Desks + Services */}
      {isExpanded && (
        <div className="ml-6 border-l border-border/30">
          {/* Services summary */}
          {dept.services.length > 0 && (
            <div className="flex items-center gap-2 py-2 pl-6 pr-5">
              <Grid3X3 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {vocabulary.serviceLabel}s:{' '}
                {dept.services.map((s) => s.name).join(', ')}
              </span>
            </div>
          )}
          {/* Desk nodes */}
          {dept.desks.length === 0 ? (
            <div className="py-2 pl-8 text-xs text-muted-foreground">
              No {vocabulary.deskLabel.toLowerCase()}s.{' '}
              <button
                onClick={() => onAddDesk(dept.id)}
                className="text-primary hover:underline"
              >
                Add one
              </button>
            </div>
          ) : (
            dept.desks.map((desk) => (
              <DeskNode
                key={desk.id}
                desk={desk}
                vocabulary={vocabulary}
                onEdit={onEditDesk}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Desk Node                                                          */
/* ------------------------------------------------------------------ */

function DeskNode({
  desk,
  vocabulary,
  onEdit,
}: {
  desk: Desk;
  vocabulary: Vocabulary;
  onEdit: (d: Desk) => void;
}) {
  return (
    <div className="group flex items-center gap-2 py-2 pl-6 pr-5 hover:bg-muted/10 transition-colors">
      <div className="h-6 w-6" /> {/* spacer */}
      <StatusDot active={desk.is_active} status={desk.status} />
      <Monitor className="h-3.5 w-3.5 text-emerald-500" />
      <span className="text-sm text-foreground">
        {desk.display_name || desk.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {desk.current_staff ? (
          <>
            <span className="text-foreground font-medium">
              {desk.current_staff.full_name}
            </span>
          </>
        ) : (
          <span className="italic">Unassigned</span>
        )}
      </span>
      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconButton
          icon={<Pencil className="h-3.5 w-3.5" />}
          title="Edit"
          onClick={() => onEdit(desk)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function StatusDot({
  active,
  status,
}: {
  active: boolean;
  status?: string;
}) {
  let color = 'bg-gray-300';
  if (active && status === 'open') color = 'bg-emerald-400';
  else if (active && status === 'on_break') color = 'bg-amber-400';
  else if (active) color = 'bg-emerald-400';

  return <span className={`h-2 w-2 rounded-full ${color} shrink-0`} />;
}

function IconButton({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      {icon}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  SlideOver Forms                                                    */
/* ------------------------------------------------------------------ */

function getSlideOverTitle(
  state: SlideOverState,
  vocabulary: Vocabulary,
): string {
  if (!state) return '';
  const labels: Record<string, string> = {
    office: vocabulary.officeLabel,
    department: vocabulary.departmentLabel,
    desk: vocabulary.deskLabel,
  };
  const label = labels[state.type] ?? state.type;
  return state.mode === 'create' ? `New ${label}` : `Edit ${label}`;
}

function SlideOverForm({
  state,
  vocabulary,
  allStaff,
  offices,
  onDone,
}: {
  state: NonNullable<SlideOverState>;
  vocabulary: Vocabulary;
  allStaff: StaffMember[];
  offices: Office[];
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (state.type === 'office') {
    const editing = state.mode === 'edit' ? state.data : null;
    return (
      <form
        action={(formData) => {
          startTransition(async () => {
            setError(null);
            try {
              if (editing) {
                await updateOffice(editing.id, formData);
              } else {
                await createOffice(formData);
              }
              onDone();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Something went wrong');
            }
          });
        }}
      >
        <FormField label="Name" name="name" defaultValue={editing?.name} required />
        <FormField label="Address" name="address" defaultValue={editing?.address ?? ''} />
        <FormField label="Timezone" name="timezone" defaultValue={editing?.timezone ?? ''} placeholder="e.g. America/New_York" />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" value="true" defaultChecked={editing?.is_active ?? true} className="rounded border-border" />
          Active
        </label>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex items-center gap-3">
          <SubmitButton pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitButton>
          {editing && (
            <DeleteButton
              onDelete={async () => {
                await deleteOffice(editing.id);
                onDone();
              }}
              label={vocabulary.officeLabel}
            />
          )}
        </div>
      </form>
    );
  }

  if (state.type === 'department') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    return (
      <form
        action={(formData) => {
          startTransition(async () => {
            setError(null);
            try {
              if (editing) {
                await updateDepartment(editing.id, formData);
              } else {
                await createDepartment(formData);
              }
              onDone();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Something went wrong');
            }
          });
        }}
      >
        <input type="hidden" name="office_id" value={officeId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. reception" />
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" value="true" defaultChecked={editing?.is_active ?? true} className="rounded border-border" />
          Active
        </label>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex items-center gap-3">
          <SubmitButton pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitButton>
          {editing && (
            <DeleteButton
              onDelete={async () => {
                await deleteDepartment(editing.id);
                onDone();
              }}
              label={vocabulary.departmentLabel}
            />
          )}
        </div>
      </form>
    );
  }

  if (state.type === 'desk') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const eligibleStaff = allStaff.filter((s) => s.office_id === officeId);

    return (
      <form
        action={(formData) => {
          startTransition(async () => {
            setError(null);
            try {
              if (editing) {
                await updateDesk(editing.id, formData);
              } else {
                await createDesk(formData);
              }
              onDone();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Something went wrong');
            }
          });
        }}
      >
        <input type="hidden" name="office_id" value={officeId} />
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name (slug)" name="name" defaultValue={editing?.name} required placeholder="e.g. exam-room-1" />
        <FormField label="Display Name" name="display_name" defaultValue={editing?.display_name ?? ''} placeholder="e.g. Exam Room 1" />
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">Assign Staff</label>
          <select
            name="current_staff_id"
            defaultValue={editing?.current_staff?.id ?? ''}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Unassigned</option>
            {eligibleStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({s.role.replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
          <select
            name="status"
            defaultValue={editing?.status ?? 'closed'}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="on_break">On Break</option>
          </select>
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" value="true" defaultChecked={editing?.is_active ?? true} className="rounded border-border" />
          Active
        </label>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-6 flex items-center gap-3">
          <SubmitButton pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitButton>
          {editing && (
            <DeleteButton
              onDelete={async () => {
                await deleteDesk(editing.id);
                onDone();
              }}
              label={vocabulary.deskLabel}
            />
          )}
        </div>
      </form>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Form primitives                                                    */
/* ------------------------------------------------------------------ */

function FormField({
  label,
  name,
  defaultValue,
  required,
  placeholder,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="block text-sm font-medium text-foreground mb-1.5">
        {label}
      </label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ''}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}

function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
    >
      {pending ? 'Saving...' : children}
    </button>
  );
}

function DeleteButton({
  onDelete,
  label,
}: {
  onDelete: () => Promise<void>;
  label: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await onDelete();
          });
        }}
        className="rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
      >
        {isPending ? 'Deleting...' : `Delete ${label}`}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
      >
        Cancel
      </button>
    </div>
  );
}

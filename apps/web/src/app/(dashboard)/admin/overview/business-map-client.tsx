'use client';

import { useState, useTransition, useMemo } from 'react';
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
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  ArrowRight,
  UserPlus,
  Zap,
  CircleDot,
} from 'lucide-react';
import { SlideOver } from '@/components/admin/slide-over';
import {
  createOffice,
  updateOffice,
  deleteOffice,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  createService,
  updateService,
  deleteService,
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
  | { type: 'service'; mode: 'create'; departmentId: string }
  | { type: 'service'; mode: 'edit'; data: Service }
  | { type: 'desk'; mode: 'create'; officeId: string; departmentId: string }
  | { type: 'desk'; mode: 'edit'; data: Desk };

/* ------------------------------------------------------------------ */
/*  Setup Checklist Logic                                              */
/* ------------------------------------------------------------------ */

interface SetupStep {
  key: string;
  label: string;
  description: string;
  done: boolean;
  action?: () => void;
  link?: string;
}

function computeSetupSteps(
  offices: Office[],
  allStaff: StaffMember[],
  vocabulary: Vocabulary,
  actions: {
    addOffice: () => void;
    addDepartment: (officeId: string) => void;
    addService: (deptId: string) => void;
    addDesk: (officeId: string, deptId: string) => void;
  },
): SetupStep[] {
  const allDepts = offices.flatMap((o) => o.departments);
  const allDesks = allDepts.flatMap((d) => d.desks);
  const allServices = allDepts.flatMap((d) => d.services);
  const staffedDesks = allDesks.filter((d) => d.current_staff);

  const firstOffice = offices[0];
  const firstDept = allDepts[0];

  return [
    {
      key: 'office',
      label: `Create your first ${vocabulary.officeLabel.toLowerCase()}`,
      description: `A ${vocabulary.officeLabel.toLowerCase()} is your physical location — a branch, clinic, shop, or office.`,
      done: offices.length > 0,
      action: () => actions.addOffice(),
    },
    {
      key: 'department',
      label: `Add a ${vocabulary.departmentLabel.toLowerCase()}`,
      description: `${vocabulary.departmentLabel}s are areas within your ${vocabulary.officeLabel.toLowerCase()} — e.g. Reception, Consultation, Cashier.`,
      done: allDepts.length > 0,
      action: firstOffice ? () => actions.addDepartment(firstOffice.id) : undefined,
    },
    {
      key: 'service',
      label: `Define at least one ${vocabulary.serviceLabel.toLowerCase()}`,
      description: `${vocabulary.serviceLabel}s are what ${vocabulary.customerLabel.toLowerCase()}s come for — e.g. General Visit, Blood Test, Renewal.`,
      done: allServices.length > 0,
      action: firstDept ? () => actions.addService(firstDept.id) : undefined,
    },
    {
      key: 'desk',
      label: `Set up a ${vocabulary.deskLabel.toLowerCase()}`,
      description: `${vocabulary.deskLabel}s are where staff serve ${vocabulary.customerLabel.toLowerCase()}s — a counter, room, or station.`,
      done: allDesks.length > 0,
      action: firstDept && firstOffice
        ? () => actions.addDesk(firstOffice.id, firstDept.id)
        : undefined,
    },
    {
      key: 'staff',
      label: 'Add a team member',
      description: 'Invite staff so they can log in to their desk and start serving.',
      done: allStaff.length > 1, // > 1 because current user is already staff
      link: '/admin/staff/setup',
    },
    {
      key: 'assign',
      label: `Assign staff to a ${vocabulary.deskLabel.toLowerCase()}`,
      description: `A ${vocabulary.deskLabel.toLowerCase()} needs someone at it to serve ${vocabulary.customerLabel.toLowerCase()}s.`,
      done: staffedDesks.length > 0,
    },
  ];
}

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
    offices.forEach((o) => {
      initial.add(`office:${o.id}`);
      o.departments.forEach((d) => initial.add(`dept:${d.id}`));
    });
    return initial;
  });
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [showChecklist, setShowChecklist] = useState(true);

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
  const totalServices = offices.reduce(
    (s, o) => s + o.departments.reduce((s2, d) => s2 + d.services.length, 0),
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

  const setupSteps = useMemo(
    () =>
      computeSetupSteps(offices, allStaff, vocabulary, {
        addOffice: () => setSlideOver({ type: 'office', mode: 'create' }),
        addDepartment: (officeId) =>
          setSlideOver({ type: 'department', mode: 'create', officeId }),
        addService: (deptId) =>
          setSlideOver({ type: 'service', mode: 'create', departmentId: deptId }),
        addDesk: (officeId, deptId) =>
          setSlideOver({ type: 'desk', mode: 'create', officeId, departmentId: deptId }),
      }),
    [offices, allStaff, vocabulary],
  );

  const completedSteps = setupSteps.filter((s) => s.done).length;
  const allDone = completedSteps === setupSteps.length;
  const nextStep = setupSteps.find((s) => !s.done);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Business Map
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
            Your complete business structure — {vocabulary.officeLabel.toLowerCase()}s,{' '}
            {vocabulary.departmentLabel.toLowerCase()}s,{' '}
            {vocabulary.serviceLabel.toLowerCase()}s,{' '}
            {vocabulary.deskLabel.toLowerCase()}s, and team in one place.
          </p>
        </div>
        {!allDone && !showChecklist && (
          <button
            onClick={() => setShowChecklist(true)}
            className="shrink-0 flex items-center gap-1.5 rounded-xl border border-primary/20 bg-card px-3 py-2 text-xs font-medium text-primary shadow-sm hover:bg-primary/5 transition-colors"
          >
            <Zap className="h-3.5 w-3.5" />
            {completedSteps}/{setupSteps.length} Setup
          </button>
        )}
      </div>

      {/* ── Setup Checklist ────────────────────────────────────── */}
      {!allDone && showChecklist && (
        <div className="mb-6 rounded-2xl border border-primary/20 bg-card shadow-sm overflow-hidden">
          {/* Checklist header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Getting Started — {completedSteps}/{setupSteps.length} completed
                </p>
                <p className="text-xs text-muted-foreground">
                  Complete these steps to start serving {vocabulary.customerLabel.toLowerCase()}s
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowChecklist(false)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Hide
            </button>
          </div>

          {/* Progress bar */}
          <div className="px-5 pt-3 pb-1">
            <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(completedSteps / setupSteps.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Steps */}
          <div className="px-5 py-3 space-y-0.5">
            {setupSteps.map((step) => {
              const isNext = step === nextStep;
              if (step.done) {
                // Compact single-line for completed steps
                return (
                  <div key={step.key} className="flex items-center gap-2.5 px-3 py-1.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary/50" />
                    <p className="text-sm text-muted-foreground line-through">{step.label}</p>
                  </div>
                );
              }
              // Expanded card for next/pending steps
              return (
                <div
                  key={step.key}
                  className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors ${
                    isNext ? 'bg-primary/[0.05] border border-primary/10' : ''
                  }`}
                >
                  {isNext ? (
                    <CircleDot className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
                  ) : (
                    <div className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                  {(step.action || step.link) && (
                    <button
                      onClick={() => {
                        if (step.action) step.action();
                        else if (step.link) router.push(step.link);
                      }}
                      className="shrink-0 flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
                    >
                      {step.key === 'staff' ? 'Invite' : 'Create'}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── All done banner ──────────────────────────────────── */}
      {allDone && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">
              Setup complete!
            </p>
            <p className="text-xs text-emerald-800">
              Your business is fully configured. Staff can now log in and start serving {vocabulary.customerLabel.toLowerCase()}s.
            </p>
          </div>
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label={`${vocabulary.officeLabel}s`}
          value={offices.length}
          alert={offices.length === 0}
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          label={`${vocabulary.departmentLabel}s`}
          value={totalDepts}
          alert={totalDepts === 0 && offices.length > 0}
        />
        <StatCard
          icon={<Grid3X3 className="h-4 w-4" />}
          label={`${vocabulary.serviceLabel}s`}
          value={totalServices}
          alert={totalServices === 0 && totalDepts > 0}
        />
        <StatCard
          icon={<Monitor className="h-4 w-4" />}
          label={`${vocabulary.deskLabel}s`}
          value={`${assignedDesks}/${totalDesks}`}
          subtitle="staffed"
          alert={totalDesks === 0 && totalDepts > 0}
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="Team"
          value={allStaff.length}
          alert={allStaff.length <= 1}
        />
      </div>

      {/* ── Business Tree ────────────────────────────────────── */}
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
            <EmptyState
              icon={<Building2 className="h-8 w-8 text-muted-foreground/40" />}
              title={`No ${vocabulary.officeLabel.toLowerCase()}s yet`}
              description={`Your ${vocabulary.officeLabel.toLowerCase()} is your physical location — a branch, clinic, shop, or restaurant. Start by creating one.`}
              action={() => setSlideOver({ type: 'office', mode: 'create' })}
              actionLabel={`Create ${vocabulary.officeLabel}`}
            />
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
                onAddService={(deptId) =>
                  setSlideOver({
                    type: 'service',
                    mode: 'create',
                    departmentId: deptId,
                  })
                }
                onEditService={(s) =>
                  setSlideOver({ type: 'service', mode: 'edit', data: s })
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

      {/* ── Quick links ──────────────────────────────────────── */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickLink
          icon={<UserPlus className="h-4 w-4" />}
          label="Add team member"
          description="Invite staff to their desk"
          href="/admin/staff/setup"
        />
        <QuickLink
          icon={<Grid3X3 className="h-4 w-4" />}
          label={`Manage ${vocabulary.serviceLabel.toLowerCase()}s`}
          description="Detailed service configuration"
          href="/admin/services"
        />
        <QuickLink
          icon={<Monitor className="h-4 w-4" />}
          label="Display screens"
          description="Configure waiting room TVs"
          href="/admin/displays"
        />
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
  subtitle,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  alert?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${alert ? 'border-amber-200 bg-amber-50' : 'border-border/60 bg-card'}`}>
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">
          {label}
        </span>
        {alert && <AlertCircle className="h-3 w-3 text-amber-500 ml-auto" />}
      </div>
      <p className="mt-1 text-lg font-semibold text-foreground">
        {value}
        {subtitle && <span className="ml-1 text-xs font-normal text-muted-foreground">{subtitle}</span>}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick Link Card                                                    */
/* ------------------------------------------------------------------ */

function QuickLink({
  icon,
  label,
  description,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                        */
/* ------------------------------------------------------------------ */

function EmptyState({
  icon,
  title,
  description,
  action,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
        {icon}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-sm text-xs text-muted-foreground leading-relaxed">{description}</p>
      <button
        onClick={action}
        className="mt-4 flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Hint                                                        */
/* ------------------------------------------------------------------ */

function InlineHint({
  message,
  action,
  actionLabel,
}: {
  message: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 mx-2 my-1.5">
      <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0" />
      <span className="text-xs text-amber-900 flex-1">{message}</span>
      <button
        onClick={action}
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        {actionLabel}
      </button>
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
  onAddService,
  onEditService,
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
  onAddService: (deptId: string) => void;
  onEditService: (s: Service) => void;
  onAddDesk: (officeId: string, departmentId: string) => void;
  onEditDesk: (d: Desk) => void;
}) {
  const officeStaff = allStaff.filter((s) => s.office_id === office.id);
  const hasDepts = office.departments.length > 0;

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
          {!hasDepts ? (
            <InlineHint
              message={`This ${vocabulary.officeLabel.toLowerCase()} needs at least one ${vocabulary.departmentLabel.toLowerCase()} to organize your ${vocabulary.serviceLabel.toLowerCase()}s.`}
              action={() => onAddDept(office.id)}
              actionLabel={`+ Add ${vocabulary.departmentLabel}`}
            />
          ) : (
            office.departments.map((dept) => (
              <DepartmentNode
                key={dept.id}
                dept={dept}
                officeId={office.id}
                vocabulary={vocabulary}
                isExpanded={expandedDepts.has(`dept:${dept.id}`)}
                onToggle={onToggle}
                onEdit={onEditDept}
                onAddService={onAddService}
                onEditService={onEditService}
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
  officeId,
  vocabulary,
  isExpanded,
  onToggle,
  onEdit,
  onAddService,
  onEditService,
  onAddDesk,
  onEditDesk,
}: {
  dept: Department;
  officeId: string;
  vocabulary: Vocabulary;
  isExpanded: boolean;
  onToggle: (key: string) => void;
  onEdit: (d: Department) => void;
  onAddService: (deptId: string) => void;
  onEditService: (s: Service) => void;
  onAddDesk: (deptId: string) => void;
  onEditDesk: (d: Desk) => void;
}) {
  const hasServices = dept.services.length > 0;
  const hasDesks = dept.desks.length > 0;
  const needsAttention = !hasServices || !hasDesks;

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
          {dept.services.length} {vocabulary.serviceLabel.toLowerCase()}
          {dept.services.length !== 1 ? 's' : ''}
          {' · '}
          {dept.desks.length} {vocabulary.deskLabel.toLowerCase()}
          {dept.desks.length !== 1 ? 's' : ''}
        </span>
        {needsAttention && (
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
        )}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton
            icon={<Grid3X3 className="h-3.5 w-3.5" />}
            title={`Add ${vocabulary.serviceLabel}`}
            onClick={() => onAddService(dept.id)}
          />
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

      {/* Children */}
      {isExpanded && (
        <div className="ml-6 border-l border-border/30">
          {/* Services section */}
          <div className="py-1">
            {hasServices ? (
              dept.services.map((svc) => (
                <ServiceNode
                  key={svc.id}
                  service={svc}
                  vocabulary={vocabulary}
                  onEdit={onEditService}
                />
              ))
            ) : (
              <InlineHint
                message={`Add a ${vocabulary.serviceLabel.toLowerCase()} so ${vocabulary.customerLabel.toLowerCase()}s know what you offer — e.g. General Visit, Consultation.`}
                action={() => onAddService(dept.id)}
                actionLabel={`+ Add ${vocabulary.serviceLabel}`}
              />
            )}
          </div>

          {/* Desks section */}
          <div className="py-1">
            {hasDesks ? (
              dept.desks.map((desk) => (
                <DeskNode
                  key={desk.id}
                  desk={desk}
                  vocabulary={vocabulary}
                  onEdit={onEditDesk}
                />
              ))
            ) : (
              <InlineHint
                message={`Create a ${vocabulary.deskLabel.toLowerCase()} where staff will serve ${vocabulary.customerLabel.toLowerCase()}s — a counter, window, or room.`}
                action={() => onAddDesk(dept.id)}
                actionLabel={`+ Add ${vocabulary.deskLabel}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Service Node                                                       */
/* ------------------------------------------------------------------ */

function ServiceNode({
  service,
  vocabulary,
  onEdit,
}: {
  service: Service;
  vocabulary: Vocabulary;
  onEdit: (s: Service) => void;
}) {
  return (
    <div className="group flex items-center gap-2 py-1.5 pl-6 pr-5 hover:bg-muted/10 transition-colors">
      <div className="h-6 w-6" />
      <StatusDot active={service.is_active} />
      <Grid3X3 className="h-3.5 w-3.5 text-sky-500" />
      <span className="text-sm text-foreground">{service.name}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        {service.code}
      </span>
      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconButton
          icon={<Pencil className="h-3.5 w-3.5" />}
          title="Edit"
          onClick={() => onEdit(service)}
        />
      </div>
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
    <div className="group flex items-center gap-2 py-1.5 pl-6 pr-5 hover:bg-muted/10 transition-colors">
      <div className="h-6 w-6" />
      <StatusDot active={desk.is_active} status={desk.status} />
      <Monitor className="h-3.5 w-3.5 text-emerald-500" />
      <span className="text-sm text-foreground">
        {desk.display_name || desk.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {desk.current_staff ? (
          <span className="text-foreground font-medium">
            {desk.current_staff.full_name}
          </span>
        ) : (
          <span className="italic text-amber-500">Unassigned</span>
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
    service: vocabulary.serviceLabel,
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

  /* ── Office form ─────────────────────────────────────────── */
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
        <FormHint>
          A {vocabulary.officeLabel.toLowerCase()} represents a physical location where you serve {vocabulary.customerLabel.toLowerCase()}s — like a branch, clinic, or shop.
        </FormHint>
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder={`e.g. Main ${vocabulary.officeLabel}`} />
        <FormField label="Address" name="address" defaultValue={editing?.address ?? ''} placeholder="e.g. 123 Main St" />
        <FormField label="Timezone" name="timezone" defaultValue={editing?.timezone ?? ''} placeholder="e.g. Africa/Algiers" />
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
        {!editing && (
          <FormNextStep>
            After creating this {vocabulary.officeLabel.toLowerCase()}, you&apos;ll add {vocabulary.departmentLabel.toLowerCase()}s inside it.
          </FormNextStep>
        )}
      </form>
    );
  }

  /* ── Department form ─────────────────────────────────────── */
  if (state.type === 'department') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const officeName = offices.find((o) => o.id === officeId)?.name ?? '';
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
        <FormHint>
          A {vocabulary.departmentLabel.toLowerCase()} is an area inside <strong>{officeName}</strong> — e.g. Reception, Cashier, Lab, or Exam Rooms.
        </FormHint>
        <input type="hidden" name="office_id" value={officeId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. Reception" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. RECEPTION" />
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
        {!editing && (
          <FormNextStep>
            Next: add {vocabulary.serviceLabel.toLowerCase()}s (what you offer) and {vocabulary.deskLabel.toLowerCase()}s (where staff serve).
          </FormNextStep>
        )}
      </form>
    );
  }

  /* ── Service form ────────────────────────────────────────── */
  if (state.type === 'service') {
    const editing = state.mode === 'edit' ? state.data : null;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    // Find dept name for context
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);
    return (
      <form
        action={(formData) => {
          startTransition(async () => {
            setError(null);
            try {
              if (editing) {
                await updateService(editing.id, formData);
              } else {
                await createService(formData);
              }
              onDone();
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Something went wrong');
            }
          });
        }}
      >
        <FormHint>
          A {vocabulary.serviceLabel.toLowerCase()} is what {vocabulary.customerLabel.toLowerCase()}s come for{dept ? <> in <strong>{dept.name}</strong></> : ''} — e.g. General Visit, Blood Test, Account Opening.
        </FormHint>
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. General Visit" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. GEN-VISIT" />
        <FormField
          label="Estimated duration (minutes)"
          name="estimated_service_time"
          defaultValue={editing ? undefined : '15'}
          type="number"
          placeholder="e.g. 15"
        />
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
                await deleteService(editing.id);
                onDone();
              }}
              label={vocabulary.serviceLabel}
            />
          )}
        </div>
      </form>
    );
  }

  /* ── Desk form ───────────────────────────────────────────── */
  if (state.type === 'desk') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const eligibleStaff = allStaff.filter((s) => s.office_id === officeId);
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);

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
        <FormHint>
          A {vocabulary.deskLabel.toLowerCase()} is where a staff member serves {vocabulary.customerLabel.toLowerCase()}s{dept ? <> in <strong>{dept.name}</strong></> : ''} — a counter, window, or exam room.
        </FormHint>
        <input type="hidden" name="office_id" value={officeId} />
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name (slug)" name="name" defaultValue={editing?.name} required placeholder="e.g. counter-1" />
        <FormField label="Display Name" name="display_name" defaultValue={editing?.display_name ?? ''} placeholder="e.g. Counter 1" />
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
          {eligibleStaff.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600">
              No team members in this {vocabulary.officeLabel.toLowerCase()} yet.{' '}
              <a href="/admin/staff/setup" className="text-primary hover:underline">Add a team member</a> first.
            </p>
          )}
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

function FormHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-900">
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function FormNextStep({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

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

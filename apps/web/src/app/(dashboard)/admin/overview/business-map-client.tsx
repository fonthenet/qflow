'use client';

import { useState, useTransition, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Layers,
  Monitor,
  Plus,
  Pencil,
  Trash2,
  Grid3X3,
  Users,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  ArrowRight,
  UserPlus,
  Zap,
  CircleDot,
  Clock,
  User,
  Tv,
  ChevronRight,
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

/* ══════════════════════════════════════════════════════════════════ */
/*  Types                                                            */
/* ══════════════════════════════════════════════════════════════════ */

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
  estimated_service_time: number | null;
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

/* ══════════════════════════════════════════════════════════════════ */
/*  Health / Readiness                                               */
/* ══════════════════════════════════════════════════════════════════ */

type Health = 'ready' | 'warning' | 'error';

function deptHealth(dept: Department): Health {
  if (dept.services.length === 0 && dept.desks.length === 0) return 'error';
  if (dept.services.length === 0 || dept.desks.length === 0) return 'warning';
  const hasStaffedDesk = dept.desks.some((d) => d.current_staff);
  if (!hasStaffedDesk) return 'warning';
  return 'ready';
}

function officeHealth(office: Office): Health {
  if (office.departments.length === 0) return 'error';
  const healths = office.departments.map(deptHealth);
  if (healths.some((h) => h === 'error')) return 'error';
  if (healths.some((h) => h === 'warning')) return 'warning';
  return 'ready';
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Setup Checklist                                                  */
/* ══════════════════════════════════════════════════════════════════ */

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
      action: firstDept && firstOffice ? () => actions.addDesk(firstOffice.id, firstDept.id) : undefined,
    },
    {
      key: 'staff',
      label: 'Add a team member',
      description: 'Invite staff so they can log in to their desk and start serving.',
      done: allStaff.length > 1,
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

/* ══════════════════════════════════════════════════════════════════ */
/*  Main Component                                                   */
/* ══════════════════════════════════════════════════════════════════ */

export function BusinessMapClient({
  organizationName,
  offices,
  allStaff,
  vocabulary,
}: BusinessMapProps) {
  const router = useRouter();
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(() => new Set());
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [showChecklist, setShowChecklist] = useState(true);

  const toggleDept = useCallback((id: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /* Totals */
  const totalDepts = offices.reduce((s, o) => s + o.departments.length, 0);
  const totalServices = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.services.length, 0), 0);
  const totalDesks = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.desks.length, 0), 0);
  const assignedDesks = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.desks.filter((dk) => dk.current_staff).length, 0), 0);

  /* Setup steps */
  const setupSteps = useMemo(
    () =>
      computeSetupSteps(offices, allStaff, vocabulary, {
        addOffice: () => setSlideOver({ type: 'office', mode: 'create' }),
        addDepartment: (officeId) => setSlideOver({ type: 'department', mode: 'create', officeId }),
        addService: (deptId) => setSlideOver({ type: 'service', mode: 'create', departmentId: deptId }),
        addDesk: (officeId, deptId) => setSlideOver({ type: 'desk', mode: 'create', officeId, departmentId: deptId }),
      }),
    [offices, allStaff, vocabulary],
  );
  const completedSteps = setupSteps.filter((s) => s.done).length;
  const allDone = completedSteps === setupSteps.length;
  const nextStep = setupSteps.find((s) => !s.done);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Map</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {organizationName} — build, configure, and monitor your business structure
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!allDone && !showChecklist && (
              <button
                onClick={() => setShowChecklist(true)}
                className="flex items-center gap-1.5 rounded-xl border border-primary/20 bg-card px-3 py-2 text-xs font-medium text-primary shadow-sm hover:bg-primary/5 transition-colors"
              >
                <Zap className="h-3.5 w-3.5" />
                {completedSteps}/{setupSteps.length} Setup
              </button>
            )}
            <button
              onClick={() => setSlideOver({ type: 'office', mode: 'create' })}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add {vocabulary.officeLabel}
            </button>
          </div>
        </div>

        {/* Stats chips */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <StatChip icon={Building2} label={`${offices.length} ${vocabulary.officeLabel.toLowerCase()}${offices.length !== 1 ? 's' : ''}`} />
          <Dot />
          <StatChip icon={Layers} label={`${totalDepts} ${vocabulary.departmentLabel.toLowerCase()}${totalDepts !== 1 ? 's' : ''}`} />
          <Dot />
          <StatChip icon={Grid3X3} label={`${totalServices} ${vocabulary.serviceLabel.toLowerCase()}${totalServices !== 1 ? 's' : ''}`} />
          <Dot />
          <StatChip icon={Monitor} label={`${assignedDesks}/${totalDesks} ${vocabulary.deskLabel.toLowerCase()}${totalDesks !== 1 ? 's' : ''} staffed`} />
          <Dot />
          <StatChip icon={Users} label={`${allStaff.length} team member${allStaff.length !== 1 ? 's' : ''}`} />
        </div>
      </div>

      {/* ── Setup Checklist ────────────────────────────────── */}
      {!allDone && showChecklist && (
        <div className="mb-8 rounded-2xl border border-primary/20 bg-card shadow-sm overflow-hidden">
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
            <button onClick={() => setShowChecklist(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Hide
            </button>
          </div>
          <div className="px-5 pt-3 pb-1">
            <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${(completedSteps / setupSteps.length) * 100}%` }}
              />
            </div>
          </div>
          <div className="px-5 py-3 space-y-0.5">
            {setupSteps.map((step) => {
              const isNext = step === nextStep;
              if (step.done) {
                return (
                  <div key={step.key} className="flex items-center gap-2.5 px-3 py-1.5">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary/50" />
                    <p className="text-sm text-muted-foreground line-through">{step.label}</p>
                  </div>
                );
              }
              return (
                <div key={step.key} className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors ${isNext ? 'bg-primary/[0.05] border border-primary/10' : ''}`}>
                  {isNext ? (
                    <CircleDot className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary" />
                  ) : (
                    <div className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{step.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{step.description}</p>
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

      {/* ── All-done banner ────────────────────────────────── */}
      {allDone && (
        <div className="mb-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">Setup complete!</p>
            <p className="text-xs text-emerald-800">
              Your business is fully configured. Staff can now log in and start serving {vocabulary.customerLabel.toLowerCase()}s.
            </p>
          </div>
        </div>
      )}

      {/* ── Empty State (no offices) ──────────────────────── */}
      {offices.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-border/60 bg-card/50 px-8 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 mb-5">
            <Building2 className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p className="text-lg font-semibold text-foreground">No {vocabulary.officeLabel.toLowerCase()}s yet</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
            Start by creating your first {vocabulary.officeLabel.toLowerCase()} — this is the physical location where your{' '}
            {vocabulary.customerLabel.toLowerCase()}s come to be served.
          </p>
          <button
            onClick={() => setSlideOver({ type: 'office', mode: 'create' })}
            className="mt-6 flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Create Your First {vocabulary.officeLabel}
          </button>
        </div>
      ) : (
        /* ── Office Grid ─────────────────────────────────── */
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 items-start">
          {offices.map((office) => (
            <OfficeCard
              key={office.id}
              office={office}
              allStaff={allStaff}
              vocabulary={vocabulary}
              expandedDepts={expandedDepts}
              onToggleDept={toggleDept}
              onEdit={(o) => setSlideOver({ type: 'office', mode: 'edit', data: o })}
              onAddDept={(oid) => setSlideOver({ type: 'department', mode: 'create', officeId: oid })}
              onEditDept={(d) => setSlideOver({ type: 'department', mode: 'edit', data: d })}
              onAddService={(did) => setSlideOver({ type: 'service', mode: 'create', departmentId: did })}
              onEditService={(s) => setSlideOver({ type: 'service', mode: 'edit', data: s })}
              onAddDesk={(oid, did) => setSlideOver({ type: 'desk', mode: 'create', officeId: oid, departmentId: did })}
              onEditDesk={(d) => setSlideOver({ type: 'desk', mode: 'edit', data: d })}
            />
          ))}

          {/* Ghost "Add Office" card */}
          <button
            onClick={() => setSlideOver({ type: 'office', mode: 'create' })}
            className="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border/50 bg-card/30 hover:border-primary/40 hover:bg-primary/[0.02] transition-all cursor-pointer"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              <Plus className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">
              Add {vocabulary.officeLabel}
            </p>
          </button>
        </div>
      )}

      {/* ── Quick Links ────────────────────────────────────── */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: UserPlus, label: 'Add team member', desc: 'Invite staff to their desk', href: '/admin/staff/setup' },
          { icon: Grid3X3, label: `Manage ${vocabulary.serviceLabel.toLowerCase()}s`, desc: 'Detailed service configuration', href: '/admin/services' },
          { icon: Tv, label: 'Display screens', desc: 'Configure waiting room TVs', href: '/admin/displays' },
        ].map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm hover:border-primary/30 hover:shadow-md transition-all"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
              <item.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
          </a>
        ))}
      </div>

      {/* ── SlideOver ──────────────────────────────────────── */}
      <SlideOver open={slideOver !== null} onClose={() => setSlideOver(null)} title={getSlideOverTitle(slideOver, vocabulary)}>
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

/* ══════════════════════════════════════════════════════════════════ */
/*  Office Card                                                      */
/* ══════════════════════════════════════════════════════════════════ */

function OfficeCard({
  office,
  allStaff,
  vocabulary,
  expandedDepts,
  onToggleDept,
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
  expandedDepts: Set<string>;
  onToggleDept: (id: string) => void;
  onEdit: (o: Office) => void;
  onAddDept: (oid: string) => void;
  onEditDept: (d: Department) => void;
  onAddService: (did: string) => void;
  onEditService: (s: Service) => void;
  onAddDesk: (oid: string, did: string) => void;
  onEditDesk: (d: Desk) => void;
}) {
  const health = officeHealth(office);
  const officeStaff = allStaff.filter((s) => s.office_id === office.id);
  const totalDesks = office.departments.reduce((s, d) => s + d.desks.length, 0);
  const totalServices = office.departments.reduce((s, d) => s + d.services.length, 0);

  const accentColor = {
    ready: 'bg-emerald-400',
    warning: 'bg-amber-400',
    error: 'bg-red-400',
  }[health];

  return (
    <div className="relative rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accentColor}`} />

      {/* ── Office Header ── */}
      <div className="px-5 py-4 pl-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <Building2 className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-foreground">{office.name}</h3>
              <HealthBadge health={health} />
              {!office.is_active && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Inactive
                </span>
              )}
            </div>
            {office.address && <p className="mt-0.5 text-xs text-muted-foreground truncate">{office.address}</p>}
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                {office.departments.length} {vocabulary.departmentLabel.toLowerCase()}
                {office.departments.length !== 1 ? 's' : ''}
              </span>
              <span className="text-border">·</span>
              <span>
                {totalServices} {vocabulary.serviceLabel.toLowerCase()}
                {totalServices !== 1 ? 's' : ''}
              </span>
              <span className="text-border">·</span>
              <span>
                {totalDesks} {vocabulary.deskLabel.toLowerCase()}
                {totalDesks !== 1 ? 's' : ''}
              </span>
              <span className="text-border">·</span>
              <span>{officeStaff.length} staff</span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <SmallBtn icon={Plus} title={`Add ${vocabulary.departmentLabel}`} onClick={() => onAddDept(office.id)} />
            <SmallBtn icon={Pencil} title="Edit" onClick={() => onEdit(office)} />
          </div>
        </div>
      </div>

      {/* ── Department Tree ── */}
      <div className="border-t border-border/30 px-5 py-4 pl-6">
        {office.departments.length === 0 ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-500 mb-3">
              <Layers className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No {vocabulary.departmentLabel.toLowerCase()}s yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground max-w-[240px]">
              Add {vocabulary.departmentLabel.toLowerCase()}s to organize {vocabulary.serviceLabel.toLowerCase()}s inside this{' '}
              {vocabulary.officeLabel.toLowerCase()}.
            </p>
            <button
              onClick={() => onAddDept(office.id)}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add {vocabulary.departmentLabel}
            </button>
          </div>
        ) : (
          <div>
            {office.departments.map((dept, i) => (
              <DeptTreeNode
                key={dept.id}
                dept={dept}
                officeId={office.id}
                vocabulary={vocabulary}
                isLast={i === office.departments.length - 1}
                isExpanded={expandedDepts.has(dept.id)}
                onToggle={() => onToggleDept(dept.id)}
                onEdit={() => onEditDept(dept)}
                onAddService={() => onAddService(dept.id)}
                onEditService={onEditService}
                onAddDesk={() => onAddDesk(office.id, dept.id)}
                onEditDesk={onEditDesk}
              />
            ))}
            {/* Add department at bottom of tree */}
            <div style={{ paddingLeft: 28 }}>
              <button
                onClick={() => onAddDept(office.id)}
                className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border/50 py-2 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add {vocabulary.departmentLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Department Tree Node                                             */
/* ══════════════════════════════════════════════════════════════════ */

function DeptTreeNode({
  dept,
  officeId,
  vocabulary,
  isLast,
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
  isLast: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddService: () => void;
  onEditService: (s: Service) => void;
  onAddDesk: () => void;
  onEditDesk: (d: Desk) => void;
}) {
  const health = deptHealth(dept);

  const dotColor = {
    ready: 'bg-emerald-500',
    warning: 'bg-amber-400',
    error: 'border-2 border-red-300 bg-white',
  }[health];

  return (
    <div className="relative" style={{ paddingLeft: 28, paddingBottom: isLast ? 0 : 6 }}>
      {/* ── Tree connectors ── */}
      {/* Vertical line */}
      <div
        className="absolute w-px bg-border/50"
        style={{ left: 10, top: 0, height: isLast ? 16 : '100%' }}
      />
      {/* Horizontal branch */}
      <div className="absolute h-px bg-border/50" style={{ left: 10, top: 16, width: 14 }} />
      {/* Health dot at junction */}
      <div className={`absolute rounded-full ${dotColor}`} style={{ left: 6, top: 12, width: 9, height: 9 }} />

      {/* ── Department header (clickable) ── */}
      <div
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 -ml-1 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <ChevronRight
          className={`h-3 w-3 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-100 text-violet-600 shrink-0">
          <Layers className="h-3 w-3" />
        </div>
        <span className="text-sm font-semibold text-foreground truncate">{dept.name}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0">
          {dept.code}
        </span>
        <span className="flex-1" />
        {/* Inline mini stats */}
        <span className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
          <span className="flex items-center gap-0.5">
            <Grid3X3 className="h-2.5 w-2.5" />
            {dept.services.length}
          </span>
          <span className="flex items-center gap-0.5">
            <Monitor className="h-2.5 w-2.5" />
            {dept.desks.length}
          </span>
        </span>
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <SmallBtn icon={Pencil} title="Edit" onClick={onEdit} />
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {isExpanded && (
        <DeptDetail
          dept={dept}
          vocabulary={vocabulary}
          onAddService={onAddService}
          onEditService={onEditService}
          onAddDesk={onAddDesk}
          onEditDesk={onEditDesk}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Department Detail (services + desks split)                       */
/* ══════════════════════════════════════════════════════════════════ */

function DeptDetail({
  dept,
  vocabulary,
  onAddService,
  onEditService,
  onAddDesk,
  onEditDesk,
}: {
  dept: Department;
  vocabulary: Vocabulary;
  onAddService: () => void;
  onEditService: (s: Service) => void;
  onAddDesk: () => void;
  onEditDesk: (d: Desk) => void;
}) {
  return (
    <div className="mt-2 mb-1 rounded-lg border border-border/40 bg-muted/[0.08] overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-border/30">
        {/* ── Services column ── */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Grid3X3 className="h-2.5 w-2.5" />
              {vocabulary.serviceLabel}s
            </p>
            <button
              onClick={onAddService}
              className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5"
            >
              <Plus className="h-2.5 w-2.5" />
              Add
            </button>
          </div>
          {dept.services.length === 0 ? (
            <button
              onClick={onAddService}
              className="w-full flex flex-col items-center gap-1 rounded border-2 border-dashed border-border/40 py-3 text-center hover:border-primary/30 transition-colors group"
            >
              <AlertCircle className="h-3.5 w-3.5 text-amber-400 group-hover:text-primary transition-colors" />
              <p className="text-[10px] text-muted-foreground">No {vocabulary.serviceLabel.toLowerCase()}s</p>
            </button>
          ) : (
            <div className="space-y-0.5">
              {dept.services.map((svc) => (
                <div
                  key={svc.id}
                  className="group/svc flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-card transition-colors"
                >
                  <StatusDot active={svc.is_active} />
                  <span className="text-xs text-foreground flex-1 truncate">{svc.name}</span>
                  {svc.estimated_service_time && (
                    <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                      <Clock className="h-2 w-2" />
                      {svc.estimated_service_time}m
                    </span>
                  )}
                  <button
                    onClick={() => onEditService(svc)}
                    className="opacity-0 group-hover/svc:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                  >
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Desks column ── */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Monitor className="h-2.5 w-2.5" />
              {vocabulary.deskLabel}s
            </p>
            <button
              onClick={onAddDesk}
              className="text-[10px] font-medium text-primary hover:underline flex items-center gap-0.5"
            >
              <Plus className="h-2.5 w-2.5" />
              Add
            </button>
          </div>
          {dept.desks.length === 0 ? (
            <button
              onClick={onAddDesk}
              className="w-full flex flex-col items-center gap-1 rounded border-2 border-dashed border-border/40 py-3 text-center hover:border-primary/30 transition-colors group"
            >
              <AlertCircle className="h-3.5 w-3.5 text-amber-400 group-hover:text-primary transition-colors" />
              <p className="text-[10px] text-muted-foreground">No {vocabulary.deskLabel.toLowerCase()}s</p>
            </button>
          ) : (
            <div className="space-y-0.5">
              {dept.desks.map((desk) => (
                <div
                  key={desk.id}
                  className="group/desk flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-card transition-colors"
                >
                  <DeskStatusDot status={desk.status} active={desk.is_active} />
                  <span className="text-xs text-foreground truncate">{desk.display_name || desk.name}</span>
                  <span className="flex-1" />
                  {desk.current_staff ? (
                    <span className="flex items-center gap-0.5 text-[9px] text-foreground font-medium">
                      <User className="h-2 w-2 text-muted-foreground" />
                      <span className="truncate max-w-[60px]">{desk.current_staff.full_name}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-[9px] text-amber-600 font-medium">
                      <AlertCircle className="h-2 w-2" />
                      <span>—</span>
                    </span>
                  )}
                  <button
                    onClick={() => onEditDesk(desk)}
                    className="opacity-0 group-hover/desk:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity"
                  >
                    <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Small UI Pieces                                                  */
/* ══════════════════════════════════════════════════════════════════ */

function HealthBadge({ health }: { health: Health }) {
  const cfg = {
    ready: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
  }[health];
  const label = { ready: 'Ready', warning: 'Needs setup', error: 'Not configured' }[health];
  const Icon = health === 'ready' ? CheckCircle2 : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function StatChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      <span>{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-border/80">·</span>;
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? 'bg-emerald-400' : 'bg-gray-300'}`} />;
}

function DeskStatusDot({ status, active }: { status: string; active: boolean }) {
  let color = 'bg-gray-300';
  if (active && status === 'open') color = 'bg-emerald-400';
  else if (active && status === 'on_break') color = 'bg-amber-400';
  else if (active) color = 'bg-blue-400';
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />;
}

function SmallBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
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
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  SlideOver Forms                                                  */
/* ══════════════════════════════════════════════════════════════════ */

function getSlideOverTitle(state: SlideOverState, vocabulary: Vocabulary): string {
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

  const submit = (fn: (fd: FormData) => Promise<void>) => (formData: FormData) => {
    startTransition(async () => {
      setError(null);
      try {
        await fn(formData);
        onDone();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
    });
  };

  /* ── Office ── */
  if (state.type === 'office') {
    const editing = state.mode === 'edit' ? state.data : null;
    return (
      <form
        action={submit(async (fd) => {
          editing ? await updateOffice(editing.id, fd) : await createOffice(fd);
        })}
      >
        <FormHint>
          A {vocabulary.officeLabel.toLowerCase()} represents a physical location where you serve{' '}
          {vocabulary.customerLabel.toLowerCase()}s — a branch, clinic, or shop.
        </FormHint>
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder={`e.g. Main ${vocabulary.officeLabel}`} />
        <FormField label="Address" name="address" defaultValue={editing?.address ?? ''} placeholder="e.g. 123 Main St" />
        <FormField label="Timezone" name="timezone" defaultValue={editing?.timezone ?? ''} placeholder="e.g. Africa/Algiers" />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteOffice(editing.id).then(onDone)} label={vocabulary.officeLabel} />}
        </FormActions>
        {!editing && (
          <FormNextStep>
            After creating this {vocabulary.officeLabel.toLowerCase()}, you&apos;ll add {vocabulary.departmentLabel.toLowerCase()}s inside it.
          </FormNextStep>
        )}
      </form>
    );
  }

  /* ── Department ── */
  if (state.type === 'department') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const officeName = offices.find((o) => o.id === officeId)?.name ?? '';
    return (
      <form
        action={submit(async (fd) => {
          editing ? await updateDepartment(editing.id, fd) : await createDepartment(fd);
        })}
      >
        <FormHint>
          A {vocabulary.departmentLabel.toLowerCase()} is an area inside <strong>{officeName}</strong> — e.g. Reception, Cashier, Lab.
        </FormHint>
        <input type="hidden" name="office_id" value={officeId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. Reception" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. RECEPTION" />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteDepartment(editing.id).then(onDone)} label={vocabulary.departmentLabel} />}
        </FormActions>
        {!editing && (
          <FormNextStep>
            Next: add {vocabulary.serviceLabel.toLowerCase()}s (what you offer) and {vocabulary.deskLabel.toLowerCase()}s (where staff serve).
          </FormNextStep>
        )}
      </form>
    );
  }

  /* ── Service ── */
  if (state.type === 'service') {
    const editing = state.mode === 'edit' ? state.data : null;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);
    return (
      <form
        action={submit(async (fd) => {
          editing ? await updateService(editing.id, fd) : await createService(fd);
        })}
      >
        <FormHint>
          A {vocabulary.serviceLabel.toLowerCase()} is what {vocabulary.customerLabel.toLowerCase()}s come for
          {dept ? (
            <>
              {' '}
              in <strong>{dept.name}</strong>
            </>
          ) : (
            ''
          )}{' '}
          — e.g. General Visit, Blood Test.
        </FormHint>
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. General Visit" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. GEN-VISIT" />
        <FormField
          label="Estimated duration (minutes)"
          name="estimated_service_time"
          defaultValue={editing?.estimated_service_time?.toString() ?? '15'}
          type="number"
          placeholder="e.g. 15"
        />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteService(editing.id).then(onDone)} label={vocabulary.serviceLabel} />}
        </FormActions>
      </form>
    );
  }

  /* ── Desk ── */
  if (state.type === 'desk') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const eligibleStaff = allStaff.filter((s) => s.office_id === officeId);
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);
    return (
      <form
        action={submit(async (fd) => {
          editing ? await updateDesk(editing.id, fd) : await createDesk(fd);
        })}
      >
        <FormHint>
          A {vocabulary.deskLabel.toLowerCase()} is where staff serve {vocabulary.customerLabel.toLowerCase()}s
          {dept ? (
            <>
              {' '}
              in <strong>{dept.name}</strong>
            </>
          ) : (
            ''
          )}{' '}
          — a counter, window, or room.
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
              <a href="/admin/staff/setup" className="text-primary hover:underline">
                Add a team member
              </a>{' '}
              first.
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
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteDesk(editing.id).then(onDone)} label={vocabulary.deskLabel} />}
        </FormActions>
      </form>
    );
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════════ */
/*  Form Primitives                                                  */
/* ══════════════════════════════════════════════════════════════════ */

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
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
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

function Checkbox({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="mt-4 flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked} className="rounded border-border" />
      {label}
    </label>
  );
}

function FormActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex items-center gap-3">{children}</div>;
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm text-destructive">{children}</p>;
}

function SubmitBtn({ pending, children }: { pending: boolean; children: React.ReactNode }) {
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

function DeleteBtn({ onDelete, label }: { onDelete: () => Promise<void>; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await onDelete();
          })
        }
        className="rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
      >
        {isPending ? 'Deleting...' : `Delete ${label}`}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted">
        Cancel
      </button>
    </div>
  );
}

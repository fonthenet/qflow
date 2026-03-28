'use client';

import { useState, useTransition, useMemo, useCallback } from 'react';
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
  Clock,
  User,
  Tv,
  Shield,
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

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

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

/* ================================================================== */
/*  Health / Readiness                                                 */
/* ================================================================== */

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

function healthLabel(h: Health): string {
  if (h === 'ready') return 'Ready';
  if (h === 'warning') return 'Needs setup';
  return 'Not configured';
}

function HealthBadge({ health }: { health: Health }) {
  const cfg = {
    ready: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-100 text-amber-700 border-amber-200',
    error: 'bg-red-100 text-red-700 border-red-200',
  }[health];
  const Icon = health === 'ready' ? CheckCircle2 : AlertCircle;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg}`}>
      <Icon className="h-3 w-3" />
      {healthLabel(health)}
    </span>
  );
}

/* ================================================================== */
/*  Setup Checklist                                                    */
/* ================================================================== */

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

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

export function BusinessMapClient({
  organizationName,
  offices,
  allStaff,
  vocabulary,
}: BusinessMapProps) {
  const router = useRouter();
  const [expandedOffices, setExpandedOffices] = useState<Set<string>>(
    () => new Set(offices.map((o) => o.id)),
  );
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(
    () => new Set(offices.flatMap((o) => o.departments.map((d) => d.id))),
  );
  const [slideOver, setSlideOver] = useState<SlideOverState>(null);
  const [showChecklist, setShowChecklist] = useState(true);

  const toggleOffice = useCallback((id: string) => {
    setExpandedOffices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleDept = useCallback((id: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Stats
  const totalDepts = offices.reduce((s, o) => s + o.departments.length, 0);
  const totalServices = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.services.length, 0), 0);
  const totalDesks = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.desks.length, 0), 0);
  const assignedDesks = offices.reduce((s, o) => s + o.departments.reduce((s2, d) => s2 + d.desks.filter((dk) => dk.current_staff).length, 0), 0);

  // Setup checklist
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
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

      {/* ── Header ───────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Map</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your complete business structure — build, configure, and monitor everything in one place.
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

      {/* ── Setup Checklist ──────────────────────────────── */}
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
            <button onClick={() => setShowChecklist(false)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Hide</button>
          </div>
          <div className="px-5 pt-3 pb-1">
            <div className="h-1.5 rounded-full bg-primary/10 overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${(completedSteps / setupSteps.length) * 100}%` }} />
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
                      onClick={() => { if (step.action) step.action(); else if (step.link) router.push(step.link); }}
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

      {/* ── All-done banner ──────────────────────────────── */}
      {allDone && (
        <div className="mb-8 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-900">Setup complete!</p>
            <p className="text-xs text-emerald-800">Your business is fully configured. Staff can now log in and start serving {vocabulary.customerLabel.toLowerCase()}s.</p>
          </div>
        </div>
      )}

      {/* ── Stats Row ────────────────────────────────────── */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { icon: Building2, label: `${vocabulary.officeLabel}s`, value: offices.length, alert: offices.length === 0 },
          { icon: Layers, label: `${vocabulary.departmentLabel}s`, value: totalDepts, alert: totalDepts === 0 && offices.length > 0 },
          { icon: Grid3X3, label: `${vocabulary.serviceLabel}s`, value: totalServices, alert: totalServices === 0 && totalDepts > 0 },
          { icon: Monitor, label: `${vocabulary.deskLabel}s`, value: `${assignedDesks}/${totalDesks}`, subtitle: 'staffed', alert: totalDesks === 0 && totalDepts > 0 },
          { icon: Users, label: 'Team', value: allStaff.length, alert: allStaff.length <= 1 },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl border px-4 py-3 shadow-sm ${s.alert ? 'border-amber-200 bg-amber-50' : 'border-border/60 bg-card'}`}>
            <div className="flex items-center gap-2 text-muted-foreground">
              <s.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">{s.label}</span>
              {s.alert && <AlertCircle className="h-3 w-3 text-amber-500 ml-auto" />}
            </div>
            <p className="mt-1 text-lg font-semibold text-foreground">
              {s.value}
              {'subtitle' in s && s.subtitle && <span className="ml-1 text-xs font-normal text-muted-foreground">{s.subtitle}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* ── Visual Hierarchy ─────────────────────────────── */}
      <div className="space-y-4">
        {/* Organization root */}
        <div className="rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-primary/[0.04] to-transparent border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MapPin className="h-5 w-5" />
              </div>
              <div>
                <p className="text-base font-bold text-foreground">{organizationName}</p>
                <p className="text-xs text-muted-foreground">
                  {offices.length} {vocabulary.officeLabel.toLowerCase()}{offices.length !== 1 ? 's' : ''}
                  {' · '}{totalDepts} {vocabulary.departmentLabel.toLowerCase()}{totalDepts !== 1 ? 's' : ''}
                  {' · '}{allStaff.length} team member{allStaff.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSlideOver({ type: 'office', mode: 'create' })}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add {vocabulary.officeLabel}
            </button>
          </div>

          {offices.length === 0 ? (
            <EmptyNode
              icon={Building2}
              title={`No ${vocabulary.officeLabel.toLowerCase()}s yet`}
              message={`Start by creating your first ${vocabulary.officeLabel.toLowerCase()} — this is where your ${vocabulary.customerLabel.toLowerCase()}s come.`}
              action={() => setSlideOver({ type: 'office', mode: 'create' })}
              actionLabel={`Create ${vocabulary.officeLabel}`}
            />
          ) : (
            <div className="divide-y divide-border/40">
              {offices.map((office) => (
                <OfficeCard
                  key={office.id}
                  office={office}
                  allStaff={allStaff}
                  vocabulary={vocabulary}
                  isExpanded={expandedOffices.has(office.id)}
                  expandedDepts={expandedDepts}
                  onToggle={() => toggleOffice(office.id)}
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
            </div>
          )}
        </div>
      </div>

      {/* ── Quick Links ──────────────────────────────────── */}
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { icon: UserPlus, label: 'Add team member', desc: 'Invite staff to their desk', href: '/admin/staff/setup' },
          { icon: Grid3X3, label: `Manage ${vocabulary.serviceLabel.toLowerCase()}s`, desc: 'Detailed service configuration', href: '/admin/services' },
          { icon: Tv, label: 'Display screens', desc: 'Configure waiting room TVs', href: '/admin/displays' },
        ].map((item) => (
          <a key={item.href} href={item.href} className="group flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm hover:border-primary/30 hover:shadow-md transition-all">
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

      {/* ── SlideOver ────────────────────────────────────── */}
      <SlideOver open={slideOver !== null} onClose={() => setSlideOver(null)} title={getSlideOverTitle(slideOver, vocabulary)}>
        {slideOver && (
          <SlideOverForm state={slideOver} vocabulary={vocabulary} allStaff={allStaff} offices={offices} onDone={() => { setSlideOver(null); router.refresh(); }} />
        )}
      </SlideOver>
    </div>
  );
}

/* ================================================================== */
/*  Office Card                                                        */
/* ================================================================== */

function OfficeCard({
  office, allStaff, vocabulary, isExpanded, expandedDepts,
  onToggle, onToggleDept, onEdit, onAddDept, onEditDept,
  onAddService, onEditService, onAddDesk, onEditDesk,
}: {
  office: Office;
  allStaff: StaffMember[];
  vocabulary: Vocabulary;
  isExpanded: boolean;
  expandedDepts: Set<string>;
  onToggle: () => void;
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

  return (
    <div>
      {/* Office header */}
      <div className="group px-5 py-4 hover:bg-muted/20 transition-colors cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {/* Expand toggle */}
          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>

          {/* Icon */}
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
            <Building2 className="h-5 w-5" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-foreground">{office.name}</p>
              <HealthBadge health={health} />
              {!office.is_active && (
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Inactive</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
              <span>{office.departments.length} {vocabulary.departmentLabel.toLowerCase()}{office.departments.length !== 1 ? 's' : ''}</span>
              <span className="text-border">·</span>
              <span>{totalServices} {vocabulary.serviceLabel.toLowerCase()}{totalServices !== 1 ? 's' : ''}</span>
              <span className="text-border">·</span>
              <span>{totalDesks} {vocabulary.deskLabel.toLowerCase()}{totalDesks !== 1 ? 's' : ''}</span>
              <span className="text-border">·</span>
              <span>{officeStaff.length} staff</span>
              {office.address && (
                <>
                  <span className="text-border">·</span>
                  <span className="truncate max-w-[200px]">{office.address}</span>
                </>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
            <SmallBtn icon={Plus} title={`Add ${vocabulary.departmentLabel}`} onClick={() => onAddDept(office.id)} />
            <SmallBtn icon={Pencil} title="Edit" onClick={() => onEdit(office)} />
          </div>
        </div>
      </div>

      {/* Departments */}
      {isExpanded && (
        <div className="px-5 pb-4 pl-[72px]">
          {office.departments.length === 0 ? (
            <NeedsAction
              icon={Layers}
              message={`Add your first ${vocabulary.departmentLabel.toLowerCase()} to organize ${vocabulary.serviceLabel.toLowerCase()}s inside this ${vocabulary.officeLabel.toLowerCase()}.`}
              action={() => onAddDept(office.id)}
              actionLabel={`Add ${vocabulary.departmentLabel}`}
            />
          ) : (
            <div className="space-y-3">
              {office.departments.map((dept) => (
                <DepartmentCard
                  key={dept.id}
                  dept={dept}
                  officeId={office.id}
                  vocabulary={vocabulary}
                  isExpanded={expandedDepts.has(dept.id)}
                  onToggle={() => onToggleDept(dept.id)}
                  onEdit={() => onEditDept(dept)}
                  onAddService={() => onAddService(dept.id)}
                  onEditService={onEditService}
                  onAddDesk={() => onAddDesk(office.id, dept.id)}
                  onEditDesk={onEditDesk}
                />
              ))}
              {/* Add department button */}
              <button
                onClick={() => onAddDept(office.id)}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border/60 py-2.5 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/[0.02] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add {vocabulary.departmentLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Department Card                                                    */
/* ================================================================== */

function DepartmentCard({
  dept, officeId, vocabulary, isExpanded, onToggle,
  onEdit, onAddService, onEditService, onAddDesk, onEditDesk,
}: {
  dept: Department;
  officeId: string;
  vocabulary: Vocabulary;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddService: () => void;
  onEditService: (s: Service) => void;
  onAddDesk: () => void;
  onEditDesk: (d: Desk) => void;
}) {
  const health = deptHealth(dept);
  const accentColor = {
    ready: 'border-l-emerald-400',
    warning: 'border-l-amber-400',
    error: 'border-l-red-400',
  }[health];

  return (
    <div className={`rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden border-l-[3px] ${accentColor}`}>
      {/* Header */}
      <div className="group flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors" onClick={onToggle}>
        <button className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600">
          <Layers className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{dept.name}</p>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">{dept.code}</span>
            <HealthBadge health={health} />
          </div>
        </div>
        {/* Inline stats */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center gap-1">
            <Grid3X3 className="h-3 w-3" /> {dept.services.length}
          </span>
          <span className="flex items-center gap-1">
            <Monitor className="h-3 w-3" /> {dept.desks.length}
          </span>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
          <SmallBtn icon={Grid3X3} title={`Add ${vocabulary.serviceLabel}`} onClick={onAddService} />
          <SmallBtn icon={Monitor} title={`Add ${vocabulary.deskLabel}`} onClick={onAddDesk} />
          <SmallBtn icon={Pencil} title="Edit" onClick={onEdit} />
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border/40 bg-muted/[0.15]">
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border/30">
            {/* Services column */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Grid3X3 className="h-3 w-3" />
                  {vocabulary.serviceLabel}s
                </p>
                <button onClick={onAddService} className="text-[11px] font-medium text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {dept.services.length === 0 ? (
                <EmptySlot
                  message={`No ${vocabulary.serviceLabel.toLowerCase()}s defined`}
                  hint={`Add what ${vocabulary.customerLabel.toLowerCase()}s come for`}
                  onClick={onAddService}
                />
              ) : (
                <div className="space-y-1">
                  {dept.services.map((svc) => (
                    <div key={svc.id} className="group/svc flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-card transition-colors">
                      <StatusDot active={svc.is_active} />
                      <span className="text-sm text-foreground flex-1 truncate">{svc.name}</span>
                      {svc.estimated_service_time && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />{svc.estimated_service_time}m
                        </span>
                      )}
                      <button onClick={() => onEditService(svc)} className="opacity-0 group-hover/svc:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Desks column */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Monitor className="h-3 w-3" />
                  {vocabulary.deskLabel}s
                </p>
                <button onClick={onAddDesk} className="text-[11px] font-medium text-primary hover:underline flex items-center gap-0.5">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {dept.desks.length === 0 ? (
                <EmptySlot
                  message={`No ${vocabulary.deskLabel.toLowerCase()}s set up`}
                  hint="Where staff will serve"
                  onClick={onAddDesk}
                />
              ) : (
                <div className="space-y-1">
                  {dept.desks.map((desk) => (
                    <div key={desk.id} className="group/desk flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-card transition-colors">
                      <DeskStatusDot status={desk.status} active={desk.is_active} />
                      <span className="text-sm text-foreground truncate">{desk.display_name || desk.name}</span>
                      <span className="flex-1" />
                      {desk.current_staff ? (
                        <span className="flex items-center gap-1 text-[11px] text-foreground font-medium">
                          <User className="h-2.5 w-2.5 text-muted-foreground" />
                          {desk.current_staff.full_name}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] text-amber-600 font-medium">
                          <AlertCircle className="h-2.5 w-2.5" />
                          Unassigned
                        </span>
                      )}
                      <button onClick={() => onEditDesk(desk)} className="opacity-0 group-hover/desk:opacity-100 transition-opacity p-0.5 rounded hover:bg-muted">
                        <Pencil className="h-3 w-3 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Small UI pieces                                                    */
/* ================================================================== */

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

function SmallBtn({ icon: Icon, title, onClick }: { icon: React.ComponentType<{ className?: string }>; title: string; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={title} className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function EmptyNode({ icon: Icon, title, message, action, actionLabel }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex flex-col items-center px-5 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 mb-4">
        <Icon className="h-7 w-7 text-muted-foreground/40" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1.5 max-w-md text-xs text-muted-foreground leading-relaxed">{message}</p>
      <button onClick={action} className="mt-4 flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
        <Plus className="h-4 w-4" />
        {actionLabel}
      </button>
    </div>
  );
}

function NeedsAction({ icon: Icon, message, action, actionLabel }: {
  icon: React.ComponentType<{ className?: string }>;
  message: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600 shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-amber-900 flex-1">{message}</p>
      <button onClick={action} className="shrink-0 flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors">
        <Plus className="h-3 w-3" />
        {actionLabel}
      </button>
    </div>
  );
}

function EmptySlot({ message, hint, onClick }: { message: string; hint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border/60 py-4 px-3 text-center hover:border-primary/40 hover:bg-primary/[0.02] transition-colors group"
    >
      <AlertCircle className="h-4 w-4 text-amber-400 group-hover:text-primary transition-colors" />
      <p className="text-xs font-medium text-muted-foreground group-hover:text-foreground">{message}</p>
      <p className="text-[10px] text-muted-foreground/70">{hint}</p>
    </button>
  );
}

/* ================================================================== */
/*  SlideOver Forms                                                    */
/* ================================================================== */

function getSlideOverTitle(state: SlideOverState, vocabulary: Vocabulary): string {
  if (!state) return '';
  const labels: Record<string, string> = { office: vocabulary.officeLabel, department: vocabulary.departmentLabel, service: vocabulary.serviceLabel, desk: vocabulary.deskLabel };
  const label = labels[state.type] ?? state.type;
  return state.mode === 'create' ? `New ${label}` : `Edit ${label}`;
}

function SlideOverForm({ state, vocabulary, allStaff, offices, onDone }: {
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
      try { await fn(formData); onDone(); } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong'); }
    });
  };

  /* ── Office ──────────────────────────────────────── */
  if (state.type === 'office') {
    const editing = state.mode === 'edit' ? state.data : null;
    return (
      <form action={submit(async (fd) => { editing ? await updateOffice(editing.id, fd) : await createOffice(fd); })}>
        <FormHint>A {vocabulary.officeLabel.toLowerCase()} represents a physical location where you serve {vocabulary.customerLabel.toLowerCase()}s — a branch, clinic, or shop.</FormHint>
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder={`e.g. Main ${vocabulary.officeLabel}`} />
        <FormField label="Address" name="address" defaultValue={editing?.address ?? ''} placeholder="e.g. 123 Main St" />
        <FormField label="Timezone" name="timezone" defaultValue={editing?.timezone ?? ''} placeholder="e.g. Africa/Algiers" />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteOffice(editing.id).then(onDone)} label={vocabulary.officeLabel} />}
        </FormActions>
        {!editing && <FormNextStep>After creating this {vocabulary.officeLabel.toLowerCase()}, you&apos;ll add {vocabulary.departmentLabel.toLowerCase()}s inside it.</FormNextStep>}
      </form>
    );
  }

  /* ── Department ──────────────────────────────────── */
  if (state.type === 'department') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const officeName = offices.find((o) => o.id === officeId)?.name ?? '';
    return (
      <form action={submit(async (fd) => { editing ? await updateDepartment(editing.id, fd) : await createDepartment(fd); })}>
        <FormHint>A {vocabulary.departmentLabel.toLowerCase()} is an area inside <strong>{officeName}</strong> — e.g. Reception, Cashier, Lab.</FormHint>
        <input type="hidden" name="office_id" value={officeId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. Reception" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. RECEPTION" />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteDepartment(editing.id).then(onDone)} label={vocabulary.departmentLabel} />}
        </FormActions>
        {!editing && <FormNextStep>Next: add {vocabulary.serviceLabel.toLowerCase()}s (what you offer) and {vocabulary.deskLabel.toLowerCase()}s (where staff serve).</FormNextStep>}
      </form>
    );
  }

  /* ── Service ─────────────────────────────────────── */
  if (state.type === 'service') {
    const editing = state.mode === 'edit' ? state.data : null;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);
    return (
      <form action={submit(async (fd) => { editing ? await updateService(editing.id, fd) : await createService(fd); })}>
        <FormHint>A {vocabulary.serviceLabel.toLowerCase()} is what {vocabulary.customerLabel.toLowerCase()}s come for{dept ? <> in <strong>{dept.name}</strong></> : ''} — e.g. General Visit, Blood Test.</FormHint>
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name" name="name" defaultValue={editing?.name} required placeholder="e.g. General Visit" />
        <FormField label="Code" name="code" defaultValue={editing?.code} required placeholder="e.g. GEN-VISIT" />
        <FormField label="Estimated duration (minutes)" name="estimated_service_time" defaultValue={editing?.estimated_service_time?.toString() ?? '15'} type="number" placeholder="e.g. 15" />
        <Checkbox name="is_active" defaultChecked={editing?.is_active ?? true} label="Active" />
        {error && <ErrorMsg>{error}</ErrorMsg>}
        <FormActions>
          <SubmitBtn pending={isPending}>{editing ? 'Save' : 'Create'}</SubmitBtn>
          {editing && <DeleteBtn onDelete={() => deleteService(editing.id).then(onDone)} label={vocabulary.serviceLabel} />}
        </FormActions>
      </form>
    );
  }

  /* ── Desk ────────────────────────────────────────── */
  if (state.type === 'desk') {
    const editing = state.mode === 'edit' ? state.data : null;
    const officeId = state.mode === 'create' ? state.officeId : editing!.office_id;
    const departmentId = state.mode === 'create' ? state.departmentId : editing!.department_id;
    const eligibleStaff = allStaff.filter((s) => s.office_id === officeId);
    const dept = offices.flatMap((o) => o.departments).find((d) => d.id === departmentId);
    return (
      <form action={submit(async (fd) => { editing ? await updateDesk(editing.id, fd) : await createDesk(fd); })}>
        <FormHint>A {vocabulary.deskLabel.toLowerCase()} is where staff serve {vocabulary.customerLabel.toLowerCase()}s{dept ? <> in <strong>{dept.name}</strong></> : ''} — a counter, window, or room.</FormHint>
        <input type="hidden" name="office_id" value={officeId} />
        <input type="hidden" name="department_id" value={departmentId} />
        <FormField label="Name (slug)" name="name" defaultValue={editing?.name} required placeholder="e.g. counter-1" />
        <FormField label="Display Name" name="display_name" defaultValue={editing?.display_name ?? ''} placeholder="e.g. Counter 1" />
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">Assign Staff</label>
          <select name="current_staff_id" defaultValue={editing?.current_staff?.id ?? ''} className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
            <option value="">Unassigned</option>
            {eligibleStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role.replace('_', ' ')})</option>)}
          </select>
          {eligibleStaff.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-600">No team members in this {vocabulary.officeLabel.toLowerCase()} yet. <a href="/admin/staff/setup" className="text-primary hover:underline">Add a team member</a> first.</p>
          )}
        </div>
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
          <select name="status" defaultValue={editing?.status ?? 'closed'} className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
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

/* ================================================================== */
/*  Form Primitives                                                    */
/* ================================================================== */

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

function FormField({ label, name, defaultValue, required, placeholder, type = 'text' }: {
  label: string; name: string; defaultValue?: string | null; required?: boolean; placeholder?: string; type?: string;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <label className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <input type={type} name={name} defaultValue={defaultValue ?? ''} required={required} placeholder={placeholder} className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
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
    <button type="submit" disabled={pending} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
      {pending ? 'Saving...' : children}
    </button>
  );
}

function DeleteBtn({ onDelete, label }: { onDelete: () => Promise<void>; label: string }) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
        <Trash2 className="h-3.5 w-3.5" /> Delete
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button type="button" disabled={isPending} onClick={() => startTransition(async () => { await onDelete(); })} className="rounded-xl bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50">
        {isPending ? 'Deleting...' : `Delete ${label}`}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted">Cancel</button>
    </div>
  );
}

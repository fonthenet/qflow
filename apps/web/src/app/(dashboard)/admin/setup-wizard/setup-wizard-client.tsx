'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Layers,
  Monitor,
  Users,
  MessageSquare,
  Rocket,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  Plus,
  UserPlus,
  Link2,
  ArrowRight,
  Sparkles,
  Settings2,
} from 'lucide-react';
import {
  createOffice,
  createDepartment,
  createService,
  createDesk,
  createStaffMember,
  updateDesk,
} from '@/lib/actions/admin-actions';
import { updateDeskServices, completeBusinessSetupWizard } from '@/lib/actions/setup-wizard-actions';
import { useI18n } from '@/components/providers/locale-provider';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────

type Office = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  settings: any;
  is_active: boolean | null;
};

type Department = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  office_id: string;
  is_active: boolean | null;
  office: { id: string; name: string } | null;
};

type Service = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  estimated_service_time: number | null;
  department_id: string;
  is_active: boolean | null;
  department: { id: string; name: string; office_id: string } | null;
};

type Desk = {
  id: string;
  name: string;
  display_name: string | null;
  office_id: string;
  department_id: string;
  current_staff_id: string | null;
  status: string | null;
  is_active: boolean | null;
  department: { id: string; name: string } | null;
  office: { id: string; name: string } | null;
  current_staff: { id: string; full_name: string } | null;
};

type StaffMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  office_id: string | null;
  department_id: string | null;
  is_active: boolean | null;
  office: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
};

type DeskService = {
  desk_id: string;
  service_id: string;
};

interface SetupWizardClientProps {
  organization: { id: string; name: string };
  offices: Office[];
  departments: Department[];
  services: Service[];
  desks: Desk[];
  staffList: StaffMember[];
  deskServices: DeskService[];
}

// ────────────────────────────────────────────────────────────────
// Steps definition
// ────────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'office', label: 'Office Details', icon: Building2, description: 'Your location and contact info' },
  { key: 'departments', label: 'Departments & Services', icon: Layers, description: 'What services you offer' },
  { key: 'desks', label: 'Desks & Counters', icon: Monitor, description: 'Where customers are served' },
  { key: 'staff', label: 'Team Members', icon: Users, description: 'Who serves your customers' },
  { key: 'channels', label: 'Channels', icon: MessageSquare, description: 'How customers reach you' },
  { key: 'review', label: 'Review & Launch', icon: Rocket, description: 'Final check before going live' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// ────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────

export function SetupWizardClient({
  organization,
  offices: initialOffices,
  departments: initialDepartments,
  services: initialServices,
  desks: initialDesks,
  staffList: initialStaff,
  deskServices: initialDeskServices,
}: SetupWizardClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepKey>('office');
  const [isPending, startTransition] = useTransition();

  // ── Step completion checks ──
  const stepStatus = useMemo(() => {
    const hasOffice = initialOffices.length > 0;
    const hasDepartment = initialDepartments.length > 0;
    const hasService = initialServices.length > 0;
    const hasDesk = initialDesks.length > 0;
    const hasStaff = initialStaff.length > 0;

    // Check desks have staff assigned
    const desksWithStaff = initialDesks.filter((d) => d.current_staff_id);
    // Check desks have services linked
    const deskIdsWithServices = new Set(initialDeskServices.map((ds) => ds.desk_id));
    const desksWithServices = initialDesks.filter((d) => deskIdsWithServices.has(d.id));

    return {
      office: hasOffice,
      departments: hasDepartment && hasService,
      desks: hasDesk && desksWithServices.length >= initialDesks.length,
      staff: hasStaff && desksWithStaff.length > 0,
      channels: true, // Optional step
      review: hasOffice && hasDepartment && hasService && hasDesk && hasStaff && desksWithStaff.length > 0,
    };
  }, [initialOffices, initialDepartments, initialServices, initialDesks, initialStaff, initialDeskServices]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  function goNext() {
    if (currentStepIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentStepIndex + 1].key);
    }
  }

  function goPrev() {
    if (currentStepIndex > 0) {
      setCurrentStep(STEPS[currentStepIndex - 1].key);
    }
  }

  function handleComplete() {
    startTransition(async () => {
      const result = await completeBusinessSetupWizard();
      if (result?.success) {
        router.push('/admin/overview');
      }
    });
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {t('Set up your business')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('Complete these steps to get {name} ready for customers', { name: organization.name })}
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-1 overflow-x-auto pb-2">
        {STEPS.map((step, index) => {
          const isActive = step.key === currentStep;
          const isComplete = stepStatus[step.key];
          const StepIcon = step.icon;

          return (
            <button
              key={step.key}
              onClick={() => setCurrentStep(step.key)}
              className={`
                group flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-all whitespace-nowrap
                ${isActive
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : isComplete
                    ? 'bg-success/10 text-success hover:bg-success/15'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }
              `}
            >
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                isActive ? 'bg-primary-foreground/20' : isComplete ? 'bg-success/20' : 'bg-muted'
              }`}>
                {isComplete && !isActive ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <StepIcon className="h-4 w-4" />
                )}
              </div>
              <div className="hidden sm:block">
                <div className="text-xs font-semibold">{t(step.label)}</div>
                <div className={`text-[10px] ${isActive ? 'text-primary-foreground/70' : 'opacity-60'}`}>
                  {t(step.description)}
                </div>
              </div>
              {index < STEPS.length - 1 && (
                <ChevronRight className={`h-3.5 w-3.5 ml-1 ${isActive ? 'text-primary-foreground/50' : 'text-muted-foreground/30'}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="min-h-[500px]">
        {currentStep === 'office' && (
          <OfficeStep offices={initialOffices} onNext={goNext} />
        )}
        {currentStep === 'departments' && (
          <DepartmentsStep
            offices={initialOffices}
            departments={initialDepartments}
            services={initialServices}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {currentStep === 'desks' && (
          <DesksStep
            offices={initialOffices}
            departments={initialDepartments}
            services={initialServices}
            desks={initialDesks}
            staffList={initialStaff}
            deskServices={initialDeskServices}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {currentStep === 'staff' && (
          <StaffStep
            offices={initialOffices}
            departments={initialDepartments}
            desks={initialDesks}
            staffList={initialStaff}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {currentStep === 'channels' && (
          <ChannelsStep onNext={goNext} onPrev={goPrev} />
        )}
        {currentStep === 'review' && (
          <ReviewStep
            offices={initialOffices}
            departments={initialDepartments}
            services={initialServices}
            desks={initialDesks}
            staffList={initialStaff}
            deskServices={initialDeskServices}
            stepStatus={stepStatus}
            onComplete={handleComplete}
            onPrev={goPrev}
            onGoToStep={setCurrentStep}
            isPending={isPending}
          />
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Shared UI components
// ────────────────────────────────────────────────────────────────

function StepCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function StepHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  const { t } = useI18n();
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">{t(title)}</h2>
      </div>
      <p className="ml-12 text-sm text-muted-foreground">{t(subtitle)}</p>
    </div>
  );
}

function StepNavigation({
  onPrev,
  onNext,
  nextLabel = 'Continue',
  nextDisabled = false,
  showPrev = true,
}: {
  onPrev?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showPrev?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex items-center justify-between">
      {showPrev && onPrev ? (
        <button
          onClick={onPrev}
          className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> {t('Back')}
        </button>
      ) : (
        <div />
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={nextDisabled}
          className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t(nextLabel)} <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Guideline({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/30 dark:bg-blue-950/30 dark:text-blue-200">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
      <div>{children}</div>
    </div>
  );
}

function ItemCard({
  title,
  subtitle,
  badge,
  badgeColor = 'bg-muted text-muted-foreground',
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate">{title}</h4>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground truncate">{subtitle}</p>}
        </div>
        {badge && (
          <span className={`ml-2 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
      {children && <div className="mt-3 border-t border-border pt-3">{children}</div>}
    </div>
  );
}

function EmptyState({ icon: Icon, message, action }: { icon: any; message: string; action?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-12 px-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{t(message)}</p>
      {action}
    </div>
  );
}

function InlineForm({
  fields,
  onSubmit,
  onCancel,
  submitLabel = 'Create',
}: {
  fields: React.ReactNode;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <form
      action={onSubmit}
      className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-5"
    >
      <div className="space-y-4">{fields}</div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t(submitLabel)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, name, type = 'text', placeholder, required = false, defaultValue, children }: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-foreground">
        {t(label)} {required && <span className="text-destructive">*</span>}
      </label>
      {children || (
        <input
          name={name}
          type={type}
          placeholder={placeholder ? t(placeholder) : undefined}
          required={required}
          defaultValue={defaultValue}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 1: Office Details
// ────────────────────────────────────────────────────────────────

function OfficeStep({ offices, onNext }: { offices: Office[]; onNext: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreateOffice(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await createOffice(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        router.refresh();
      }
    });
  }

  return (
    <StepCard>
      <StepHeader
        icon={Building2}
        title="Office Details"
        subtitle="Set up your physical locations where customers will be served."
      />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Each office represents a physical location. Most businesses start with one office. You can add more later as you expand.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {offices.length > 0 ? (
        <div className="space-y-3">
          {offices.map((office) => (
            <ItemCard
              key={office.id}
              title={office.name}
              subtitle={office.address || undefined}
              badge={office.is_active ? t('Active') : t('Inactive')}
              badgeColor={office.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}
            >
              {office.phone && (
                <p className="text-xs text-muted-foreground">{office.phone}</p>
              )}
            </ItemCard>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Building2}
          message="No offices yet. Create your first location to get started."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> {t('Add Office')}
            </button>
          }
        />
      )}

      {!showForm && offices.length > 0 && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" /> {t('Add another office')}
        </button>
      )}

      {showForm && (
        <div className="mt-4">
          <InlineForm
            onSubmit={handleCreateOffice}
            onCancel={() => { setShowForm(false); setError(null); }}
            submitLabel={isPending ? 'Creating...' : 'Create Office'}
            fields={
              <>
                <input type="hidden" name="is_active" value="true" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Office Name" name="name" placeholder="e.g. Main Branch" required />
                  <FormField label="Address" name="address" placeholder="123 Main Street" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Phone" name="phone" placeholder="+213 555 0123" />
                  <FormField label="Timezone" name="timezone" defaultValue="Africa/Algiers">
                    <select
                      name="timezone"
                      defaultValue="Africa/Algiers"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="Africa/Algiers">Africa/Algiers (GMT+1)</option>
                      <option value="Europe/Paris">Europe/Paris (GMT+1/+2)</option>
                      <option value="Europe/London">Europe/London (GMT+0/+1)</option>
                      <option value="America/New_York">America/New_York (GMT-5/-4)</option>
                      <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                      <option value="Asia/Riyadh">Asia/Riyadh (GMT+3)</option>
                    </select>
                  </FormField>
                </div>
              </>
            }
          />
        </div>
      )}

      <StepNavigation onNext={onNext} nextDisabled={offices.length === 0} showPrev={false} />
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 2: Departments & Services
// ────────────────────────────────────────────────────────────────

function DepartmentsStep({
  offices,
  departments,
  services,
  onNext,
  onPrev,
}: {
  offices: Office[];
  departments: Department[];
  services: Service[];
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceDeptId, setServiceDeptId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreateDepartment(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await createDepartment(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowDeptForm(false);
        router.refresh();
      }
    });
  }

  function handleCreateService(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await createService(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowServiceForm(false);
        setServiceDeptId(null);
        router.refresh();
      }
    });
  }

  // Group services by department
  const servicesByDept = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const svc of services) {
      const existing = map.get(svc.department_id) ?? [];
      existing.push(svc);
      map.set(svc.department_id, existing);
    }
    return map;
  }, [services]);

  return (
    <StepCard>
      <StepHeader
        icon={Layers}
        title="Departments & Services"
        subtitle="Define the areas and services your business offers."
      />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Departments are the areas of your business (e.g. Teller, Customer Service). Each department offers specific services (e.g. Cash Withdrawal, Account Opening). Customers pick a service when joining the queue.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Department list with nested services */}
      {departments.length > 0 ? (
        <div className="space-y-4">
          {departments.map((dept) => {
            const deptServices = servicesByDept.get(dept.id) ?? [];
            return (
              <div key={dept.id} className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/30 px-4 py-3">
                  <div>
                    <h4 className="font-semibold text-foreground">{dept.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {dept.office?.name} &middot; {deptServices.length} {t('service(s)')}
                    </p>
                  </div>
                  <button
                    onClick={() => { setServiceDeptId(dept.id); setShowServiceForm(true); setShowDeptForm(false); }}
                    className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                  >
                    <Plus className="h-3 w-3" /> {t('Add Service')}
                  </button>
                </div>
                {deptServices.length > 0 ? (
                  <div className="divide-y divide-border">
                    {deptServices.map((svc) => (
                      <div key={svc.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <span className="text-sm font-medium text-foreground">{svc.name}</span>
                          {svc.code && <span className="ml-2 text-xs text-muted-foreground">({svc.code})</span>}
                        </div>
                        {svc.estimated_service_time && (
                          <span className="text-xs text-muted-foreground">~{svc.estimated_service_time} min</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-4 text-center text-xs text-muted-foreground">
                    {t('No services yet. Add at least one service to this department.')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Layers}
          message="No departments yet. Create departments to organize your services."
          action={
            <button
              onClick={() => { setShowDeptForm(true); setShowServiceForm(false); }}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> {t('Add Department')}
            </button>
          }
        />
      )}

      {!showDeptForm && departments.length > 0 && (
        <button
          onClick={() => { setShowDeptForm(true); setShowServiceForm(false); }}
          className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" /> {t('Add another department')}
        </button>
      )}

      {/* Department creation form */}
      {showDeptForm && (
        <div className="mt-4">
          <InlineForm
            onSubmit={handleCreateDepartment}
            onCancel={() => { setShowDeptForm(false); setError(null); }}
            submitLabel={isPending ? 'Creating...' : 'Create Department'}
            fields={
              <>
                <input type="hidden" name="is_active" value="true" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Department Name" name="name" placeholder="e.g. Customer Service" required />
                  <FormField label="Code" name="code" placeholder="e.g. CS" required />
                  <FormField label="Office" name="office_id" required>
                    <select
                      name="office_id"
                      required
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Description" name="description" placeholder="Optional description" />
                </div>
              </>
            }
          />
        </div>
      )}

      {/* Service creation form */}
      {showServiceForm && serviceDeptId && (
        <div className="mt-4">
          <InlineForm
            onSubmit={handleCreateService}
            onCancel={() => { setShowServiceForm(false); setServiceDeptId(null); setError(null); }}
            submitLabel={isPending ? 'Creating...' : 'Create Service'}
            fields={
              <>
                <input type="hidden" name="department_id" value={serviceDeptId} />
                <input type="hidden" name="is_active" value="true" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Service Name" name="name" placeholder="e.g. Cash Withdrawal" required />
                  <FormField label="Code" name="code" placeholder="e.g. CW" required />
                  <FormField label="Estimated Time (minutes)" name="estimated_service_time" type="number" placeholder="15" />
                  <FormField label="Description" name="description" placeholder="Optional description" />
                </div>
              </>
            }
          />
        </div>
      )}

      <StepNavigation
        onPrev={onPrev}
        onNext={onNext}
        nextDisabled={departments.length === 0 || services.length === 0}
      />
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 3: Desks & Counters
// ────────────────────────────────────────────────────────────────

function DesksStep({
  offices,
  departments,
  services,
  desks,
  staffList,
  deskServices,
  onNext,
  onPrev,
}: {
  offices: Office[];
  departments: Department[];
  services: Service[];
  desks: Desk[];
  staffList: StaffMember[];
  deskServices: DeskService[];
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [linkingDeskId, setLinkingDeskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Services grouped by desk
  const servicesByDesk = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const ds of deskServices) {
      const existing = map.get(ds.desk_id) ?? new Set();
      existing.add(ds.service_id);
      map.set(ds.desk_id, existing);
    }
    return map;
  }, [deskServices]);

  // Service lookup
  const serviceMap = useMemo(() => {
    const map = new Map<string, Service>();
    for (const svc of services) map.set(svc.id, svc);
    return map;
  }, [services]);

  function handleCreateDesk(formData: FormData) {
    startTransition(async () => {
      setError(null);
      // Ensure required fields
      if (!formData.get('is_active')) formData.set('is_active', 'true');
      if (!formData.get('status')) formData.set('status', 'closed');
      const result = await createDesk(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function handleLinkServices(deskId: string, selectedServiceIds: string[]) {
    startTransition(async () => {
      setError(null);
      const result = await updateDeskServices(deskId, selectedServiceIds);
      if (result?.error) {
        setError(result.error);
      } else {
        setLinkingDeskId(null);
        router.refresh();
      }
    });
  }

  return (
    <StepCard>
      <StepHeader
        icon={Monitor}
        title="Desks & Counters"
        subtitle="Create the desks where your team will serve customers."
      />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Each desk belongs to a department and serves specific services. Link services to each desk so the queue system knows which desk can handle which customer. Assign staff to desks to start serving.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {desks.length > 0 ? (
        <div className="space-y-3">
          {desks.map((desk) => {
            const linkedServiceIds = servicesByDesk.get(desk.id) ?? new Set();
            const linkedServices = [...linkedServiceIds].map((id) => serviceMap.get(id)).filter(Boolean) as Service[];
            const isLinking = linkingDeskId === desk.id;

            return (
              <div key={desk.id} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-foreground">{desk.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {desk.department?.name ?? t('No department')} &middot; {desk.office?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {desk.current_staff ? (
                      <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-[10px] font-semibold text-success">
                        {desk.current_staff.full_name}
                      </span>
                    ) : (
                      <span className="rounded-full bg-warning/10 px-2.5 py-0.5 text-[10px] font-semibold text-warning">
                        {t('No staff assigned')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Linked services */}
                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground">{t('Linked Services')}</span>
                    <button
                      onClick={() => setLinkingDeskId(isLinking ? null : desk.id)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                    >
                      <Link2 className="h-3 w-3" /> {isLinking ? t('Cancel') : t('Edit Links')}
                    </button>
                  </div>
                  {isLinking ? (
                    <DeskServiceLinker
                      desk={desk}
                      services={services.filter((s) => s.department?.office_id === desk.office_id)}
                      selectedIds={linkedServiceIds}
                      onSave={(ids) => handleLinkServices(desk.id, ids)}
                      isPending={isPending}
                    />
                  ) : linkedServices.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {linkedServices.map((svc) => (
                        <span key={svc.id} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
                          {svc.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-warning flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t('No services linked. This desk cannot receive customers.')}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Monitor}
          message="No desks created yet. Add desks so your team can serve customers."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" /> {t('Add Desk')}
            </button>
          }
        />
      )}

      {!showForm && desks.length > 0 && (
        <button
          onClick={() => setShowForm(true)}
          className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" /> {t('Add another desk')}
        </button>
      )}

      {showForm && (
        <div className="mt-4">
          <InlineForm
            onSubmit={handleCreateDesk}
            onCancel={() => { setShowForm(false); setError(null); }}
            submitLabel={isPending ? 'Creating...' : 'Create Desk'}
            fields={
              <>
                <input type="hidden" name="is_active" value="true" />
                <input type="hidden" name="status" value="closed" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Desk Name" name="name" placeholder="e.g. Counter 1" required />
                  <FormField label="Display Name" name="display_name" placeholder="e.g. Guichet 1" />
                  <FormField label="Office" name="office_id" required>
                    <select
                      name="office_id"
                      required
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Department" name="department_id" required>
                    <select
                      name="department_id"
                      required
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">{t('Select department...')}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name} ({d.office?.name})</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Assign Staff (optional)" name="current_staff_id">
                    <select
                      name="current_staff_id"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">{t('None')}</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </>
            }
          />
        </div>
      )}

      <StepNavigation onPrev={onPrev} onNext={onNext} nextDisabled={desks.length === 0} />
    </StepCard>
  );
}

// Desk-Service linker sub-component
function DeskServiceLinker({
  desk,
  services,
  selectedIds,
  onSave,
  isPending,
}: {
  desk: Desk;
  services: Service[];
  selectedIds: Set<string>;
  onSave: (ids: string[]) => void;
  isPending: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        {services.map((svc) => (
          <button
            key={svc.id}
            onClick={() => toggle(svc.id)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              selected.has(svc.id)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground hover:border-primary/50'
            }`}
          >
            {selected.has(svc.id) && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
            {svc.name}
          </button>
        ))}
      </div>
      <button
        onClick={() => onSave([...selected])}
        disabled={isPending}
        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isPending ? t('Saving...') : t('Save Links')}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 4: Team Members
// ────────────────────────────────────────────────────────────────

function StaffStep({
  offices,
  departments,
  desks,
  staffList,
  onNext,
  onPrev,
}: {
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  staffList: StaffMember[];
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [assigningDeskId, setAssigningDeskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Desks without staff
  const unassignedDesks = desks.filter((d) => !d.current_staff_id);
  const assignedDesks = desks.filter((d) => d.current_staff_id);

  function handleCreateStaff(formData: FormData) {
    startTransition(async () => {
      setError(null);
      // Default fields
      if (!formData.get('is_active')) formData.set('is_active', 'true');
      if (!formData.get('role')) formData.set('role', 'desk_operator');
      const result = await createStaffMember(formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function handleAssignStaff(deskId: string, staffId: string) {
    startTransition(async () => {
      setError(null);
      const formData = new FormData();
      formData.set('current_staff_id', staffId);
      const result = await updateDesk(deskId, formData);
      if (result?.error) {
        setError(result.error);
      } else {
        setAssigningDeskId(null);
        router.refresh();
      }
    });
  }

  return (
    <StepCard>
      <StepHeader
        icon={Users}
        title="Team Members"
        subtitle="Add staff and assign them to desks to start serving customers."
      />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Each desk needs a staff member assigned to it. Staff members log in to the Qflo Station app to call and serve customers. Create at least one desk operator for each desk.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Staff list */}
      {staffList.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('Your Team')}</h3>
          <div className="space-y-2">
            {staffList.map((member) => (
              <ItemCard
                key={member.id}
                title={member.full_name}
                subtitle={member.email}
                badge={member.role.replace(/_/g, ' ')}
                badgeColor={
                  member.role === 'admin' ? 'bg-primary/10 text-primary' :
                  member.role === 'manager' ? 'bg-warning/10 text-warning' :
                  'bg-secondary text-secondary-foreground'
                }
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {member.office?.name && <span>{member.office.name}</span>}
                  {member.department?.name && <span>&middot; {member.department.name}</span>}
                </div>
              </ItemCard>
            ))}
          </div>
        </div>
      )}

      {/* Desk assignments */}
      {desks.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('Desk Assignments')}</h3>
          {unassignedDesks.length > 0 && (
            <div className="mb-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-warning">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('{count} desk(s) need staff assigned', { count: unassignedDesks.length })}
              </p>
              <div className="space-y-2">
                {unassignedDesks.map((desk) => (
                  <div key={desk.id} className="flex items-center justify-between rounded-lg bg-background p-2.5 border border-border">
                    <div>
                      <span className="text-sm font-medium text-foreground">{desk.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{desk.department?.name}</span>
                    </div>
                    {assigningDeskId === desk.id ? (
                      <select
                        onChange={(e) => { if (e.target.value) handleAssignStaff(desk.id, e.target.value); }}
                        className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
                        defaultValue=""
                      >
                        <option value="">{t('Select staff...')}</option>
                        {staffList.map((s) => (
                          <option key={s.id} value={s.id}>{s.full_name}</option>
                        ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setAssigningDeskId(desk.id)}
                        className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
                      >
                        <UserPlus className="h-3 w-3" /> {t('Assign')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {assignedDesks.length > 0 && (
            <div className="space-y-2">
              {assignedDesks.map((desk) => (
                <div key={desk.id} className="flex items-center justify-between rounded-lg bg-success/5 border border-success/20 p-2.5">
                  <div>
                    <span className="text-sm font-medium text-foreground">{desk.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{desk.department?.name}</span>
                  </div>
                  <span className="flex items-center gap-1 text-xs font-medium text-success">
                    <CheckCircle2 className="h-3 w-3" /> {desk.current_staff?.full_name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add staff */}
      {staffList.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No team members yet. Add staff so they can log in and serve customers."
          action={
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="h-4 w-4" /> {t('Add Staff Member')}
            </button>
          }
        />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full justify-center"
        >
          <UserPlus className="h-4 w-4" /> {t('Add another team member')}
        </button>
      )}

      {showForm && (
        <div className="mt-4">
          <InlineForm
            onSubmit={handleCreateStaff}
            onCancel={() => { setShowForm(false); setError(null); }}
            submitLabel={isPending ? 'Creating...' : 'Create Staff Member'}
            fields={
              <>
                <input type="hidden" name="is_active" value="true" />
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Full Name" name="full_name" placeholder="e.g. Ahmed Bouzid" required />
                  <FormField label="Email" name="email" type="email" placeholder="ahmed@example.com" required />
                  <FormField label="Password" name="password" type="password" placeholder="Min 6 characters" required />
                  <FormField label="Role" name="role" required>
                    <select
                      name="role"
                      defaultValue="desk_operator"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="desk_operator">{t('Desk Operator')}</option>
                      <option value="receptionist">{t('Receptionist')}</option>
                      <option value="manager">{t('Manager')}</option>
                      <option value="branch_admin">{t('Branch Admin')}</option>
                      <option value="admin">{t('Admin')}</option>
                    </select>
                  </FormField>
                  <FormField label="Office" name="office_id">
                    <select
                      name="office_id"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">{t('None')}</option>
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Department" name="department_id">
                    <select
                      name="department_id"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">{t('None')}</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}</option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </>
            }
          />
        </div>
      )}

      <StepNavigation
        onPrev={onPrev}
        onNext={onNext}
        nextDisabled={staffList.length === 0}
      />
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 5: Channels
// ────────────────────────────────────────────────────────────────

function ChannelsStep({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }) {
  const { t } = useI18n();

  const channels = [
    {
      name: 'Kiosk',
      description: 'Physical kiosk or tablet in your office where customers tap to join the queue.',
      icon: Monitor,
      status: 'built-in',
      action: '/admin/kiosk',
    },
    {
      name: 'QR Code / Link',
      description: 'Generate a QR code or link that customers scan with their phone to join remotely.',
      icon: Link2,
      status: 'built-in',
      action: '/admin/virtual-codes',
    },
    {
      name: 'WhatsApp',
      description: 'Let customers join and track their queue via WhatsApp messages.',
      icon: MessageSquare,
      status: 'configure',
      action: '/admin/settings',
    },
    {
      name: 'Messenger',
      description: 'Enable Facebook Messenger as a queue notification channel.',
      icon: MessageSquare,
      status: 'configure',
      action: '/admin/settings',
    },
  ];

  return (
    <StepCard>
      <StepHeader
        icon={MessageSquare}
        title="Customer Channels"
        subtitle="Choose how customers can join and track their queue."
      />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('The kiosk and QR codes are ready to use. WhatsApp and Messenger require additional configuration in Settings. You can set these up later — they are optional for launch.')}
      </Guideline>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {channels.map((channel) => {
          const ChannelIcon = channel.icon;
          return (
            <div
              key={channel.name}
              className="rounded-xl border border-border p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                  <ChannelIcon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-foreground">{t(channel.name)}</h4>
                    {channel.status === 'built-in' ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                        {t('Ready')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {t('Optional')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t(channel.description)}</p>
                  <a
                    href={channel.action}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                  >
                    <Settings2 className="h-3 w-3" />
                    {channel.status === 'built-in' ? t('Configure') : t('Set up')}
                    <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <StepNavigation onPrev={onPrev} onNext={onNext} nextLabel="Review Setup" />
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 6: Review & Launch
// ────────────────────────────────────────────────────────────────

function ReviewStep({
  offices,
  departments,
  services,
  desks,
  staffList,
  deskServices,
  stepStatus,
  onComplete,
  onPrev,
  onGoToStep,
  isPending,
}: {
  offices: Office[];
  departments: Department[];
  services: Service[];
  desks: Desk[];
  staffList: StaffMember[];
  deskServices: DeskService[];
  stepStatus: Record<string, boolean>;
  onComplete: () => void;
  onPrev: () => void;
  onGoToStep: (step: StepKey) => void;
  isPending: boolean;
}) {
  const { t } = useI18n();

  const desksWithStaff = desks.filter((d) => d.current_staff_id).length;
  const deskIdsWithServices = new Set(deskServices.map((ds) => ds.desk_id));
  const desksWithServices = desks.filter((d) => deskIdsWithServices.has(d.id)).length;

  const allGood = stepStatus.review;

  const checks = [
    {
      label: t('{count} office(s) configured', { count: offices.length }),
      ok: offices.length > 0,
      step: 'office' as StepKey,
    },
    {
      label: t('{count} department(s) with {svcCount} service(s)', { count: departments.length, svcCount: services.length }),
      ok: departments.length > 0 && services.length > 0,
      step: 'departments' as StepKey,
    },
    {
      label: t('{count} desk(s) created, {linked} with services linked', { count: desks.length, linked: desksWithServices }),
      ok: desks.length > 0 && desksWithServices >= desks.length,
      step: 'desks' as StepKey,
    },
    {
      label: t('{count} team member(s), {assigned} desk(s) with staff', { count: staffList.length, assigned: desksWithStaff }),
      ok: staffList.length > 0 && desksWithStaff > 0,
      step: 'staff' as StepKey,
    },
  ];

  return (
    <StepCard>
      <StepHeader
        icon={Rocket}
        title="Review & Launch"
        subtitle="Check everything is ready before going live."
      />

      {!allGood && (
        <div className="mb-6 rounded-xl border border-warning/30 bg-warning/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" />
            {t('Some steps need attention before you can launch.')}
          </p>
        </div>
      )}

      <div className="space-y-3 mb-8">
        {checks.map((check, i) => (
          <div
            key={i}
            className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${
              check.ok
                ? 'border-success/30 bg-success/5'
                : 'border-warning/30 bg-warning/5'
            }`}
          >
            <div className="flex items-center gap-3">
              {check.ok ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-warning" />
              )}
              <span className={`text-sm font-medium ${check.ok ? 'text-foreground' : 'text-warning'}`}>
                {check.label}
              </span>
            </div>
            {!check.ok && (
              <button
                onClick={() => onGoToStep(check.step)}
                className="rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors"
              >
                {t('Fix')}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Summary cards */}
      {allGood && (
        <div className="mb-8 rounded-2xl border border-success/30 bg-gradient-to-br from-success/5 to-transparent p-6 text-center">
          <div className="mb-2 text-3xl">
            <Sparkles className="mx-auto h-10 w-10 text-success" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-1">{t('Everything looks great!')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('Your business is ready to start serving customers. Launch to complete the setup.')}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={onPrev}
          className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> {t('Back')}
        </button>
        <button
          onClick={onComplete}
          disabled={!allGood || isPending}
          className="flex items-center gap-2 rounded-xl bg-success px-8 py-3 text-sm font-bold text-white shadow-lg shadow-success/20 hover:bg-success/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Rocket className="h-4 w-4" />
          {isPending ? t('Launching...') : t('Launch Business')}
        </button>
      </div>
    </StepCard>
  );
}

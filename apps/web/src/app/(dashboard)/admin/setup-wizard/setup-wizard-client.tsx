'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { BranchType, OperatingModel, TrialTemplateDepartmentDraft, TrialTemplateStructure } from '@qflo/shared';
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
  LayoutTemplate,
} from 'lucide-react';
import {
  createStaffMember,
  updateDesk,
} from '@/lib/actions/admin-actions';
import {
  saveIndustryTemplateTrial,
  confirmIndustryTemplateSetup,
} from '@/lib/actions/platform-actions';
import {
  updateDeskServices,
  completeBusinessSetupWizard,
} from '@/lib/actions/setup-wizard-actions';
import { industryTemplates } from '@/lib/platform/templates';
import { buildTrialTemplateStructure } from '@/lib/platform/trial-structure';
import { getProfilesForVertical, getDefaultProfileId, getProfileById } from '@/lib/platform/template-profiles';
import { useI18n } from '@/components/providers/locale-provider';
import { getVocabularyExamples } from '@/lib/platform/vocabulary-examples';

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

interface WizardVocabulary {
  serviceLabel: string;
  departmentLabel: string;
  deskLabel: string;
  officeLabel: string;
  customerLabel?: string;
}

interface SetupWizardClientProps {
  organization: { id: string; name: string };
  confirmed: boolean;
  trialSettings: Record<string, any>;
  vocabulary?: WizardVocabulary;
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
  { key: 'business', label: 'Business Type', icon: LayoutTemplate, description: 'Choose your industry' },
  { key: 'setup', label: 'Your Setup', icon: Building2, description: 'Review your setup' },
  { key: 'team', label: 'Your Team', icon: Users, description: 'Add staff members' },
  { key: 'launch', label: 'Go Live', icon: Rocket, description: 'Launch your business' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function defaultOperatingModel(vertical: string): OperatingModel {
  if (vertical === 'bank') return 'service_routing';
  if (vertical === 'clinic') return 'appointments_first';
  if (vertical === 'public_service') return 'department_first';
  return 'waitlist';
}

function verticalLabel(vertical: string) {
  const labels: Record<string, string> = {
    public_service: 'Public Service',
    bank: 'Banking',
    clinic: 'Healthcare',
    restaurant: 'Restaurant',
    barbershop: 'Beauty & Spa',
    education: 'Education',
    telecom: 'Telecom',
    insurance: 'Insurance',
    automotive: 'Automotive',
    legal: 'Legal',
    real_estate: 'Real Estate',
    other: 'General Service',
  };
  return labels[vertical] ?? vertical.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function verticalEmoji(vertical: string) {
  const emojis: Record<string, string> = {
    public_service: '\u{1F3DB}', bank: '\u{1F3E6}', clinic: '\u{1F3E5}',
    restaurant: '\u{1F37D}', barbershop: '\u{2702}', education: '\u{1F393}',
    telecom: '\u{1F4F1}', insurance: '\u{1F6E1}', automotive: '\u{1F697}',
    legal: '\u{2696}', real_estate: '\u{1F3E0}', other: '\u{2699}',
  };
  return emojis[vertical] ?? '\u{2699}';
}

// ────────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────────

export function SetupWizardClient({
  organization,
  confirmed,
  trialSettings,
  vocabulary: vocabProp,
  offices: initialOffices,
  departments: initialDepartments,
  services: initialServices,
  desks: initialDesks,
  staffList: initialStaff,
  deskServices: initialDeskServices,
}: SetupWizardClientProps) {
  const { t } = useI18n();
  const vocab = vocabProp ?? { serviceLabel: 'Service', departmentLabel: 'Department', deskLabel: 'Desk', officeLabel: 'Office' };
  const examples = getVocabularyExamples(vocab);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Determine initial step based on confirmed state
  const initialStep: StepKey = confirmed
    ? (initialStaff.length > 0 && initialDesks.some((d) => d.current_staff_id) ? 'launch' : 'setup')
    : 'business';
  const [currentStep, setCurrentStep] = useState<StepKey>(initialStep);

  // Step completion checks
  const stepStatus = useMemo(() => {
    const hasOffice = initialOffices.length > 0;
    const hasDept = initialDepartments.length > 0;
    const hasService = initialServices.length > 0;
    const hasDesk = initialDesks.length > 0;
    const hasStaff = initialStaff.length > 0;
    const desksWithStaff = initialDesks.filter((d) => d.current_staff_id).length;
    const deskIdsWithServices = new Set(initialDeskServices.map((ds) => ds.desk_id));
    const desksWithServices = initialDesks.filter((d) => deskIdsWithServices.has(d.id)).length;

    return {
      business: confirmed,
      setup: hasOffice && hasDept && hasService && hasDesk && desksWithServices >= initialDesks.length,
      team: hasStaff && desksWithStaff > 0,
      launch: confirmed && hasOffice && hasDept && hasService && hasDesk && hasStaff && desksWithStaff > 0,
    };
  }, [confirmed, initialOffices, initialDepartments, initialServices, initialDesks, initialStaff, initialDeskServices]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const goNext = () => { if (currentStepIndex < STEPS.length - 1) setCurrentStep(STEPS[currentStepIndex + 1].key); };
  const goPrev = () => { if (currentStepIndex > 0) setCurrentStep(STEPS[currentStepIndex - 1].key); };

  function handleComplete() {
    startTransition(async () => {
      const result = await completeBusinessSetupWizard();
      if (result?.success) router.push('/admin/overview');
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
          const isClickable = step.key === 'business' || confirmed;
          const StepIcon = step.icon;

          return (
            <button
              key={step.key}
              onClick={() => isClickable && setCurrentStep(step.key)}
              disabled={!isClickable}
              className={`
                group flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-all whitespace-nowrap
                ${isActive
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : isComplete
                    ? 'bg-success/10 text-success hover:bg-success/15'
                    : isClickable
                      ? 'bg-muted/50 text-muted-foreground hover:bg-muted'
                      : 'bg-muted/30 text-muted-foreground/50 cursor-not-allowed'
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
        {currentStep === 'business' && (
          <BusinessStep
            organization={organization}
            confirmed={confirmed}
            trialSettings={trialSettings}
            onNext={goNext}
            onConfirmed={() => router.refresh()}
          />
        )}
        {currentStep === 'setup' && (
          <SetupOverviewStep
            offices={initialOffices}
            departments={initialDepartments}
            services={initialServices}
            desks={initialDesks}
            deskServices={initialDeskServices}
            vocab={vocab}
            examples={examples}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {currentStep === 'team' && (
          <TeamStep
            offices={initialOffices}
            departments={initialDepartments}
            desks={initialDesks}
            staffList={initialStaff}
            vocab={vocab}
            onNext={goNext}
            onPrev={goPrev}
          />
        )}
        {currentStep === 'launch' && (
          <LaunchStep
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
  nextVariant = 'primary',
}: {
  onPrev?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  showPrev?: boolean;
  nextVariant?: 'primary' | 'success';
}) {
  const { t } = useI18n();
  const bgClass = nextVariant === 'success'
    ? 'bg-success text-white shadow-success/20 hover:bg-success/90'
    : 'bg-primary text-primary-foreground shadow-primary/20 hover:bg-primary/90';
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
          className={`flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${bgClass}`}
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

function ItemCard({ title, subtitle, badge, badgeColor = 'bg-muted text-muted-foreground', children }: {
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

function InlineForm({ fields, onSubmit, onCancel, submitLabel = 'Create' }: {
  fields: React.ReactNode;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <form action={onSubmit} className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-5">
      <div className="space-y-4">{fields}</div>
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
          {t(submitLabel)}
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
          {t('Cancel')}
        </button>
      </div>
    </form>
  );
}

function FormField({ label, name, type = 'text', placeholder, required = false, defaultValue, children }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string; children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-foreground">
        {t(label)} {required && <span className="text-destructive">*</span>}
      </label>
      {children || (
        <input name={name} type={type} placeholder={placeholder ? t(placeholder) : undefined} required={required} defaultValue={defaultValue}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 1: Business Type (pre-confirm template + profile selection)
// ────────────────────────────────────────────────────────────────

function BusinessStep({
  organization,
  confirmed,
  trialSettings,
  onNext,
  onConfirmed,
}: {
  organization: { id: string; name: string };
  confirmed: boolean;
  trialSettings: Record<string, any>;
  onNext: () => void;
  onConfirmed: () => void;
}) {
  const { t } = useI18n();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Current template selection from trial settings
  const currentTemplateId = trialSettings.platform_trial_template_id ?? industryTemplates[0]?.id;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(currentTemplateId);

  const selectedTemplate = industryTemplates.find((tmpl) => tmpl.id === selectedTemplateId) ?? industryTemplates[0];

  // Profile selection
  const profiles = getProfilesForVertical(selectedTemplate.vertical);
  const defaultProfileId = getDefaultProfileId(selectedTemplate.vertical);
  const currentProfileId = trialSettings.platform_trial_profile_id;
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    currentProfileId ?? defaultProfileId ?? null
  );

  // Trial structure preview
  const starterOffice = selectedTemplate.starterOffices[0];
  const structure = starterOffice
    ? buildTrialTemplateStructure(starterOffice, { includeDisplays: false })
    : null;

  const enabledDepts = structure?.departments.filter((d) => d.enabled) ?? [];
  const enabledServices = enabledDepts.flatMap((d) => d.services.filter((s) => s.enabled));
  const enabledDesks = structure?.desks.filter((d) => d.enabled) ?? [];

  // If already confirmed, show completed state
  if (confirmed) {
    const tmplId = trialSettings.platform_trial_template_id;
    const tmpl = industryTemplates.find((t) => t.id === tmplId);
    return (
      <StepCard>
        <StepHeader icon={LayoutTemplate} title="Business Type" subtitle="Your business type has been confirmed." />
        <div className="rounded-xl border border-success/30 bg-success/5 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-success flex-shrink-0" />
          <div>
            <p className="font-semibold text-foreground">
              {tmpl ? `${verticalEmoji(tmpl.vertical)} ${tmpl.title}` : t('Business configured')}
            </p>
            <p className="text-xs text-muted-foreground">{t('Template confirmed and structure created.')}</p>
          </div>
        </div>
        <StepNavigation onNext={onNext} showPrev={false} />
      </StepCard>
    );
  }

  async function handleCreateBusiness() {
    startTransition(async () => {
      setError(null);
      try {
        // 1. Save trial settings
        const payload = {
          templateId: selectedTemplate.id,
          profileId: selectedProfileId ?? undefined,
          operatingModel: defaultOperatingModel(selectedTemplate.vertical),
          branchType: starterOffice?.branchType as BranchType,
          officeName: organization.name,
          timezone: 'Africa/Algiers',
          createStarterDisplay: false,
          seedPriorities: true,
          trialStructure: structure ?? undefined,
        };

        const saveResult = await saveIndustryTemplateTrial(payload);
        if (saveResult && 'error' in saveResult) {
          setError(saveResult.error as string);
          return;
        }

        // 2. Confirm and create all DB records
        const confirmResult = await confirmIndustryTemplateSetup({
          templateId: selectedTemplate.id,
          operatingModel: defaultOperatingModel(selectedTemplate.vertical),
          branchType: starterOffice?.branchType as BranchType,
          officeName: organization.name,
          timezone: 'Africa/Algiers',
          createStarterDisplay: false,
          seedPriorities: true,
          trialStructure: structure ?? undefined,
        });

        if (confirmResult && 'error' in confirmResult) {
          setError(confirmResult.error as string);
          return;
        }

        // 3. Refresh the page — server will see confirmed=true
        onConfirmed();
      } catch (err) {
        setError('Something went wrong. Please try again.');
      }
    });
  }

  return (
    <StepCard>
      <StepHeader icon={LayoutTemplate} title="Choose Your Business Type" subtitle="Pick the template that best matches your business." />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Each template comes pre-configured with departments, services, desks, and queue settings optimized for your industry. You can customize everything after setup.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {/* Template grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 mb-6">
        {industryTemplates.map((tmpl) => {
          const isSelected = tmpl.id === selectedTemplateId;
          return (
            <button
              key={tmpl.id}
              onClick={() => {
                setSelectedTemplateId(tmpl.id);
                const defProfile = getDefaultProfileId(tmpl.vertical);
                setSelectedProfileId(defProfile ?? null);
              }}
              className={`group rounded-xl border-2 p-4 text-left transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                  : 'border-border bg-card hover:border-primary/40 hover:shadow-md'
              }`}
            >
              <div className="text-2xl mb-2">{verticalEmoji(tmpl.vertical)}</div>
              <div className="text-sm font-semibold text-foreground">{tmpl.title}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{verticalLabel(tmpl.vertical)}</div>
            </button>
          );
        })}
      </div>

      {/* Profile sub-selection */}
      {profiles.length > 1 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('Specialization')}</h3>
          <div className="flex flex-wrap gap-2">
            {profiles.map((profile) => {
              const isSelected = profile.id === selectedProfileId;
              return (
                <button
                  key={profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {isSelected && <CheckCircle2 className="inline h-3 w-3 mr-1" />}
                  {profile.title}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Preview what gets created */}
      {structure && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('What gets created')}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-background border border-border p-3 text-center">
              <div className="text-lg font-bold text-primary">{enabledDepts.length}</div>
              <div className="text-[10px] text-muted-foreground">{selectedTemplate.experienceProfile.vocabulary?.departmentLabel ?? 'Department'}s</div>
            </div>
            <div className="rounded-lg bg-background border border-border p-3 text-center">
              <div className="text-lg font-bold text-primary">{enabledServices.length}</div>
              <div className="text-[10px] text-muted-foreground">{selectedTemplate.experienceProfile.vocabulary?.serviceLabel ?? 'Service'}s</div>
            </div>
            <div className="rounded-lg bg-background border border-border p-3 text-center">
              <div className="text-lg font-bold text-primary">{enabledDesks.length}</div>
              <div className="text-[10px] text-muted-foreground">{selectedTemplate.experienceProfile.vocabulary?.deskLabel ?? 'Desk'}s</div>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {enabledDepts.map((dept) => {
              const deptServices = dept.services.filter((s) => s.enabled);
              return (
                <div key={dept.code} className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{dept.name}</span>
                  <span className="text-muted-foreground">{deptServices.length} service{deptServices.length !== 1 ? 's' : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create business button */}
      <div className="flex justify-end">
        <button
          onClick={handleCreateBusiness}
          disabled={isPending}
          className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <>{t('Creating...')}</>
          ) : (
            <><Sparkles className="h-4 w-4" /> {t('Create my business')}</>
          )}
        </button>
      </div>
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 2: Setup Overview (review created structure, allow tweaks)
// ────────────────────────────────────────────────────────────────

function SetupOverviewStep({
  offices,
  departments,
  services,
  desks,
  deskServices,
  vocab,
  examples,
  onNext,
  onPrev,
}: {
  offices: Office[];
  departments: Department[];
  services: Service[];
  desks: Desk[];
  deskServices: DeskService[];
  vocab: WizardVocabulary;
  examples: ReturnType<typeof getVocabularyExamples>;
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useI18n();
  const [linkingDeskId, setLinkingDeskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Services grouped by department
  const servicesByDept = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const svc of services) {
      const existing = map.get(svc.department_id) ?? [];
      existing.push(svc);
      map.set(svc.department_id, existing);
    }
    return map;
  }, [services]);

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

  const serviceMap = useMemo(() => {
    const map = new Map<string, Service>();
    for (const svc of services) map.set(svc.id, svc);
    return map;
  }, [services]);

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
      <StepHeader icon={Building2} title="Your Setup" subtitle="Here's what was created for your business. Review and customize." />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Everything below was auto-generated from your template. You can modify names, add more departments/services, or adjust desk-service links from the admin pages after setup.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {/* Offices */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" /> {t('{label}s', { label: vocab.officeLabel })}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{offices.length}</span>
        </h3>
        <div className="space-y-2">
          {offices.map((office) => (
            <ItemCard
              key={office.id}
              title={office.name}
              subtitle={office.address || undefined}
              badge={office.is_active ? t('Active') : t('Inactive')}
              badgeColor={office.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}
            />
          ))}
        </div>
      </div>

      {/* Departments & Services */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> {t('{dLabel}s & {sLabel}s', { dLabel: vocab.departmentLabel, sLabel: vocab.serviceLabel })}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{departments.length} / {services.length}</span>
        </h3>
        <div className="space-y-3">
          {departments.map((dept) => {
            const deptServices = servicesByDept.get(dept.id) ?? [];
            return (
              <div key={dept.id} className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/30 px-4 py-2.5">
                  <div>
                    <h4 className="font-semibold text-foreground text-sm">{dept.name}</h4>
                    <p className="text-[10px] text-muted-foreground">{dept.office?.name} &middot; {deptServices.length} service(s)</p>
                  </div>
                </div>
                {deptServices.length > 0 && (
                  <div className="divide-y divide-border">
                    {deptServices.map((svc) => (
                      <div key={svc.id} className="flex items-center justify-between px-4 py-2">
                        <span className="text-xs font-medium text-foreground">{svc.name}</span>
                        {svc.estimated_service_time && (
                          <span className="text-[10px] text-muted-foreground">~{svc.estimated_service_time} min</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Desks */}
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Monitor className="h-4 w-4 text-primary" /> {t('{label}s', { label: vocab.deskLabel })}
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{desks.length}</span>
        </h3>
        <div className="space-y-2">
          {desks.map((desk) => {
            const linkedServiceIds = servicesByDesk.get(desk.id) ?? new Set();
            const linkedServices = [...linkedServiceIds].map((id) => serviceMap.get(id)).filter(Boolean) as Service[];
            const isLinking = linkingDeskId === desk.id;

            return (
              <div key={desk.id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{desk.name}</h4>
                    <p className="text-[10px] text-muted-foreground">{desk.department?.name} &middot; {desk.office?.name}</p>
                  </div>
                  <button
                    onClick={() => setLinkingDeskId(isLinking ? null : desk.id)}
                    className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                  >
                    <Link2 className="h-3 w-3" /> {isLinking ? t('Cancel') : t('Edit Services')}
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
                  <div className="flex flex-wrap gap-1">
                    {linkedServices.map((svc) => (
                      <span key={svc.id} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {svc.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-warning flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> {t('No services linked')}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <StepNavigation onPrev={onPrev} onNext={onNext} />
    </StepCard>
  );
}

// Desk-Service linker sub-component
function DeskServiceLinker({ desk, services, selectedIds, onSave, isPending }: {
  desk: Desk; services: Service[]; selectedIds: Set<string>; onSave: (ids: string[]) => void; isPending: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
      <button onClick={() => onSave([...selected])} disabled={isPending}
        className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
        {isPending ? t('Saving...') : t('Save')}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 3: Team (add staff + assign to desks)
// ────────────────────────────────────────────────────────────────

function TeamStep({
  offices,
  departments,
  desks,
  staffList,
  vocab,
  onNext,
  onPrev,
}: {
  offices: Office[];
  departments: Department[];
  desks: Desk[];
  staffList: StaffMember[];
  vocab: WizardVocabulary;
  onNext: () => void;
  onPrev: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [assigningDeskId, setAssigningDeskId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const unassignedDesks = desks.filter((d) => !d.current_staff_id);
  const assignedDesks = desks.filter((d) => d.current_staff_id);

  function handleCreateStaff(formData: FormData) {
    startTransition(async () => {
      setError(null);
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
      <StepHeader icon={Users} title="Your Team" subtitle="Add staff members and assign them to desks." />

      <Guideline>
        <strong>{t('Tip:')}</strong> {t('Each desk needs a staff member to serve customers. Staff log in to the Qflo Station app. Create at least one desk operator per desk.')}
      </Guideline>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>
      )}

      {/* Staff list */}
      {staffList.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t('Team Members')}</h3>
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
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border py-12 px-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mb-4 text-sm text-muted-foreground">{t('No team members yet. Add your first staff member.')}</p>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="h-4 w-4" /> {t('Add Staff Member')}
          </button>
        </div>
      ) : !showForm && (
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
                    <select name="role" defaultValue="desk_operator"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                      <option value="desk_operator">{t('Desk Operator')}</option>
                      <option value="receptionist">{t('Receptionist')}</option>
                      <option value="manager">{t('Manager')}</option>
                      <option value="branch_admin">{t('Branch Admin')}</option>
                      <option value="admin">{t('Admin')}</option>
                    </select>
                  </FormField>
                  <FormField label="Office" name="office_id">
                    <select name="office_id"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                      <option value="">{t('None')}</option>
                      {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Department" name="department_id">
                    <select name="department_id"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring">
                      <option value="">{t('None')}</option>
                      {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </FormField>
                </div>
              </>
            }
          />
        </div>
      )}

      <StepNavigation onPrev={onPrev} onNext={onNext} nextDisabled={staffList.length === 0} />
    </StepCard>
  );
}

// ────────────────────────────────────────────────────────────────
// Step 4: Go Live (channels + checklist + launch)
// ────────────────────────────────────────────────────────────────

function LaunchStep({
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
  const allGood = stepStatus.launch;

  const checks = [
    { label: t('{count} office(s) configured', { count: offices.length }), ok: offices.length > 0, step: 'setup' as StepKey },
    { label: t('{count} department(s) with {svcCount} service(s)', { count: departments.length, svcCount: services.length }), ok: departments.length > 0 && services.length > 0, step: 'setup' as StepKey },
    { label: t('{count} desk(s), {linked} with services linked', { count: desks.length, linked: desksWithServices }), ok: desks.length > 0 && desksWithServices >= desks.length, step: 'setup' as StepKey },
    { label: t('{count} team member(s), {assigned} desk(s) with staff', { count: staffList.length, assigned: desksWithStaff }), ok: staffList.length > 0 && desksWithStaff > 0, step: 'team' as StepKey },
  ];

  const channels = [
    { name: 'Kiosk', description: 'Physical kiosk for walk-in customers', icon: Monitor, status: 'built-in', action: '/admin/kiosk' },
    { name: 'QR Code / Link', description: 'Customers scan to join remotely', icon: Link2, status: 'built-in', action: '/admin/virtual-codes' },
    { name: 'WhatsApp', description: 'Queue via WhatsApp messages', icon: MessageSquare, status: 'configure', action: '/admin/settings' },
    { name: 'Messenger', description: 'Queue via Facebook Messenger', icon: MessageSquare, status: 'configure', action: '/admin/settings' },
  ];

  return (
    <StepCard>
      <StepHeader icon={Rocket} title="Go Live" subtitle="Final check and launch your business." />

      {/* Readiness checklist */}
      {!allGood && (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/5 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-warning">
            <AlertTriangle className="h-4 w-4" />
            {t('Some items need attention before launch.')}
          </p>
        </div>
      )}

      <div className="space-y-2 mb-8">
        {checks.map((check, i) => (
          <div key={i} className={`flex items-center justify-between rounded-xl border p-3 ${
            check.ok ? 'border-success/30 bg-success/5' : 'border-warning/30 bg-warning/5'
          }`}>
            <div className="flex items-center gap-2">
              {check.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
              <span className={`text-sm font-medium ${check.ok ? 'text-foreground' : 'text-warning'}`}>{check.label}</span>
            </div>
            {!check.ok && (
              <button onClick={() => onGoToStep(check.step)}
                className="rounded-lg bg-warning/10 px-3 py-1 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors">
                {t('Fix')}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Customer channels */}
      <h3 className="text-sm font-semibold text-foreground mb-3">{t('Customer Channels')}</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 mb-8">
        {channels.map((channel) => {
          const ChannelIcon = channel.icon;
          return (
            <div key={channel.name} className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <ChannelIcon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{t(channel.name)}</h4>
                    {channel.status === 'built-in' ? (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">{t('Ready')}</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t('Optional')}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{t(channel.description)}</p>
                  <a href={channel.action} className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline">
                    <Settings2 className="h-3 w-3" /> {channel.status === 'built-in' ? t('Configure') : t('Set up')} <ArrowRight className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Launch section */}
      {allGood && (
        <div className="mb-6 rounded-2xl border border-success/30 bg-gradient-to-br from-success/5 to-transparent p-6 text-center">
          <Sparkles className="mx-auto mb-2 h-10 w-10 text-success" />
          <h3 className="text-lg font-bold text-foreground mb-1">{t('Everything looks great!')}</h3>
          <p className="text-sm text-muted-foreground">{t('Your business is ready to start serving customers.')}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onPrev}
          className="flex items-center gap-2 rounded-xl border border-border px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
          <ChevronLeft className="h-4 w-4" /> {t('Back')}
        </button>
        <button onClick={onComplete} disabled={!allGood || isPending}
          className="flex items-center gap-2 rounded-xl bg-success px-8 py-3 text-sm font-bold text-white shadow-lg shadow-success/20 hover:bg-success/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          <Rocket className="h-4 w-4" />
          {isPending ? t('Launching...') : t('Launch Business')}
        </button>
      </div>
    </StepCard>
  );
}

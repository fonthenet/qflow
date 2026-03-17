'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type {
  BranchType,
  OperatingModel,
  TemplateLifecycleState,
  TrialTemplateDepartmentDraft,
  TrialTemplateStructure,
} from '@queueflow/shared';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  Layers,
  Lock,
  Monitor,
  Plus,
  Rocket,
  Save,
  Scissors,
  ShieldCheck,
  Store,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import {
  clearIndustryTemplateTrial,
  confirmIndustryTemplateSetup,
  saveIndustryTemplateTrial,
} from '@/lib/actions/platform-actions';
import { buildTrialTemplateStructure, normalizeTrialTemplateStructure } from '@/lib/platform/trial-structure';
import { industryTemplates } from '@/lib/platform/templates';
import { sandboxSurfaceMeta } from '@/lib/platform/sandbox-surfaces';

type TemplateSummary = {
  id: string;
  title: string;
  vertical: string;
  version: string;
  dashboardMode: string;
  operatingModel: string;
  branchType: string;
  enabledModules: string[];
  recommendedRoles: string[];
  defaultNavigation?: string[];
  vocabulary?: {
    officeLabel: string;
    departmentLabel: string;
    serviceLabel: string;
    deskLabel: string;
    customerLabel: string;
    bookingLabel: string;
    queueLabel: string;
  };
};

const FALLBACK_VOCABULARY = {
  officeLabel: 'Location',
  departmentLabel: 'Area',
  serviceLabel: 'Service',
  deskLabel: 'Counter',
  customerLabel: 'Customer',
  bookingLabel: 'Booking',
  queueLabel: 'Queue',
};

interface TemplateOnboardingClientProps {
  organization: {
    id: string;
    name: string;
  };
  existingOfficeCount: number;
  lifecycleState?: TemplateLifecycleState;
  currentTemplate: TemplateSummary;
  trialTemplate?: TemplateSummary;
  trialSettings?: Record<string, unknown>;
}

function formatEnum(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function verticalLabel(vertical: string) {
  switch (vertical) {
    case 'standard':
    case 'public_service': return 'Standard Queue';
    case 'bank': return 'Banking & Finance';
    case 'clinic': return 'Healthcare & Clinics';
    case 'restaurant': return 'Restaurants & Hospitality';
    case 'barbershop': return 'Salons & Barbershops';
    default: return formatEnum(vertical);
  }
}

function verticalDescription(vertical: string) {
  switch (vertical) {
    case 'standard':
    case 'public_service': return 'Flexible ticketing for any business with departments, priorities, and displays';
    case 'bank': return 'Service-based routing with teller counters';
    case 'clinic': return 'Appointment-first flow with walk-in support';
    case 'restaurant': return 'Party-size waitlist with host-controlled seating';
    case 'barbershop': return 'Walk-in and appointment booking for stylists';
    default: return 'Custom queue management';
  }
}

function verticalIcon(vertical: string) {
  switch (vertical) {
    case 'standard':
    case 'public_service': return <Layers className="h-5 w-5" />;
    case 'bank': return <ShieldCheck className="h-5 w-5" />;
    case 'clinic': return <Plus className="h-5 w-5" />;
    case 'restaurant': return <UtensilsCrossed className="h-5 w-5" />;
    case 'barbershop': return <Scissors className="h-5 w-5" />;
    default: return <Layers className="h-5 w-5" />;
  }
}

function verticalColor(vertical: string) {
  switch (vertical) {
    case 'standard':
    case 'public_service':
      return { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', ring: 'ring-slate-400', accent: 'bg-slate-700', badgeBg: 'bg-slate-100', badgeText: 'text-slate-700' };
    case 'bank':
      return { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', ring: 'ring-emerald-400', accent: 'bg-emerald-500', badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700' };
    case 'clinic':
      return { bg: 'bg-sky-50', text: 'text-sky-600', border: 'border-sky-200', ring: 'ring-sky-400', accent: 'bg-sky-500', badgeBg: 'bg-sky-100', badgeText: 'text-sky-700' };
    case 'restaurant':
      return { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', ring: 'ring-amber-400', accent: 'bg-amber-500', badgeBg: 'bg-amber-100', badgeText: 'text-amber-700' };
    case 'barbershop':
      return { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200', ring: 'ring-orange-400', accent: 'bg-orange-500', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700' };
    default:
      return { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', ring: 'ring-gray-400', accent: 'bg-gray-500', badgeBg: 'bg-gray-100', badgeText: 'text-gray-700' };
  }
}

function verticalFeatures(vertical: string): string[] {
  switch (vertical) {
    case 'standard':
    case 'public_service': return ['Multi-department', 'Priority lanes', 'Kiosk', 'Display board', 'Appointments'];
    case 'bank': return ['Service routing', 'Teller counters', 'VIP support'];
    case 'clinic': return ['Appointments', 'Walk-ins', 'Patient queue'];
    case 'restaurant': return ['Party size', 'Table assignment', 'Waitlist'];
    case 'barbershop': return ['Stylist booking', 'Walk-ins', 'Service menu'];
    default: return ['Queue management', 'Tickets'];
  }
}

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function initialStructure(params: {
  templateId: string;
  branchType: BranchType;
  includeDisplays: boolean;
  trialSettings: Record<string, unknown>;
}) {
  const template = industryTemplates.find((entry) => entry.id === params.templateId) ?? industryTemplates[0];
  const starterOffice =
    template.starterOffices.find((office) => office.branchType === params.branchType) ??
    template.starterOffices[0];

  const sameTemplate =
    params.trialSettings.platform_trial_structure_template_id === params.templateId;
  const sameBranchType =
    params.trialSettings.platform_trial_structure_branch_type === params.branchType;

  if (!sameTemplate || !sameBranchType) {
    return buildTrialTemplateStructure(starterOffice, {
      includeDisplays: params.includeDisplays,
    });
  }

  return normalizeTrialTemplateStructure({
    rawStructure: params.trialSettings.platform_trial_structure,
    starterOffice,
    includeDisplays: params.includeDisplays,
  });
}

function countEnabledServices(departments: TrialTemplateDepartmentDraft[]) {
  return departments.reduce(
    (total, department) => total + department.services.filter((service) => service.enabled).length,
    0
  );
}

/* ── Tiny reusable pieces ────────────────────────────────────────────────── */

function StepIndicator({ step, label, active, completed }: { step: number; label: string; active: boolean; completed: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
          completed
            ? 'bg-emerald-500 text-white'
            : active
              ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/25'
              : 'bg-muted text-muted-foreground'
        }`}
      >
        {completed ? <CheckCircle2 className="h-4 w-4" /> : step}
      </span>
      <span className={`text-sm font-medium transition-colors ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-gray-200'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function CountBadge({ count, label, active }: { count: number; label: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
      active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
    }`}>
      <span className="font-bold">{count}</span>
      <span>{label}</span>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────────── */

export function TemplateOnboardingClient({
  organization,
  existingOfficeCount,
  lifecycleState = 'template_trial_state',
  currentTemplate,
  trialTemplate = currentTemplate,
  trialSettings = {},
}: TemplateOnboardingClientProps) {
  const router = useRouter();
  const setupLocked = lifecycleState === 'template_confirmed';
  const initialTemplateId = asString(trialSettings.platform_trial_template_id, trialTemplate.id);
  const initialBranchType = asString(
    trialSettings.platform_trial_branch_type,
    trialTemplate.branchType
  ) as BranchType;
  const initialCreateStarterDisplay = asBoolean(
    trialSettings.platform_trial_create_starter_display,
    true
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);
  const [highlightedTemplateId, setHighlightedTemplateId] = useState<string | null>(
    typeof trialSettings.platform_trial_template_id === 'string' ? initialTemplateId : null
  );
  const [operatingModel, setOperatingModel] = useState<OperatingModel>(
    asString(trialSettings.platform_trial_operating_model, trialTemplate.operatingModel) as OperatingModel
  );
  const [branchType, setBranchType] = useState<BranchType>(initialBranchType);
  const [officeName, setOfficeName] = useState(
    asString(trialSettings.platform_trial_office_name, `${organization.name} Main Location`)
  );
  const [timezone, setTimezone] = useState(
    asString(trialSettings.platform_trial_timezone, 'America/Los_Angeles')
  );
  const [createStarterDisplay, setCreateStarterDisplay] = useState(initialCreateStarterDisplay);
  const [seedPriorities, setSeedPriorities] = useState(
    asBoolean(trialSettings.platform_trial_seed_priorities, true)
  );
  const [trialStructure, setTrialStructure] = useState<TrialTemplateStructure>(() =>
    initialStructure({
      templateId: initialTemplateId,
      branchType: initialBranchType,
      includeDisplays: initialCreateStarterDisplay,
      trialSettings,
    })
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPreviewPending, startPreviewTransition] = useTransition();
  const [isConfirmPending, startConfirmTransition] = useTransition();
  const [isClearPending, startClearTransition] = useTransition();
  const [expandedDepartments, setExpandedDepartments] = useState<Set<number>>(
    () => new Set(trialStructure.departments.map((_, i) => i))
  );

  const selectedTemplate =
    industryTemplates.find((entry) => entry.id === selectedTemplateId) ?? industryTemplates[0];
  const starterOffice =
    selectedTemplate.starterOffices.find((office) => office.branchType === branchType) ??
    selectedTemplate.starterOffices[0];
  const vocabulary = selectedTemplate.experienceProfile.vocabulary ?? FALLBACK_VOCABULARY;
  const availableBranchTypes = selectedTemplate.starterOffices.map((office) => office.branchType);
  const enabledDepartments = trialStructure.departments.filter((department) => department.enabled);
  const enabledDepartmentCount = enabledDepartments.length;
  const enabledServiceCount = countEnabledServices(enabledDepartments);
  const enabledDeskCount = trialStructure.desks.filter((desk) => desk.enabled).length;
  const enabledDisplayCount = trialStructure.displays.filter((display) => display.enabled).length;
  const actionPending = isPreviewPending || isConfirmPending || isClearPending;
  const sandboxShareToken =
    typeof trialSettings.platform_trial_share_token === 'string'
      ? trialSettings.platform_trial_share_token
      : '';
  const sandboxLinks = sandboxShareToken
    ? {
        hub: `/sandbox/${sandboxShareToken}`,
        booking: `/sandbox/${sandboxShareToken}/booking`,
        kiosk: `/sandbox/${sandboxShareToken}/kiosk`,
        desk: `/sandbox/${sandboxShareToken}/desk`,
        queue: `/sandbox/${sandboxShareToken}/queue`,
        display: `/sandbox/${sandboxShareToken}/display`,
      }
    : null;

  const departmentOptions = trialStructure.departments.map((department) => ({
    code: department.code,
    name: department.name,
  }));
  const restaurantTemplate = selectedTemplate.vertical === 'restaurant';
  const vc = verticalColor(selectedTemplate.vertical);

  // Determine step completion for progress
  const step1Done = !!selectedTemplateId;
  const step2Done = !!officeName.trim();
  const step3Done = enabledDepartmentCount > 0 && enabledServiceCount > 0;
  const step4Done = enabledDeskCount > 0;

  function resetStructure(nextTemplateId: string, nextBranchType: BranchType, includeDisplays: boolean) {
    const nextTemplate = industryTemplates.find((entry) => entry.id === nextTemplateId) ?? industryTemplates[0];
    const nextOffice =
      nextTemplate.starterOffices.find((office) => office.branchType === nextBranchType) ??
      nextTemplate.starterOffices[0];

    const next = buildTrialTemplateStructure(nextOffice, { includeDisplays });
    setTrialStructure(next);
    setExpandedDepartments(new Set(next.departments.map((_, i) => i)));
  }

  function handleTemplateChange(nextTemplateId: string) {
    const nextTemplate = industryTemplates.find((entry) => entry.id === nextTemplateId) ?? industryTemplates[0];
    const nextBranchType = nextTemplate.starterOffices[0]?.branchType ?? 'service_center';
    const nextDisplaySetting = nextTemplate.capabilityFlags.displayBoard;
    setSelectedTemplateId(nextTemplate.id);
    setHighlightedTemplateId(nextTemplate.id);
    setBranchType(nextBranchType);
    setOperatingModel(
      nextTemplate.vertical === 'bank'
        ? 'service_routing'
        : nextTemplate.vertical === 'clinic'
          ? 'appointments_first'
          : nextTemplate.vertical === 'standard' || nextTemplate.vertical === 'public_service'
            ? 'department_first'
            : 'waitlist'
    );
    setCreateStarterDisplay(nextDisplaySetting);
    setSeedPriorities(nextTemplate.starterPriorities.length > 0);
    resetStructure(nextTemplate.id, nextBranchType, nextDisplaySetting);
  }

  function handleBranchTypeChange(nextBranchType: BranchType) {
    setBranchType(nextBranchType);
    resetStructure(selectedTemplate.id, nextBranchType, createStarterDisplay);
  }

  function handleDisplayToggle(enabled: boolean) {
    setCreateStarterDisplay(enabled);
    if (enabled) {
      setTrialStructure((current) =>
        current.displays.length > 0
          ? current
          : buildTrialTemplateStructure(starterOffice, { includeDisplays: true })
      );
      return;
    }
    setTrialStructure((current) => ({ ...current, displays: [] }));
  }

  function updateDepartment(
    index: number,
    updater: (department: TrialTemplateDepartmentDraft) => TrialTemplateDepartmentDraft
  ) {
    setTrialStructure((current) => ({
      ...current,
      departments: current.departments.map((department, currentIndex) =>
        currentIndex === index ? updater(department) : department
      ),
    }));
  }

  function addDepartment() {
    setTrialStructure((current) => {
      const newIndex = current.departments.length;
      setExpandedDepartments((prev) => new Set([...prev, newIndex]));
      return {
        ...current,
        departments: [
          ...current.departments,
          {
            code: `AREA${newIndex + 1}`,
            name: `New ${vocabulary.departmentLabel.toLowerCase()}`,
            enabled: true,
            services: [
              {
                code: `SERV${newIndex + 1}`,
                name: `New ${vocabulary.serviceLabel.toLowerCase()}`,
                enabled: true,
              },
            ],
          },
        ],
      };
    });
  }

  function removeDepartment(index: number) {
    setTrialStructure((current) => {
      const department = current.departments[index];
      return {
        departments: current.departments.filter((_, currentIndex) => currentIndex !== index),
        desks: current.desks.filter((desk) => desk.departmentCode !== department.code),
        displays: current.displays,
      };
    });
    setExpandedDepartments((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  }

  function addService(departmentIndex: number) {
    updateDepartment(departmentIndex, (department) => ({
      ...department,
      services: [
        ...department.services,
        {
          code: `${department.code}S${department.services.length + 1}`,
          name: `New ${vocabulary.serviceLabel.toLowerCase()}`,
          enabled: true,
        },
      ],
    }));
  }

  function addDesk() {
    const firstDepartment = departmentOptions[0];
    if (!firstDepartment) return;
    setTrialStructure((current) => ({
      ...current,
      desks: [
        ...current.desks,
        {
          name: `${vocabulary.deskLabel} ${current.desks.length + 1}`,
          departmentCode: firstDepartment.code,
          enabled: true,
          status: 'open',
          serviceCodes:
            current.departments
              .find((department) => department.code === firstDepartment.code)
              ?.services.map((service) => service.code) ?? [],
        },
      ],
    }));
  }

  function addDisplay() {
    setTrialStructure((current) => ({
      ...current,
      displays: [
        ...current.displays,
        {
          name: `${officeName || organization.name} Screen ${current.displays.length + 1}`,
          layout: selectedTemplate.experienceProfile.display.defaultLayout,
          enabled: true,
        },
      ],
    }));
  }

  function buildPayload() {
    return {
      templateId: selectedTemplate.id,
      operatingModel,
      branchType,
      officeName,
      timezone,
      createStarterDisplay,
      seedPriorities,
      trialStructure,
    };
  }

  function handleSavePreview() {
    setErrorMessage(null);
    setSuccessMessage(null);
    startPreviewTransition(async () => {
      const result = await saveIndustryTemplateTrial(buildPayload());
      if (result && 'error' in result && result.error) {
        setErrorMessage(result.error);
        return;
      }
      setSuccessMessage('Draft saved. Nothing live was created yet.');
      setHighlightedTemplateId(selectedTemplate.id);
      router.refresh();
    });
  }

  function handleConfirmTemplate() {
    setErrorMessage(null);
    setSuccessMessage(null);
    startConfirmTransition(async () => {
      const result = await confirmIndustryTemplateSetup(buildPayload());
      if (result && 'error' in result && result.error) {
        setErrorMessage(result.error);
        return;
      }
      setSuccessMessage(
        `Setup confirmed. Created ${result && 'data' in result ? result.data?.departmentsCreated ?? 0 : 0} areas, ${
          result && 'data' in result ? result.data?.servicesCreated ?? 0 : 0
        } services, and ${result && 'data' in result ? result.data?.desksCreated ?? 0 : 0} ${vocabulary.deskLabel.toLowerCase()}s.`
      );
      router.refresh();
    });
  }

  function handleClearPreview() {
    setErrorMessage(null);
    setSuccessMessage(null);
    startClearTransition(async () => {
      const result = await clearIndustryTemplateTrial();
      if (result && 'error' in result && result.error) {
        setErrorMessage(result.error);
        return;
      }
      setSelectedTemplateId(currentTemplate.id);
      setHighlightedTemplateId(null);
      setOperatingModel(currentTemplate.operatingModel as OperatingModel);
      setBranchType(currentTemplate.branchType as BranchType);
      setCreateStarterDisplay(true);
      setSeedPriorities(currentTemplate.vertical !== 'restaurant' ? true : false);
      setOfficeName(`${organization.name} Main Location`);
      setTimezone('America/Los_Angeles');
      resetStructure(currentTemplate.id, currentTemplate.branchType as BranchType, true);
      setSuccessMessage('Draft cleared. Your live business was not changed.');
      router.refresh();
    });
  }

  function toggleDepartmentExpanded(index: number) {
    setExpandedDepartments((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-28 sm:px-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Business Setup</h1>
        <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
          Choose a starting template, configure your structure, and go live when you&apos;re ready.
        </p>
        {setupLocked && (
          <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <Lock className="h-4 w-4 shrink-0" />
            <span>Setup is locked. Go to <span className="font-medium">Settings</span> to reset if you need to start over.</span>
          </div>
        )}
      </div>

      {/* ── Progress Steps ───────────────────────────────────────────── */}
      {!setupLocked && (
        <div className="mb-8 flex items-center gap-1 overflow-x-auto pb-1">
          <StepIndicator step={1} label="Business type" active={!step1Done} completed={step1Done} />
          <div className="mx-1 h-px w-6 bg-border sm:w-10" />
          <StepIndicator step={2} label="Location" active={step1Done && !step2Done} completed={step2Done} />
          <div className="mx-1 h-px w-6 bg-border sm:w-10" />
          <StepIndicator step={3} label="Structure" active={step2Done && !step3Done} completed={step3Done} />
          <div className="mx-1 h-px w-6 bg-border sm:w-10" />
          <StepIndicator step={4} label="Stations" active={step3Done && !step4Done} completed={step4Done} />
        </div>
      )}

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      <div className="space-y-8">
        {/* ══════════════════════════════════════════════════════════════ */}
        {/* STEP 1 — Business Type                                       */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Choose your business type</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              This sets your default labels, customer flow, and starter structure.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {industryTemplates.map((template) => {
              const active = selectedTemplateId === template.id;
              const color = verticalColor(template.vertical);
              const features = verticalFeatures(template.vertical);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateChange(template.id)}
                  disabled={setupLocked}
                  className={`group relative flex flex-col rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
                    active
                      ? `${color.border} ${color.bg} shadow-sm`
                      : 'border-border/50 bg-card hover:border-border hover:shadow-sm'
                  } ${setupLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {/* Icon + Selected indicator */}
                  <div className="flex items-start justify-between mb-3">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${color.bg} ${color.text}`}>
                      {verticalIcon(template.vertical)}
                    </span>
                    {active && (
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${color.accent}`}>
                        <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                      </span>
                    )}
                  </div>

                  {/* Title + Description */}
                  <p className="text-sm font-semibold text-foreground">{template.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                    {verticalDescription(template.vertical)}
                  </p>

                  {/* Feature tags */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {features.map((feature) => (
                      <span
                        key={feature}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
                          active ? `${color.badgeBg} ${color.badgeText}` : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {feature}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* STEP 2 — Location & Flow                                     */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Your first location</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Name your location and choose how customers join the queue.
            </p>
          </div>

          <SectionCard>
            <div className="p-6">
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {vocabulary.officeLabel} name
                  </label>
                  <input
                    value={officeName}
                    onChange={(e) => setOfficeName(e.target.value)}
                    disabled={setupLocked}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-60 transition-all"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Timezone
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      disabled={setupLocked}
                      className="w-full appearance-none rounded-xl border border-border bg-background pl-9 pr-8 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-60 transition-all"
                    >
                      {Intl.supportedValuesOf('timeZone').map((tz) => {
                        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
                        const offsetPart = fmt.formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
                        const offset = offsetPart.replace('GMT', 'UTC');
                        return <option key={tz} value={tz}>{tz} ({offset})</option>;
                      })}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Customer flow
                  </label>
                  <select
                    value={operatingModel}
                    onChange={(e) => setOperatingModel(e.target.value as OperatingModel)}
                    disabled={setupLocked}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-60 transition-all"
                  >
                    <option value="department_first">Customers choose an area first</option>
                    <option value="service_routing">Customers choose what they need</option>
                    <option value="appointments_first">Appointments first</option>
                    <option value="waitlist">Simple waitlist</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {vocabulary.officeLabel} style
                  </label>
                  <select
                    value={branchType}
                    onChange={(e) => handleBranchTypeChange(e.target.value as BranchType)}
                    disabled={setupLocked}
                    className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 disabled:opacity-60 transition-all"
                  >
                    {availableBranchTypes.map((type) => (
                      <option key={type} value={type}>
                        {formatEnum(type)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggle options */}
              <div className="mt-6 flex flex-wrap items-center gap-4 rounded-xl bg-muted/30 px-4 py-3">
                <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer">
                  <Toggle checked={createStarterDisplay} onChange={handleDisplayToggle} disabled={setupLocked} />
                  <span>Display screens</span>
                </label>
                {selectedTemplate.starterPriorities.length > 0 && (
                  <label className="flex items-center gap-2.5 text-sm text-foreground cursor-pointer">
                    <Toggle checked={seedPriorities} onChange={setSeedPriorities} disabled={setupLocked} />
                    <span>Priority categories</span>
                  </label>
                )}
              </div>
            </div>
          </SectionCard>
        </section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* STEP 3 — Structure                                           */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {vocabulary.departmentLabel}s &amp; {vocabulary.serviceLabel}s
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                What customers see when they join. You can adjust these anytime later.
              </p>
            </div>
            {!setupLocked && (
              <button
                type="button"
                onClick={addDepartment}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add {vocabulary.departmentLabel.toLowerCase()}
              </button>
            )}
          </div>

          {restaurantTemplate && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              <UtensilsCrossed className="h-4 w-4 shrink-0" />
              Guests pick party size and preference. Hosts handle the actual seating.
            </div>
          )}

          <div className="space-y-3">
            {trialStructure.departments.map((department, departmentIndex) => {
              const isExpanded = expandedDepartments.has(departmentIndex);
              const activeServiceCount = department.services.filter((s) => s.enabled).length;
              const totalServiceCount = department.services.length;
              return (
                <SectionCard key={`${department.code}-${departmentIndex}`}>
                  {/* Department header */}
                  <div className="flex items-center gap-3 px-5 py-3.5">
                    <button
                      type="button"
                      onClick={() => toggleDepartmentExpanded(departmentIndex)}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className={`h-2 w-2 rounded-full ${department.enabled ? vc.accent : 'bg-muted-foreground/30'}`} />
                    <input
                      value={department.name}
                      onChange={(e) =>
                        updateDepartment(departmentIndex, (current) => ({
                          ...current,
                          name: e.target.value,
                        }))
                      }
                      disabled={setupLocked}
                      className="flex-1 bg-transparent text-sm font-semibold text-foreground focus:outline-none disabled:opacity-60"
                    />
                    <span className="text-xs text-muted-foreground">
                      {activeServiceCount}/{totalServiceCount} active
                    </span>
                    <Toggle
                      checked={department.enabled}
                      onChange={(v) =>
                        updateDepartment(departmentIndex, (current) => ({ ...current, enabled: v }))
                      }
                      disabled={setupLocked}
                    />
                    {!setupLocked && trialStructure.departments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeDepartment(departmentIndex)}
                        className="text-muted-foreground/50 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Services list */}
                  {isExpanded && (
                    <div className="border-t border-border/50 bg-muted/20 px-5 py-3 space-y-1.5">
                      {department.services.map((service, serviceIndex) => (
                        <div
                          key={`${service.code}-${serviceIndex}`}
                          className="flex items-center gap-3 rounded-xl bg-background px-3.5 py-2.5 border border-transparent hover:border-border/50 transition-colors"
                        >
                          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30" />
                          <input
                            value={service.name}
                            onChange={(e) =>
                              updateDepartment(departmentIndex, (current) => ({
                                ...current,
                                services: current.services.map((entry, entryIndex) =>
                                  entryIndex === serviceIndex
                                    ? { ...entry, name: e.target.value }
                                    : entry
                                ),
                              }))
                            }
                            disabled={setupLocked}
                            className="flex-1 bg-transparent text-sm text-foreground focus:outline-none disabled:opacity-60"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateDepartment(departmentIndex, (current) => ({
                                ...current,
                                services: current.services.map((entry, entryIndex) =>
                                  entryIndex === serviceIndex
                                    ? { ...entry, enabled: !entry.enabled }
                                    : entry
                                ),
                              }))
                            }
                            disabled={setupLocked}
                            className={`rounded-lg p-1 transition-colors ${
                              service.enabled
                                ? 'text-primary hover:bg-primary/10'
                                : 'text-muted-foreground/40 hover:bg-muted'
                            }`}
                            title={service.enabled ? 'Visible to customers' : 'Hidden from customers'}
                          >
                            {service.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      ))}
                      {!setupLocked && (
                        <button
                          type="button"
                          onClick={() => addService(departmentIndex)}
                          className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          Add {vocabulary.serviceLabel.toLowerCase()}
                        </button>
                      )}
                    </div>
                  )}
                </SectionCard>
              );
            })}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* STEP 4 — Stations & Screens                                  */}
        {/* ══════════════════════════════════════════════════════════════ */}
        <section>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              {vocabulary.deskLabel}s &amp; Screens
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Set up where your staff will work and what customers will see.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* ── Desks / Counters ─────────────────────────────────── */}
            <SectionCard>
              <SectionHeader
                title={`${vocabulary.deskLabel}s`}
                description={`Where staff serve ${vocabulary.customerLabel.toLowerCase()}s`}
                action={!setupLocked ? (
                  <button
                    type="button"
                    onClick={addDesk}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                ) : undefined}
              />
              <div className="px-6 pb-5 space-y-2">
                {trialStructure.desks.map((desk, deskIndex) => (
                  <div
                    key={`${desk.name}-${deskIndex}`}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
                      desk.enabled ? 'border-border/50 bg-background' : 'border-border/30 bg-muted/30 opacity-60'
                    }`}
                  >
                    <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      value={desk.name}
                      onChange={(e) =>
                        setTrialStructure((current) => ({
                          ...current,
                          desks: current.desks.map((entry, entryIndex) =>
                            entryIndex === deskIndex ? { ...entry, name: e.target.value } : entry
                          ),
                        }))
                      }
                      disabled={setupLocked}
                      className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground focus:outline-none disabled:opacity-60"
                    />
                    <select
                      value={desk.departmentCode}
                      onChange={(e) =>
                        setTrialStructure((current) => ({
                          ...current,
                          desks: current.desks.map((entry, entryIndex) =>
                            entryIndex === deskIndex
                              ? {
                                  ...entry,
                                  departmentCode: e.target.value,
                                  serviceCodes:
                                    current.departments
                                      .find((department) => department.code === e.target.value)
                                      ?.services.map((service) => service.code) ?? [],
                                }
                              : entry
                          ),
                        }))
                      }
                      disabled={setupLocked}
                      className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
                    >
                      {departmentOptions.map((d) => (
                        <option key={d.code} value={d.code}>{d.name}</option>
                      ))}
                    </select>
                    <Toggle
                      checked={desk.enabled}
                      onChange={(v) =>
                        setTrialStructure((current) => ({
                          ...current,
                          desks: current.desks.map((entry, entryIndex) =>
                            entryIndex === deskIndex ? { ...entry, enabled: v } : entry
                          ),
                        }))
                      }
                      disabled={setupLocked}
                    />
                    {!setupLocked && trialStructure.desks.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setTrialStructure((current) => ({
                            ...current,
                            desks: current.desks.filter((_, entryIndex) => entryIndex !== deskIndex),
                          }))
                        }
                        className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {trialStructure.desks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                    No {vocabulary.deskLabel.toLowerCase()}s yet. Add one to get started.
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ── Display Screens ──────────────────────────────────── */}
            <SectionCard>
              <SectionHeader
                title="Display screens"
                description="Public-facing queue boards"
                action={!setupLocked && createStarterDisplay ? (
                  <button
                    type="button"
                    onClick={addDisplay}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Add
                  </button>
                ) : undefined}
              />
              <div className="px-6 pb-5">
                {!createStarterDisplay ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                    Display screens are off. Enable them above in step 2.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {trialStructure.displays.map((display, displayIndex) => (
                      <div
                        key={`${display.name}-${displayIndex}`}
                        className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all ${
                          display.enabled ? 'border-border/50 bg-background' : 'border-border/30 bg-muted/30 opacity-60'
                        }`}
                      >
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <input
                          value={display.name}
                          onChange={(e) =>
                            setTrialStructure((current) => ({
                              ...current,
                              displays: current.displays.map((entry, entryIndex) =>
                                entryIndex === displayIndex ? { ...entry, name: e.target.value } : entry
                              ),
                            }))
                          }
                          disabled={setupLocked}
                          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground focus:outline-none disabled:opacity-60"
                        />
                        <select
                          value={display.layout ?? selectedTemplate.experienceProfile.display.defaultLayout}
                          onChange={(e) =>
                            setTrialStructure((current) => ({
                              ...current,
                              displays: current.displays.map((entry, entryIndex) =>
                                entryIndex === displayIndex
                                  ? { ...entry, layout: e.target.value as 'list' | 'grid' | 'department_split' }
                                  : entry
                              ),
                            }))
                          }
                          disabled={setupLocked}
                          className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
                        >
                          <option value="list">List</option>
                          <option value="grid">Grid</option>
                          <option value="department_split">Split</option>
                        </select>
                        <Toggle
                          checked={display.enabled}
                          onChange={(v) =>
                            setTrialStructure((current) => ({
                              ...current,
                              displays: current.displays.map((entry, entryIndex) =>
                                entryIndex === displayIndex ? { ...entry, enabled: v } : entry
                              ),
                            }))
                          }
                          disabled={setupLocked}
                        />
                        {!setupLocked && trialStructure.displays.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setTrialStructure((current) => ({
                                ...current,
                                displays: current.displays.filter((_, entryIndex) => entryIndex !== displayIndex),
                              }))
                            }
                            className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════ */}
        {/* Sandbox Preview                                              */}
        {/* ══════════════════════════════════════════════════════════════ */}
        {sandboxLinks && !setupLocked && (
          <SectionCard>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Sandbox preview</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Test the customer journey before going live. Nothing here is real.
                </p>
              </div>
              <a
                href={sandboxLinks.hub}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                Open sandbox
              </a>
            </div>
            <div className="flex flex-wrap gap-2 px-6 pb-5">
              {sandboxSurfaceMeta
                .filter((surface) => surface.key !== 'overview')
                .map((surface) => (
                  <a
                    key={surface.key}
                    href={
                      surface.key === 'booking'
                        ? sandboxLinks.booking
                        : surface.key === 'kiosk'
                          ? sandboxLinks.kiosk
                          : surface.key === 'desk'
                            ? sandboxLinks.desk
                            : surface.key === 'queue'
                              ? sandboxLinks.queue
                              : sandboxLinks.display
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                  >
                    {surface.label}
                  </a>
                ))}
            </div>
          </SectionCard>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Bottom Action Bar                                            */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!setupLocked && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 backdrop-blur-md">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3.5">
            {/* Summary pills */}
            <div className="hidden items-center gap-2 sm:flex">
              <CountBadge count={enabledDepartmentCount} label={enabledDepartmentCount === 1 ? vocabulary.departmentLabel.toLowerCase() : `${vocabulary.departmentLabel.toLowerCase()}s`} active />
              <CountBadge count={enabledServiceCount} label={enabledServiceCount === 1 ? vocabulary.serviceLabel.toLowerCase() : `${vocabulary.serviceLabel.toLowerCase()}s`} active />
              <CountBadge count={enabledDeskCount} label={enabledDeskCount === 1 ? vocabulary.deskLabel.toLowerCase() : `${vocabulary.deskLabel.toLowerCase()}s`} active />
              {createStarterDisplay && <CountBadge count={enabledDisplayCount} label={`screen${enabledDisplayCount !== 1 ? 's' : ''}`} active />}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2.5 ml-auto">
              {highlightedTemplateId && (
                <button
                  type="button"
                  onClick={handleClearPreview}
                  disabled={actionPending}
                  className="rounded-xl px-3.5 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {isClearPending ? 'Clearing...' : 'Clear draft'}
                </button>
              )}
              <button
                type="button"
                onClick={handleSavePreview}
                disabled={actionPending}
                className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                {isPreviewPending ? 'Saving...' : 'Save draft'}
              </button>
              <button
                type="button"
                onClick={handleConfirmTemplate}
                disabled={actionPending}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                <Rocket className="h-3.5 w-3.5" />
                {isConfirmPending ? 'Creating...' : 'Go live'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

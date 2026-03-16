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
  Eye,
  EyeOff,
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
    case 'public_service':
      return 'Public service';
    case 'bank':
      return 'Banking';
    case 'clinic':
      return 'Clinic';
    case 'restaurant':
      return 'Restaurant';
    case 'barbershop':
      return 'Salon or barbershop';
    default:
      return formatEnum(vertical);
  }
}

function verticalIcon(vertical: string) {
  switch (vertical) {
    case 'public_service':
      return <Building2 className="h-5 w-5" />;
    case 'bank':
      return <ShieldCheck className="h-5 w-5" />;
    case 'clinic':
      return <Plus className="h-5 w-5" />;
    case 'restaurant':
      return <UtensilsCrossed className="h-5 w-5" />;
    case 'barbershop':
      return <Scissors className="h-5 w-5" />;
    default:
      return <Layers className="h-5 w-5" />;
  }
}

function verticalColor(vertical: string) {
  switch (vertical) {
    case 'public_service':
      return { bg: 'bg-slate-100', text: 'text-slate-600', ring: 'ring-slate-300', accent: 'bg-slate-500' };
    case 'bank':
      return { bg: 'bg-stone-100', text: 'text-stone-600', ring: 'ring-stone-300', accent: 'bg-stone-500' };
    case 'clinic':
      return { bg: 'bg-sky-50', text: 'text-sky-600', ring: 'ring-sky-300', accent: 'bg-sky-500' };
    case 'restaurant':
      return { bg: 'bg-amber-50', text: 'text-amber-600', ring: 'ring-amber-300', accent: 'bg-amber-500' };
    case 'barbershop':
      return { bg: 'bg-orange-50', text: 'text-orange-600', ring: 'ring-orange-300', accent: 'bg-orange-500' };
    default:
      return { bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-300', accent: 'bg-gray-500' };
  }
}

function queueFlowLabel(value: OperatingModel, vertical?: string) {
  switch (value) {
    case 'department_first':
      return 'Customers choose an area first';
    case 'service_routing':
      return 'Customers choose what they need';
    case 'appointments_first':
      return 'Appointments first';
    case 'waitlist':
      return vertical === 'restaurant'
        ? 'Hosts control seating'
        : 'Simple waitlist';
    default:
      return formatEnum(value);
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

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
      {n}
    </span>
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

function Pill({ children, active }: { children: React.ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
      }`}
    >
      {children}
    </span>
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
          : nextTemplate.vertical === 'public_service'
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
        } services, and ${result && 'data' in result ? result.data?.desksCreated ?? 0 : 0} counters.`
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
    <div className="mx-auto max-w-5xl space-y-8 p-6 pb-32">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold text-foreground">Business Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a starting template, configure your structure, and go live when ready.
        </p>
        {setupLocked && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <Lock className="h-3.5 w-3.5" />
            Setup is locked. Use settings to reset if you need to start over.
          </div>
        )}
      </header>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {successMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{errorMessage}</div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* STEP 1 — Business Type                                       */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <StepNumber n={1} />
          <div>
            <h2 className="text-base font-semibold text-foreground">Choose your business type</h2>
            <p className="text-sm text-muted-foreground">This sets default labels, flow, and starter structure.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {industryTemplates.map((template) => {
            const active = selectedTemplateId === template.id;
            const color = verticalColor(template.vertical);
            return (
              <button
                key={template.id}
                type="button"
                onClick={() => handleTemplateChange(template.id)}
                disabled={setupLocked}
                className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                  active
                    ? `${color.ring} ring-2 border-transparent ${color.bg}`
                    : 'border-transparent bg-muted/40 hover:bg-muted/70'
                } ${setupLocked ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${color.bg} ${color.text}`}>
                  {verticalIcon(template.vertical)}
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{template.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{verticalLabel(template.vertical)}</p>
                </div>
                {active && (
                  <span className={`absolute right-3 top-3 h-2 w-2 rounded-full ${color.accent}`} />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* STEP 2 — Basic Configuration                                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <StepNumber n={2} />
          <div>
            <h2 className="text-base font-semibold text-foreground">Configure basics</h2>
            <p className="text-sm text-muted-foreground">Name your first location and choose how customers join.</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                {vocabulary.officeLabel} name
              </label>
              <input
                value={officeName}
                onChange={(e) => setOfficeName(e.target.value)}
                disabled={setupLocked}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Timezone</label>
              <input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                disabled={setupLocked}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Customer flow</label>
              <select
                value={operatingModel}
                onChange={(e) => setOperatingModel(e.target.value as OperatingModel)}
                disabled={setupLocked}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              >
                <option value="department_first">Customers choose an area first</option>
                <option value="service_routing">Customers choose what they need</option>
                <option value="appointments_first">Appointments first</option>
                <option value="waitlist">Simple waitlist</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                {vocabulary.officeLabel} style
              </label>
              <select
                value={branchType}
                onChange={(e) => handleBranchTypeChange(e.target.value as BranchType)}
                disabled={setupLocked}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              >
                {availableBranchTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatEnum(type)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-6 border-t border-border pt-4">
            <label className="flex items-center gap-2.5 text-sm text-foreground">
              <Toggle checked={createStarterDisplay} onChange={handleDisplayToggle} disabled={setupLocked} />
              Display screens
            </label>
            {selectedTemplate.starterPriorities.length > 0 && (
              <label className="flex items-center gap-2.5 text-sm text-foreground">
                <Toggle checked={seedPriorities} onChange={setSeedPriorities} disabled={setupLocked} />
                Priority categories
              </label>
            )}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* STEP 3 — Structure                                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <StepNumber n={3} />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">
              {vocabulary.departmentLabel}s &amp; {vocabulary.serviceLabel}s
            </h2>
            <p className="text-sm text-muted-foreground">
              What customers see when they join. Keep it simple.
            </p>
          </div>
          {!setupLocked && (
            <button
              type="button"
              onClick={addDepartment}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              {vocabulary.departmentLabel}
            </button>
          )}
        </div>

        {restaurantTemplate && (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Guests pick party size and preference. Hosts handle the actual seating.
          </div>
        )}

        <div className="space-y-3">
          {trialStructure.departments.map((department, departmentIndex) => {
            const isExpanded = expandedDepartments.has(departmentIndex);
            const activeServiceCount = department.services.filter((s) => s.enabled).length;
            return (
              <div
                key={`${department.code}-${departmentIndex}`}
                className="rounded-xl border border-border bg-card overflow-hidden"
              >
                {/* Department header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => toggleDepartmentExpanded(departmentIndex)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
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
                  <Pill active={department.enabled}>
                    {activeServiceCount} {activeServiceCount === 1 ? vocabulary.serviceLabel.toLowerCase() : `${vocabulary.serviceLabel.toLowerCase()}s`}
                  </Pill>
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
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Services list */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-2">
                    {department.services.map((service, serviceIndex) => (
                      <div
                        key={`${service.code}-${serviceIndex}`}
                        className="flex items-center gap-3 rounded-lg bg-background px-3 py-2"
                      >
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
                          className={`transition-colors ${
                            service.enabled
                              ? 'text-primary hover:text-primary/70'
                              : 'text-muted-foreground/40 hover:text-muted-foreground'
                          }`}
                          title={service.enabled ? 'Visible to customers' : 'Hidden from customers'}
                        >
                          {service.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                      </div>
                    ))}
                    {!setupLocked && (
                      <button
                        type="button"
                        onClick={() => addService(departmentIndex)}
                        className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/70 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add {vocabulary.serviceLabel.toLowerCase()}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* STEP 4 — Stations & Screens                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <StepNumber n={4} />
          <h2 className="text-base font-semibold text-foreground">
            {vocabulary.deskLabel}s &amp; Screens
          </h2>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ── Desks / Counters ─────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">{vocabulary.deskLabel}s</h3>
              </div>
              {!setupLocked && (
                <button
                  type="button"
                  onClick={addDesk}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              )}
            </div>

            <div className="space-y-2">
              {trialStructure.desks.map((desk, deskIndex) => (
                <div
                  key={`${desk.name}-${deskIndex}`}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    desk.enabled ? 'bg-muted/40' : 'bg-muted/20 opacity-60'
                  }`}
                >
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
                    className="flex-1 bg-transparent text-sm font-medium text-foreground focus:outline-none disabled:opacity-60"
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
                    className="w-36 rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
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
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Display Screens ──────────────────────────────────── */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Display screens</h3>
              </div>
              {!setupLocked && createStarterDisplay && (
                <button
                  type="button"
                  onClick={addDisplay}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              )}
            </div>

            {!createStarterDisplay ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Display screens are off. Enable them in step 2.
              </div>
            ) : (
              <div className="space-y-2">
                {trialStructure.displays.map((display, displayIndex) => (
                  <div
                    key={`${display.name}-${displayIndex}`}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                      display.enabled ? 'bg-muted/40' : 'bg-muted/20 opacity-60'
                    }`}
                  >
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
                      className="flex-1 bg-transparent text-sm font-medium text-foreground focus:outline-none disabled:opacity-60"
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
                      className="w-32 rounded border border-border bg-background px-2 py-1 text-xs disabled:opacity-60"
                    >
                      <option value="list">List</option>
                      <option value="grid">Grid</option>
                      <option value="department_split">Split by area</option>
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
                        className="text-muted-foreground hover:text-red-500 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Sandbox Preview Links                                        */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {sandboxLinks && !setupLocked && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
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
              className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
            >
              Open sandbox
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
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
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  {surface.label}
                </a>
              ))}
          </div>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* Bottom Action Bar                                            */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!setupLocked && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            {/* Summary pills */}
            <div className="hidden items-center gap-2 sm:flex">
              <Pill active>{enabledDepartmentCount} {enabledDepartmentCount === 1 ? vocabulary.departmentLabel.toLowerCase() : `${vocabulary.departmentLabel.toLowerCase()}s`}</Pill>
              <Pill active>{enabledServiceCount} {enabledServiceCount === 1 ? vocabulary.serviceLabel.toLowerCase() : `${vocabulary.serviceLabel.toLowerCase()}s`}</Pill>
              <Pill active>{enabledDeskCount} {enabledDeskCount === 1 ? vocabulary.deskLabel.toLowerCase() : `${vocabulary.deskLabel.toLowerCase()}s`}</Pill>
              {createStarterDisplay && <Pill active>{enabledDisplayCount} screen{enabledDisplayCount !== 1 ? 's' : ''}</Pill>}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 ml-auto">
              {highlightedTemplateId && (
                <button
                  type="button"
                  onClick={handleClearPreview}
                  disabled={actionPending}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                >
                  {isClearPending ? 'Clearing...' : 'Clear draft'}
                </button>
              )}
              <button
                type="button"
                onClick={handleSavePreview}
                disabled={actionPending}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                {isPreviewPending ? 'Saving...' : 'Save draft'}
              </button>
              <button
                type="button"
                onClick={handleConfirmTemplate}
                disabled={actionPending}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
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

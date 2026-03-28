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
import { CalendarDays, CheckCircle2, LayoutTemplate, Lock, Monitor, Plus, Save, Settings2, Store } from 'lucide-react';
import {
  clearIndustryTemplateTrial,
  confirmIndustryTemplateSetup,
  saveIndustryTemplateTrial,
} from '@/lib/actions/platform-actions';
import { buildTrialTemplateStructure, normalizeTrialTemplateStructure } from '@/lib/platform/trial-structure';
import { industryTemplates } from '@/lib/platform/templates';
import { sandboxSurfaceMeta } from '@/lib/platform/sandbox-surfaces';
import { useI18n } from '@/components/providers/locale-provider';

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
  liveCounts?: {
    departments: number;
    services: number;
    desks: number;
    displays: number;
  };
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
        ? 'Hosts control seating and call parties when ready'
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

function compactWords(value: string) {
  return value.length > 72 ? `${value.slice(0, 69)}...` : value;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function getTemplatePickTone(vertical: string) {
  switch (vertical) {
    case 'public_service':
      return {
        base: 'border-border bg-background',
        active: 'border-slate-400 bg-slate-100',
      };
    case 'bank':
      return {
        base: 'border-border bg-background',
        active: 'border-stone-400 bg-stone-100',
      };
    case 'clinic':
      return {
        base: 'border-border bg-background',
        active: 'border-neutral-400 bg-neutral-100',
      };
    case 'restaurant':
      return {
        base: 'border-border bg-background',
        active: 'border-amber-400 bg-amber-100/70',
      };
    case 'barbershop':
      return {
        base: 'border-border bg-background',
        active: 'border-orange-300 bg-orange-100/70',
      };
    default:
      return {
        base: 'border-border bg-background',
        active: 'border-primary bg-primary/5',
      };
  }
}

function getTemplateHue(vertical: string) {
  switch (vertical) {
    case 'public_service':
      return {
        page: 'bg-slate-50',
        heroBadge: 'bg-zinc-100 text-zinc-700',
        heroGlow: 'from-slate-50 via-white to-slate-100/60',
        card: 'border-slate-200/90 bg-slate-50/65',
        softCard: 'border-slate-200/90 bg-slate-50/85',
        selectedCard: 'border-zinc-300 bg-zinc-100/70',
      };
    case 'bank':
      return {
        page: 'bg-stone-50',
        heroBadge: 'bg-stone-100 text-stone-700',
        heroGlow: 'from-stone-50 via-white to-amber-100/35',
        card: 'border-stone-200/90 bg-stone-50/65',
        softCard: 'border-stone-200/90 bg-stone-50/85',
        selectedCard: 'border-stone-300 bg-stone-100/70',
      };
    case 'clinic':
      return {
        page: 'bg-neutral-50',
        heroBadge: 'bg-neutral-100 text-neutral-700',
        heroGlow: 'from-neutral-50 via-white to-neutral-100/60',
        card: 'border-neutral-200/90 bg-neutral-50/70',
        softCard: 'border-neutral-200/90 bg-neutral-50/88',
        selectedCard: 'border-neutral-300 bg-neutral-100/70',
      };
    case 'restaurant':
      return {
        page: 'bg-amber-50/35',
        heroBadge: 'bg-stone-100 text-stone-700',
        heroGlow: 'from-amber-50/55 via-white to-stone-100/30',
        card: 'border-amber-200/85 bg-amber-50/40',
        softCard: 'border-amber-200/85 bg-amber-50/60',
        selectedCard: 'border-stone-300 bg-stone-100/70',
      };
    case 'barbershop':
      return {
        page: 'bg-orange-50/30',
        heroBadge: 'bg-orange-100/80 text-stone-700',
        heroGlow: 'from-orange-50/50 via-white to-stone-100/30',
        card: 'border-orange-200/85 bg-orange-50/40',
        softCard: 'border-orange-200/85 bg-orange-50/60',
        selectedCard: 'border-orange-300 bg-orange-100/65',
      };
    default:
      return {
        page: 'bg-white',
        heroBadge: 'bg-primary/10 text-primary',
        heroGlow: 'from-white via-white to-white',
        card: 'border-border bg-card',
        softCard: 'border-border bg-card',
        selectedCard: 'border-primary bg-primary/5',
      };
  }
}

export function TemplateOnboardingClient({
  organization,
  existingOfficeCount,
  lifecycleState = 'template_trial_state',
  currentTemplate,
  trialTemplate = currentTemplate,
  trialSettings = {},
  liveCounts,
}: TemplateOnboardingClientProps) {
  const { t } = useI18n();
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
  const hue = highlightedTemplateId ? getTemplateHue(selectedTemplate.vertical) : getTemplateHue('default');

  function resetStructure(nextTemplateId: string, nextBranchType: BranchType, includeDisplays: boolean) {
    const nextTemplate = industryTemplates.find((entry) => entry.id === nextTemplateId) ?? industryTemplates[0];
    const nextOffice =
      nextTemplate.starterOffices.find((office) => office.branchType === nextBranchType) ??
      nextTemplate.starterOffices[0];

    setTrialStructure(buildTrialTemplateStructure(nextOffice, { includeDisplays }));
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

    setTrialStructure((current) => ({
      ...current,
      displays: [],
    }));
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
    setTrialStructure((current) => ({
      ...current,
      departments: [
        ...current.departments,
        {
          code: `AREA${current.departments.length + 1}`,
          name: `New ${vocabulary.departmentLabel.toLowerCase()}`,
          enabled: true,
          services: [
            {
              code: `SERV${current.departments.length + 1}`,
              name: `New ${vocabulary.serviceLabel.toLowerCase()}`,
              enabled: true,
            },
          ],
        },
      ],
    }));
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
            current.departments.find((department) => department.code === firstDepartment.code)?.services.map(
              (service) => service.code
            ) ?? [],
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
      setSuccessMessage(t('Draft cleared. Your live business was not changed.'));
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-semibold text-primary">
            {setupLocked ? <Lock className="h-4 w-4" /> : <LayoutTemplate className="h-4 w-4" />}
            {setupLocked ? t('Live setup is locked') : t('Build your starter setup')}
          </div>
          <h1 className="mt-4 text-3xl font-bold text-foreground">{t('Business Setup')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('Start with a business type, then shape the actual setup your team will use. Keep only the areas, services, counters, and screens you want before anything goes live.')}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:w-[420px]">
          <MiniStat label={t('Mode')} value={setupLocked ? t('Live business') : t('Draft preview')} />
          <MiniStat label={t('Current setup')} value={currentTemplate.title} />
          <MiniStat label={t('Live locations')} value={`${existingOfficeCount}`} />
          <MiniStat label={t('Draft')} value={highlightedTemplateId ? selectedTemplate.title : t('No draft saved')} />
        </div>
      </div>

      {successMessage ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {successMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <div className={`space-y-6 rounded-[2rem] p-4 transition-colors duration-300 ${hue.page}`}>
        <div className={`rounded-2xl border p-4 shadow-sm transition-colors ${hue.card}`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{t('Pick a starting point')}</p>
              <p className="text-sm text-muted-foreground">
                {t('Keep this compact. The setup editor below is where the real work happens.')}
              </p>
            </div>
            {setupLocked ? (
              <div className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                {t('Switching to another business model is blocked after launch')}
              </div>
            ) : null}
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {industryTemplates.map((template) => {
              const active = highlightedTemplateId != null && template.id === highlightedTemplateId;
              const pickTone = getTemplatePickTone(template.vertical);
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => handleTemplateChange(template.id)}
                  disabled={setupLocked}
                  className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                    active ? pickTone.active : `${pickTone.base} hover:border-primary/40`
                  } ${setupLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                >
                  <p className="text-sm font-semibold text-foreground">{template.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t(verticalLabel(template.vertical))}</p>
                </button>
              );
            })}
          </div>
        </div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="space-y-6">
          <div className={`rounded-3xl border bg-gradient-to-br p-6 shadow-sm transition-colors ${hue.card} ${hue.heroGlow}`}>
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">{t('Basic setup')}</h2>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  {t('How customers start')}
                </label>
                <select
                  value={operatingModel}
                  onChange={(event) => setOperatingModel(event.target.value as OperatingModel)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  disabled={setupLocked}
                >
                  <option value="department_first">{t('Customers choose an area first')}</option>
                  <option value="service_routing">{t('Customers choose what they need')}</option>
                  <option value="appointments_first">{t('Appointments first')}</option>
                  <option value="waitlist">{t('Simple waitlist')}</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  {vocabulary.officeLabel} style
                </label>
                <select
                  value={branchType}
                  onChange={(event) => handleBranchTypeChange(event.target.value as BranchType)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  disabled={setupLocked}
                >
                  {availableBranchTypes.map((type) => (
                    <option key={type} value={type}>
                      {formatEnum(type)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  {t('First {label} name', { label: vocabulary.officeLabel.toLowerCase() })}
                </label>
                <input
                  value={officeName}
                  onChange={(event) => setOfficeName(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  disabled={setupLocked}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-muted-foreground">
                  {t('Timezone')}
                </label>
                <input
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  disabled={setupLocked}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={createStarterDisplay}
                  onChange={(event) => handleDisplayToggle(event.target.checked)}
                  disabled={setupLocked}
                />
                {t('Create starter display screens')}
              </label>
              {selectedTemplate.starterPriorities.length > 0 ? (
                <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={seedPriorities}
                    onChange={(event) => setSeedPriorities(event.target.checked)}
                    disabled={setupLocked}
                  />
                  {t('Include priority options')}
                </label>
              ) : null}
            </div>
          </div>

          <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.softCard}`}>
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">{t('Sandbox test ride')}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Test the full customer journey before you confirm this setup. Nothing here is live, and no real booking, queue ticket, alert, or cancellation will be sent.')}
            </p>

            <div className="mt-4 rounded-2xl border border-current/10 bg-background/90 px-4 py-3 text-sm text-foreground/80">
              {t('You are in test mode. Businesses can open this on another device, scan a real sandbox QR code, and walk through booking, kiosk, queue, and display behavior before launch.')}
            </div>

            {sandboxLinks ? (
              <div className="mt-4 rounded-2xl border border-border bg-background p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t('Shareable sandbox links are ready')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('Open these on desktop or phone. The kiosk preview includes a real QR that opens the sandbox queue page.')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSavePreview}
                      disabled={setupLocked || actionPending}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Save className="h-4 w-4" />
                      {isPreviewPending ? t('Saving draft...') : t('Save draft')}
                    </button>
                    <a
                      href={sandboxLinks.hub}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      {t('Open sandbox')}
                    </a>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
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
                        className="rounded-xl border border-border px-3 py-3 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        {t('{label} preview', { label: surface.label })}
                      </a>
                    ))}
                </div>
                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleConfirmTemplate}
                    disabled={setupLocked || actionPending}
                    className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t('Use this setup')}
                  </button>
                  {!setupLocked ? (
                    <button
                      type="button"
                      onClick={handleClearPreview}
                      disabled={actionPending}
                      className="flex-1 rounded-2xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isClearPending ? t('Clearing draft...') : t('Clear draft')}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-amber-300 bg-background px-4 py-3 text-sm text-amber-900">
                {t('Save the draft once to generate shareable sandbox links for desktop and phone testing.')}
              </div>
            )}

            {!sandboxLinks ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleSavePreview}
                  disabled={setupLocked || actionPending}
                  className="flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-sm font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPreviewPending ? t('Saving draft...') : t('Save draft')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTemplate}
                  disabled={setupLocked || actionPending}
                  className="flex-1 rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t('Use this setup')}
                </button>
                {!setupLocked ? (
                  <button
                    type="button"
                    onClick={handleClearPreview}
                    disabled={actionPending}
                    className="flex-1 rounded-2xl border border-border bg-background px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isClearPending ? t('Clearing draft...') : t('Clear draft')}
                  </button>
                ) : null}
              </div>
            ) : null}

          </div>

          {restaurantTemplate ? (
          <div className={`rounded-3xl border p-5 shadow-sm transition-colors ${hue.softCard}`}>
            <h2 className="text-lg font-semibold text-amber-950">{t('Restaurant host setup')}</h2>
              <div className="mt-3 space-y-2 text-sm leading-6 text-amber-900">
                <p>{t('Guests should choose party size and seating preference, not exact tables.')}</p>
                <p>{t('Hosts keep control of table assignment, indoor or outdoor placement, and reservation arrivals.')}</p>
                <p>{t('Keep the public options simple. The host stand handles the real seating decision.')}</p>
              </div>
            </div>
          ) : null}

          <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t('What customers can choose')}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('Keep this simple. Customers should recognize these options quickly.')}
                </p>
              </div>
              {!setupLocked ? (
                <button
                  type="button"
                  onClick={addDepartment}
                  className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  <Plus className="h-4 w-4" />
                  {t('Add {label}', { label: vocabulary.departmentLabel.toLowerCase() })}
                </button>
              ) : null}
            </div>

            <div className="mt-5 space-y-4">
              {trialStructure.departments.map((department, departmentIndex) => (
                <div key={`${department.code}-${departmentIndex}`} className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          value={department.name}
                          onChange={(event) =>
                            updateDepartment(departmentIndex, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                          className="min-w-[220px] flex-1 rounded-xl border border-border px-3 py-2 text-sm font-semibold"
                          disabled={setupLocked}
                        />
                        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={department.enabled}
                            onChange={(event) =>
                              updateDepartment(departmentIndex, (current) => ({
                                ...current,
                                enabled: event.target.checked,
                              }))
                            }
                            disabled={setupLocked}
                          />
                          {t('Show this area')}
                        </label>
                        {!setupLocked && trialStructure.departments.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeDepartment(departmentIndex)}
                            className="text-sm font-medium text-red-600"
                          >
                            {t('Remove')}
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-3 space-y-2">
                        {department.services.map((service, serviceIndex) => (
                          <div key={`${service.code}-${serviceIndex}`} className="flex flex-col gap-2 rounded-xl border border-border/70 px-3 py-3 sm:flex-row sm:items-center">
                            <input
                              value={service.name}
                              onChange={(event) =>
                                updateDepartment(departmentIndex, (current) => ({
                                  ...current,
                                  services: current.services.map((entry, entryIndex) =>
                                    entryIndex === serviceIndex
                                      ? { ...entry, name: event.target.value }
                                      : entry
                                  ),
                                }))
                              }
                              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
                              disabled={setupLocked}
                            />
                            <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={service.enabled}
                                onChange={(event) =>
                                  updateDepartment(departmentIndex, (current) => ({
                                    ...current,
                                    services: current.services.map((entry, entryIndex) =>
                                      entryIndex === serviceIndex
                                        ? { ...entry, enabled: event.target.checked }
                                        : entry
                                    ),
                                  }))
                                }
                                disabled={setupLocked}
                              />
                              {t('Show')}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {!setupLocked ? (
                    <button
                      type="button"
                      onClick={() => addService(departmentIndex)}
                      className="mt-3 text-sm font-medium text-primary"
                    >
                      {t('+ Add {label}', { label: vocabulary.serviceLabel.toLowerCase() })}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">{t('Counters and desks')}</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('Set up where customers will be served.')}
                  </p>
                </div>
                {!setupLocked ? (
                  <button
                    type="button"
                    onClick={addDesk}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" />
                    {t('Add {label}', { label: vocabulary.deskLabel.toLowerCase() })}
                  </button>
                ) : null}
              </div>

              <div className="mt-5 space-y-3">
                {trialStructure.desks.map((desk, deskIndex) => (
                  <div key={`${desk.name}-${deskIndex}`} className="rounded-2xl border border-border bg-background p-4">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <input
                        value={desk.name}
                        onChange={(event) =>
                          setTrialStructure((current) => ({
                            ...current,
                            desks: current.desks.map((entry, entryIndex) =>
                              entryIndex === deskIndex ? { ...entry, name: event.target.value } : entry
                            ),
                          }))
                        }
                        className="rounded-xl border border-border px-3 py-2 text-sm font-medium"
                        disabled={setupLocked}
                      />
                      <select
                        value={desk.departmentCode}
                        onChange={(event) =>
                          setTrialStructure((current) => ({
                            ...current,
                            desks: current.desks.map((entry, entryIndex) =>
                              entryIndex === deskIndex
                                ? {
                                    ...entry,
                                    departmentCode: event.target.value,
                                    serviceCodes:
                                      current.departments
                                        .find((department) => department.code === event.target.value)
                                        ?.services.map((service) => service.code) ?? [],
                                  }
                                : entry
                            ),
                          }))
                        }
                        className="rounded-xl border border-border px-3 py-2 text-sm"
                        disabled={setupLocked}
                      >
                        {departmentOptions.map((department) => (
                          <option key={department.code} value={department.code}>
                            {department.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={desk.enabled}
                          onChange={(event) =>
                            setTrialStructure((current) => ({
                              ...current,
                              desks: current.desks.map((entry, entryIndex) =>
                                entryIndex === deskIndex ? { ...entry, enabled: event.target.checked } : entry
                              ),
                            }))
                          }
                          disabled={setupLocked}
                        />
                        {t('Create this counter')}
                      </label>
                      {!setupLocked && trialStructure.desks.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setTrialStructure((current) => ({
                              ...current,
                              desks: current.desks.filter((_, entryIndex) => entryIndex !== deskIndex),
                            }))
                          }
                          className="text-sm font-medium text-red-600"
                        >
                          {t('Remove')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold text-foreground">{t('Display screens')}</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('Create public screens only if this business needs them.')}
                  </p>
                </div>
                {!setupLocked && createStarterDisplay ? (
                  <button
                    type="button"
                    onClick={addDisplay}
                    className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" />
                    {t('Add screen')}
                  </button>
                ) : null}
              </div>

              {!createStarterDisplay ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('Starter display screens are turned off for this setup.')}
                </div>
              ) : (
                <div className="mt-5 space-y-3">
                  {trialStructure.displays.map((display, displayIndex) => (
                    <div key={`${display.name}-${displayIndex}`} className="rounded-2xl border border-border bg-background p-4">
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <input
                          value={display.name}
                          onChange={(event) =>
                            setTrialStructure((current) => ({
                              ...current,
                              displays: current.displays.map((entry, entryIndex) =>
                                entryIndex === displayIndex ? { ...entry, name: event.target.value } : entry
                              ),
                            }))
                          }
                          className="rounded-xl border border-border px-3 py-2 text-sm font-medium"
                          disabled={setupLocked}
                        />
                        <select
                          value={display.layout ?? selectedTemplate.experienceProfile.display.defaultLayout}
                          onChange={(event) =>
                            setTrialStructure((current) => ({
                              ...current,
                              displays: current.displays.map((entry, entryIndex) =>
                                entryIndex === displayIndex
                                  ? { ...entry, layout: event.target.value as 'list' | 'grid' | 'department_split' }
                                  : entry
                              ),
                            }))
                          }
                          className="rounded-xl border border-border px-3 py-2 text-sm"
                          disabled={setupLocked}
                        >
                          <option value="list">{t('List view')}</option>
                          <option value="grid">{t('Grid view')}</option>
                          <option value="department_split">{t('Split by area')}</option>
                        </select>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={display.enabled}
                            onChange={(event) =>
                              setTrialStructure((current) => ({
                                ...current,
                                displays: current.displays.map((entry, entryIndex) =>
                                  entryIndex === displayIndex ? { ...entry, enabled: event.target.checked } : entry
                                ),
                              }))
                            }
                            disabled={setupLocked}
                          />
                          {t('Create this screen')}
                        </label>
                        {!setupLocked && trialStructure.displays.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setTrialStructure((current) => ({
                                ...current,
                                displays: current.displays.filter((_, entryIndex) => entryIndex !== displayIndex),
                              }))
                            }
                            className="text-sm font-medium text-red-600"
                          >
                            {t('Remove')}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
            <h2 className="text-lg font-semibold text-foreground">{t('Live summary')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {setupLocked
                ? t('Current state of your business setup.')
                : t('This is the setup that will be created when you confirm.')}
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MiniStat label={vocabulary.officeLabel} value={compactWords(officeName)} />
              <MiniStat label={vocabulary.departmentLabel} value={t('{count} active', { count: setupLocked && liveCounts ? liveCounts.departments : enabledDepartmentCount })} />
              <MiniStat label={vocabulary.serviceLabel} value={t('{count} active', { count: setupLocked && liveCounts ? liveCounts.services : enabledServiceCount })} />
              <MiniStat label={vocabulary.deskLabel} value={t('{count} active', { count: setupLocked && liveCounts ? liveCounts.desks : enabledDeskCount })} />
              <MiniStat label={t('Displays')} value={setupLocked && liveCounts ? t('{count} active', { count: liveCounts.displays }) : createStarterDisplay ? t('{count} active', { count: enabledDisplayCount }) : t('Off')} />
              <MiniStat label={t('Customer flow')} value={t(queueFlowLabel(operatingModel, selectedTemplate.vertical))} />
            </div>
          </div>

          <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
            <h2 className="text-lg font-semibold text-foreground">{t('Customer-facing view')}</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="font-medium text-foreground">{t('Kiosk')}</p>
                <p className="mt-1">{selectedTemplate.experienceProfile.kiosk.headerText}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="font-medium text-foreground">{t('Join page')}</p>
                <p className="mt-1">{selectedTemplate.experienceProfile.publicJoin.headline}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background px-4 py-3">
                <p className="font-medium text-foreground">{t('Display')}</p>
                <p className="mt-1">
                  {createStarterDisplay
                    ? t('Starts in {layout}', { layout: t(formatEnum(selectedTemplate.experienceProfile.display.defaultLayout)) })
                    : t('No starter display screens')}
                </p>
              </div>
            </div>
          </div>

          {setupLocked ? (
            <div className={`rounded-3xl border p-6 shadow-sm transition-colors ${hue.card}`}>
              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {t('This business is already live. Use template updates for safe changes instead of switching the whole setup.')}
              </p>
            </div>
          ) : null}
        </aside>
      </section>
      </div>
    </div>
  );
}

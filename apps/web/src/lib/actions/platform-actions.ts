'use server';

import { revalidatePath } from 'next/cache';
import { type TemplateSectionKey, type TrialTemplateStructure } from '@queueflow/shared';
import { logAuditEvent } from '@/lib/audit';
import { getStaffContext, requireOrganizationAdmin } from '@/lib/authz';
import {
  buildPlatformSelection,
  getPlatformLifecycleState,
  getTrialPlatformSelection,
} from '@/lib/platform/config';
import {
  buildOfficeRolloutSettings,
  buildTemplateGovernanceReport,
  buildTemplateUpgradeSettings,
  type TemplateUpgradeStrategy,
} from '@/lib/platform/governance';
import { recordTemplateHealthSnapshots } from '@/lib/platform/snapshots';
import {
  buildStarterDeskRecords,
  buildStarterRestaurantTableRecords,
  buildStarterDisplayRecords,
  buildStarterOfficeRecord,
  summarizeStarterSeed,
} from '@/lib/platform/starter-data';
import {
  buildTrialTemplateStructure,
  applyTrialStructureToStarterOffice,
  isTrialTemplateStructureCompatible,
  normalizeTrialTemplateStructure,
} from '@/lib/platform/trial-structure';
import { getIndustryTemplateById } from '@/lib/platform/templates';

function generateScreenToken() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function generateSandboxShareToken() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

type TemplateSetupInput = {
  templateId: string;
  operatingModel: 'department_first' | 'service_routing' | 'appointments_first' | 'waitlist';
  branchType:
    | 'service_center'
    | 'branch_office'
    | 'community_clinic'
    | 'restaurant_floor'
    | 'salon_shop';
  officeName: string;
  timezone: string;
  createStarterDisplay: boolean;
  seedPriorities: boolean;
  trialStructure?: TrialTemplateStructure;
};

type OnboardingContext = Awaited<ReturnType<typeof getStaffContext>>;

function buildTrialTemplateSettings(currentSettings: Record<string, unknown>, selection: ReturnType<typeof buildPlatformSelection>, template: ReturnType<typeof getIndustryTemplateById>, input: TemplateSetupInput) {
  return {
    ...currentSettings,
    platform_template_state: 'template_trial_state',
    platform_trial_share_token:
      typeof currentSettings.platform_trial_share_token === 'string'
        ? currentSettings.platform_trial_share_token
        : generateSandboxShareToken(),
    platform_trial_template_id: template.id,
    platform_trial_template_version: template.version.current,
    platform_trial_vertical: template.vertical,
    platform_trial_operating_model: selection.operatingModel,
    platform_trial_branch_type: selection.branchType,
    platform_trial_applied_at: selection.appliedAt,
    platform_trial_updated_at: selection.appliedAt,
    platform_trial_office_name: input.officeName,
    platform_trial_timezone: input.timezone,
    platform_trial_create_starter_display: input.createStarterDisplay,
    platform_trial_seed_priorities: input.seedPriorities,
    platform_trial_structure: input.trialStructure ?? null,
    platform_trial_structure_template_id: template.id,
    platform_trial_structure_branch_type: input.branchType,
  };
}

function clearTrialTemplateSettings(settings: Record<string, unknown>) {
  const nextSettings = { ...settings };
  const trialKeys = [
    'platform_trial_template_id',
    'platform_trial_template_version',
    'platform_trial_vertical',
    'platform_trial_operating_model',
    'platform_trial_branch_type',
    'platform_trial_applied_at',
    'platform_trial_updated_at',
    'platform_trial_office_name',
    'platform_trial_timezone',
    'platform_trial_create_starter_display',
    'platform_trial_seed_priorities',
    'platform_trial_structure',
    'platform_trial_structure_template_id',
    'platform_trial_structure_branch_type',
    'platform_trial_share_token',
  ];

  for (const key of trialKeys) {
    delete nextSettings[key];
  }

  return nextSettings;
}

async function loadOnboardingState(context: OnboardingContext) {
  const [{ data: organization, error: orgError }, { count: existingOfficeCount, error: officeCountError }] =
    await Promise.all([
      context.supabase
        .from('organizations')
        .select('name, settings')
        .eq('id', context.staff.organization_id)
        .single(),
      context.supabase
        .from('offices')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', context.staff.organization_id),
    ]);

  if (orgError) {
    return { error: orgError.message };
  }

  if (officeCountError) {
    return { error: officeCountError.message };
  }

  const currentSettings = (organization?.settings as Record<string, unknown> | null) ?? {};
  const lifecycleState = getPlatformLifecycleState(currentSettings, {
    hasExistingData: (existingOfficeCount ?? 0) > 0,
  });

  return {
    organizationName: organization?.name ?? 'Organization',
    currentSettings,
    existingOfficeCount: existingOfficeCount ?? 0,
    lifecycleState,
  };
}

function getCompatibleTrialStructure(params: {
  settings: Record<string, unknown>;
  templateId: string;
  branchType: string;
  starterOffice: Parameters<typeof buildTrialTemplateStructure>[0];
  includeDisplays: boolean;
  trialStructure?: TrialTemplateStructure;
}) {
  if (params.trialStructure) {
    if (
      !isTrialTemplateStructureCompatible({
        rawStructure: params.trialStructure,
        starterOffice: params.starterOffice,
      })
    ) {
      return buildTrialTemplateStructure(params.starterOffice, {
        includeDisplays: params.includeDisplays,
      });
    }

    return normalizeTrialTemplateStructure({
      rawStructure: params.trialStructure,
      starterOffice: params.starterOffice,
      includeDisplays: params.includeDisplays,
    });
  }

  const sameTemplate =
    params.settings.platform_trial_structure_template_id === params.templateId;
  const sameBranchType =
    params.settings.platform_trial_structure_branch_type === params.branchType;

  if (!sameTemplate || !sameBranchType) {
    return buildTrialTemplateStructure(params.starterOffice, {
      includeDisplays: params.includeDisplays,
    });
  }

  if (
    !isTrialTemplateStructureCompatible({
      rawStructure: params.settings.platform_trial_structure,
      starterOffice: params.starterOffice,
    })
  ) {
    return buildTrialTemplateStructure(params.starterOffice, {
      includeDisplays: params.includeDisplays,
    });
  }

  return normalizeTrialTemplateStructure({
    rawStructure: params.settings.platform_trial_structure,
    starterOffice: params.starterOffice,
    includeDisplays: params.includeDisplays,
  });
}

async function seedConfirmedTemplate(
  context: OnboardingContext,
  currentSettings: Record<string, unknown>,
  input: TemplateSetupInput
) {
  const template = getIndustryTemplateById(input.templateId);
  const starterOffice =
    template.starterOffices.find((office) => office.branchType === input.branchType) ??
    template.starterOffices[0];

  if (!starterOffice) {
    return { error: 'Template is missing starter office data.' };
  }

  const selection = buildPlatformSelection({
    templateId: template.id,
    operatingModel: input.operatingModel,
    branchType: input.branchType,
  });

  const nextSettings = clearTrialTemplateSettings({
    ...currentSettings,
    platform_template_state: 'template_confirmed',
    platform_template_confirmed_at: selection.appliedAt,
    platform_template_id: template.id,
    platform_template_version: template.version.current,
    platform_template_applied_at: selection.appliedAt,
    platform_vertical: template.vertical,
    platform_operating_model: selection.operatingModel,
    platform_branch_type: selection.branchType,
    platform_enabled_modules: template.enabledModules,
    platform_default_navigation: template.defaultNavigation,
    platform_workflow_profile: template.workflowProfile,
    platform_queue_policy: template.queuePolicy,
    platform_experience_profile: template.experienceProfile,
    platform_role_policy: template.rolePolicy,
    platform_capability_snapshot: template.capabilityFlags,
  });

  const { error: updateOrgError } = await context.supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', context.staff.organization_id);

  if (updateOrgError) return { error: updateOrgError.message };

  const starterOfficeRecord = buildStarterOfficeRecord({
    template,
    starterOffice: applyTrialStructureToStarterOffice({
      starterOffice,
      structure: getCompatibleTrialStructure({
        settings: currentSettings,
        templateId: template.id,
        branchType: input.branchType,
        starterOffice,
        includeDisplays: input.createStarterDisplay,
        trialStructure: input.trialStructure,
      }),
    }),
    branchType: input.branchType,
    operatingModel: input.operatingModel,
    officeName: input.officeName,
  });

  const seededStarterOffice = applyTrialStructureToStarterOffice({
    starterOffice,
    structure: getCompatibleTrialStructure({
      settings: currentSettings,
      templateId: template.id,
      branchType: input.branchType,
      starterOffice,
      includeDisplays: input.createStarterDisplay,
      trialStructure: input.trialStructure,
    }),
  });

  const { data: createdOffice, error: officeError } = await context.supabase
    .from('offices')
    .insert({
      organization_id: context.staff.organization_id,
      name: input.officeName,
      timezone: input.timezone || starterOffice.timezone,
      operating_hours: starterOfficeRecord.operatingHours,
      is_active: true,
      settings: starterOfficeRecord.settings,
    })
    .select()
    .single();

  if (officeError || !createdOffice) {
    return { error: officeError?.message ?? 'Failed to create starter office' };
  }

  const departmentIdsByCode = new Map<string, string>();
  const serviceIdsByCode = new Map<string, string>();

  for (const department of seededStarterOffice.departments) {
    const { data: createdDepartment, error: departmentError } = await context.supabase
      .from('departments')
      .insert({
        office_id: createdOffice.id,
        name: department.name,
        code: department.code,
        description: department.description ?? null,
        sort_order: department.sortOrder ?? null,
        is_active: true,
      })
      .select()
      .single();

    if (departmentError || !createdDepartment) {
      return { error: departmentError?.message ?? `Failed to create department ${department.name}` };
    }

    departmentIdsByCode.set(department.code, createdDepartment.id);

    for (const service of department.services) {
      const { data: createdService, error: serviceError } = await context.supabase
        .from('services')
        .insert({
          department_id: createdDepartment.id,
          name: service.name,
          code: service.code,
          description: 'description' in service ? service.description ?? null : null,
          estimated_service_time:
            'estimatedServiceTime' in service ? service.estimatedServiceTime ?? null : null,
          sort_order: 'sortOrder' in service ? service.sortOrder ?? null : null,
          is_active: true,
        })
        .select()
        .single();

      if (serviceError || !createdService) {
        return { error: serviceError?.message ?? `Failed to create service ${service.name}` };
      }

      serviceIdsByCode.set(service.code, createdService.id);
    }
  }

  const starterDesks = buildStarterDeskRecords({
    starterOffice: seededStarterOffice,
    officeId: createdOffice.id,
    departmentIdsByCode,
    serviceIdsByCode,
  });

  for (const starterDesk of starterDesks) {
    const { data: createdDesk, error: deskError } = await context.supabase
      .from('desks')
      .insert(starterDesk.desk)
      .select()
      .single();

    if (deskError || !createdDesk) {
      return { error: deskError?.message ?? `Failed to create desk ${starterDesk.desk.name}` };
    }

    if (starterDesk.serviceIds.length > 0) {
      const { error: deskServicesError } = await context.supabase.from('desk_services').insert(
        starterDesk.serviceIds.map((serviceId) => ({
          desk_id: createdDesk.id,
          service_id: serviceId,
        }))
      );

      if (deskServicesError) {
        return { error: deskServicesError.message };
      }
    }
  }

  for (const schema of template.intakeSchemas) {
    const serviceId = serviceIdsByCode.get(schema.serviceCode);
    if (!serviceId) continue;

    for (const [index, field] of schema.fields.entries()) {
      const { error: fieldError } = await context.supabase.from('intake_form_fields').insert({
        service_id: serviceId,
        field_name: field.key,
        field_label: field.label,
        field_type: field.type,
        is_required: field.required,
        visibility: field.visibility,
        consent_flag: field.consentFlag ?? null,
        options: field.options ?? null,
        sort_order: index + 1,
      });

      if (fieldError) {
        return { error: fieldError.message };
      }
    }
  }

  if (input.seedPriorities && template.starterPriorities.length > 0) {
    const { data: existingPriorities } = await context.supabase
      .from('priority_categories')
      .select('id')
      .eq('organization_id', context.staff.organization_id)
      .limit(1);

    if (!existingPriorities || existingPriorities.length === 0) {
      const { error: priorityError } = await context.supabase.from('priority_categories').insert(
        template.starterPriorities.map((priority) => ({
          organization_id: context.staff.organization_id,
          name: priority.name,
          icon: priority.icon,
          color: priority.color,
          weight: priority.weight,
          is_active: true,
        }))
      );

      if (priorityError) return { error: priorityError.message };
    }
  }

  const starterDisplays = buildStarterDisplayRecords({
    template,
    starterOffice: seededStarterOffice,
    officeId: createdOffice.id,
    officeName: createdOffice.name,
    createStarterDisplay: input.createStarterDisplay,
    generateScreenToken,
  });

  if (starterDisplays.length > 0) {
    const { error: displayError } = await context.supabase
      .from('display_screens')
      .insert(starterDisplays);

    if (displayError) return { error: displayError.message };
  }

  const starterTables = buildStarterRestaurantTableRecords({
    starterOffice: seededStarterOffice,
    officeId: createdOffice.id,
  });

  if (starterTables.length > 0) {
    const { error: tablesError } = await context.supabase
      .from('restaurant_tables')
      .insert(starterTables);

    if (tablesError) return { error: tablesError.message };
  }

  // ── Auto-create virtual queue code + WhatsApp/Messenger defaults ────
  // Pick the first department and first service to create a default join code
  const firstDeptCode = seededStarterOffice.departments[0]?.code;
  const firstDeptId = firstDeptCode ? departmentIdsByCode.get(firstDeptCode) : null;
  const firstSvcCode = seededStarterOffice.departments[0]?.services[0]?.code;
  const firstSvcId = firstSvcCode ? serviceIdsByCode.get(firstSvcCode) : null;

  if (firstDeptId && firstSvcId) {
    const vqcToken = 'vqc_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const { data: createdVqc } = await context.supabase
      .from('virtual_queue_codes')
      .insert({
        organization_id: context.staff.organization_id,
        office_id: createdOffice.id,
        department_id: firstDeptId,
        service_id: firstSvcId,
        qr_token: vqcToken,
        is_active: true,
      })
      .select('id')
      .single();

    if (createdVqc) {
      // Auto-generate WhatsApp code from org name (uppercase, alphanumeric, max 20 chars)
      const { data: orgRow } = await context.supabase
        .from('organizations')
        .select('name, settings')
        .eq('id', context.staff.organization_id)
        .single();

      const orgName = orgRow?.name ?? '';
      const autoCode = orgName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 20) || 'QUEUE';

      // Check if code is taken by another org
      const { data: allOrgs } = await context.supabase
        .from('organizations')
        .select('id, settings');
      const codeTaken = (allOrgs ?? []).some((o: any) => {
        if (o.id === context.staff.organization_id) return false;
        const s = (o.settings ?? {}) as Record<string, string>;
        return (s.whatsapp_code ?? '').toUpperCase() === autoCode;
      });

      const finalCode = codeTaken ? autoCode + Math.floor(Math.random() * 99).toString().padStart(2, '0') : autoCode;

      // Set WhatsApp/Messenger defaults in org settings
      const currentOrgSettings = (orgRow?.settings ?? {}) as Record<string, unknown>;
      await context.supabase
        .from('organizations')
        .update({
          settings: {
            ...currentOrgSettings,
            ...nextSettings,
            whatsapp_default_virtual_code_id: createdVqc.id,
            messenger_default_virtual_code_id: createdVqc.id,
            whatsapp_code: currentOrgSettings.whatsapp_code || finalCode,
          },
        })
        .eq('id', context.staff.organization_id);
    }
  }

  const starterSeedSummary = summarizeStarterSeed({ starterOffice: seededStarterOffice });

  await logAuditEvent(context, {
    actionType: 'template_applied',
    entityType: 'industry_template',
    entityId: template.id,
    officeId: createdOffice.id,
    summary: `Confirmed ${template.title} template for ${createdOffice.name}`,
    metadata: {
      templateVersion: template.version.current,
      operatingModel: input.operatingModel,
      branchType: input.branchType,
      seededPriorities: input.seedPriorities,
      createdStarterDisplay: input.createStarterDisplay,
      servicesCreated: serviceIdsByCode.size,
      departmentsCreated: starterSeedSummary.departmentCount,
      desksCreated: starterSeedSummary.deskCount,
      displaysCreated: starterDisplays.length,
      tablesCreated: starterSeedSummary.tableCount,
      lifecycleState: 'template_confirmed',
    },
  });

  const { data: snapshotOffices, error: snapshotOfficesError } = await context.supabase
    .from('offices')
    .select('id, name, settings')
    .eq('organization_id', context.staff.organization_id)
    .order('name');

  if (!snapshotOfficesError && snapshotOffices) {
    await recordTemplateHealthSnapshots({
      context,
      organizationSettings: nextSettings,
      offices: snapshotOffices,
      snapshotType: 'template_applied',
      officeIds: [createdOffice.id],
    });
  }

  revalidatePath('/admin/onboarding');
  revalidatePath('/admin/offices');
  revalidatePath('/admin/departments');
  revalidatePath('/admin/services');
  revalidatePath('/admin/priorities');
  revalidatePath('/admin/settings');
  revalidatePath('/admin/template-governance');

  return {
    success: true,
    data: {
      officeId: createdOffice.id,
      templateId: template.id,
      departmentsCreated: starterSeedSummary.departmentCount,
      servicesCreated: Array.from(serviceIdsByCode.keys()).length,
      desksCreated: starterSeedSummary.deskCount,
      displaysCreated: starterDisplays.length,
    },
  };
}

export async function saveIndustryTemplateTrial(input: TemplateSetupInput) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);
  const onboardingState = await loadOnboardingState(context);
  if ('error' in onboardingState) return onboardingState;

  if (onboardingState.lifecycleState === 'template_confirmed') {
    return {
      error:
        'Template family switching is only allowed in sandbox preview before setup. This business is already confirmed or has live structure.',
    };
  }

  const template = getIndustryTemplateById(input.templateId);
  const starterOffice =
    template.starterOffices.find((office) => office.branchType === input.branchType) ??
    template.starterOffices[0];
  const selection = buildPlatformSelection({
    templateId: template.id,
    operatingModel: input.operatingModel,
    branchType: input.branchType,
  });
  const normalizedInput = {
    ...input,
    trialStructure: starterOffice
      ? getCompatibleTrialStructure({
          settings: onboardingState.currentSettings,
          templateId: template.id,
          branchType: input.branchType,
          starterOffice,
          includeDisplays: input.createStarterDisplay,
          trialStructure: input.trialStructure,
        })
      : input.trialStructure,
  };
  const nextSettings = buildTrialTemplateSettings(
    onboardingState.currentSettings,
    selection,
    template,
    normalizedInput
  );

  const { error: updateError } = await context.supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', context.staff.organization_id);

  if (updateError) return { error: updateError.message };

  revalidatePath('/admin/onboarding');
  revalidatePath('/admin/template-governance');

  return {
    success: true,
    data: {
      lifecycleState: 'template_trial_state',
      templateId: template.id,
      version: template.version.current,
    },
  };
}

export async function clearIndustryTemplateTrial() {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);
  const onboardingState = await loadOnboardingState(context);
  if ('error' in onboardingState) return onboardingState;

  if (onboardingState.lifecycleState === 'template_confirmed') {
    return {
      error:
        'Sandbox preview can only be cleared before confirmation. This business is already locked to its blueprint.',
    };
  }

  const nextSettings = clearTrialTemplateSettings({
    ...onboardingState.currentSettings,
    platform_template_state: 'template_trial_state',
  });

  const { error: updateError } = await context.supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', context.staff.organization_id);

  if (updateError) return { error: updateError.message };

  revalidatePath('/admin/onboarding');
  revalidatePath('/admin/template-governance');

  return { success: true };
}

export async function confirmIndustryTemplateSetup(input?: Partial<TemplateSetupInput>) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);
  const onboardingState = await loadOnboardingState(context);
  if ('error' in onboardingState) return onboardingState;

  if (onboardingState.lifecycleState === 'template_confirmed') {
    return {
      error:
        'This business already has a confirmed template blueprint. Use governed upgrades or office overrides instead of switching families.',
    };
  }

  const trialSelection = getTrialPlatformSelection(onboardingState.currentSettings);
  const normalizedInput: TemplateSetupInput = {
    templateId: input?.templateId ?? trialSelection.templateId,
    operatingModel: input?.operatingModel ?? trialSelection.operatingModel,
    branchType: input?.branchType ?? trialSelection.branchType,
    officeName:
      input?.officeName ??
      (typeof onboardingState.currentSettings.platform_trial_office_name === 'string'
        ? onboardingState.currentSettings.platform_trial_office_name
        : `${onboardingState.organizationName} Main Location`),
    timezone:
      input?.timezone ??
      (typeof onboardingState.currentSettings.platform_trial_timezone === 'string'
        ? onboardingState.currentSettings.platform_trial_timezone
        : 'America/Los_Angeles'),
    createStarterDisplay:
      input?.createStarterDisplay ??
      Boolean(onboardingState.currentSettings.platform_trial_create_starter_display),
    seedPriorities:
      input?.seedPriorities ??
      Boolean(onboardingState.currentSettings.platform_trial_seed_priorities),
    trialStructure:
      input?.trialStructure ??
      (onboardingState.currentSettings.platform_trial_structure as TrialTemplateStructure | undefined),
  };

  return seedConfirmedTemplate(context, onboardingState.currentSettings, normalizedInput);
}

export async function applyIndustryTemplateSetup(input: TemplateSetupInput) {
  return confirmIndustryTemplateSetup(input);
}

export async function upgradeIndustryTemplateSettings(input: {
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
}) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  const [{ data: organization, error }, { data: offices }] = await Promise.all([
    context.supabase
      .from('organizations')
      .select('settings')
      .eq('id', context.staff.organization_id)
      .single(),
    context.supabase
      .from('offices')
      .select('id, name, settings')
      .eq('organization_id', context.staff.organization_id),
  ]);

  if (error) return { error: error.message };

  const currentSettings = (organization?.settings as Record<string, unknown> | null) ?? {};
  const beforeReport = buildTemplateGovernanceReport({
    organizationSettings: currentSettings,
    offices: offices ?? [],
  });
  const nextSettings = buildTemplateUpgradeSettings({
    organizationSettings: currentSettings,
    sectionStrategies: input.sectionStrategies,
  });

  const { error: updateError } = await context.supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', context.staff.organization_id);

  if (updateError) return { error: updateError.message };

  const stampedOffices = (offices ?? []).map((office) => {
    const officeSettings = (office.settings as Record<string, unknown> | null) ?? {};
    if (typeof officeSettings.platform_template_version === 'string') {
      return {
        ...office,
        settings: officeSettings,
      };
    }

    return {
      ...office,
      settings: {
        ...officeSettings,
        platform_template_id:
          (officeSettings.platform_template_id as string | undefined) ?? beforeReport.templateId,
        platform_template_version: beforeReport.appliedVersion,
      },
    };
  });

  for (const office of stampedOffices) {
    const officeSettings = (office.settings as Record<string, unknown> | null) ?? {};
    if (
      typeof (offices ?? []).find((entry) => entry.id === office.id)?.settings === 'object' &&
      typeof officeSettings.platform_template_version === 'string' &&
      typeof ((offices ?? []).find((entry) => entry.id === office.id)?.settings as Record<string, unknown> | null)
        ?.platform_template_version === 'string'
    ) {
      continue;
    }

    const { error: officeUpdateError } = await context.supabase
      .from('offices')
      .update({
        settings: officeSettings,
      })
      .eq('id', office.id);

    if (officeUpdateError) {
      return { error: officeUpdateError.message };
    }
  }

  const afterReport = buildTemplateGovernanceReport({
    organizationSettings: nextSettings,
    offices: stampedOffices,
  });
  const existingHistory = Array.isArray(currentSettings.platform_migration_history)
    ? currentSettings.platform_migration_history
    : [];
  const finalizedSettings = {
    ...nextSettings,
    platform_migration_history: [
      ...existingHistory,
      {
        applied_at: new Date().toISOString(),
        from_version: beforeReport.appliedVersion,
        to_version: afterReport.latestVersion,
        section_strategies: input.sectionStrategies,
        migration_count: beforeReport.migrationReports.length,
        safe_change_count: beforeReport.safeChangeCount,
        review_required_change_count: beforeReport.reviewRequiredChangeCount,
        breaking_change_count: beforeReport.breakingChangeCount,
      },
    ],
  };
  const { error: historyUpdateError } = await context.supabase
    .from('organizations')
    .update({
      settings: finalizedSettings,
    })
    .eq('id', context.staff.organization_id);

  if (historyUpdateError) {
    return { error: historyUpdateError.message };
  }

  await recordTemplateHealthSnapshots({
    context,
    organizationSettings: finalizedSettings,
    offices: stampedOffices,
    snapshotType: 'template_upgraded',
  });

  await logAuditEvent(context, {
    actionType: 'template_upgraded',
    entityType: 'industry_template',
    entityId: beforeReport.templateId,
    summary: `Updated template settings for ${beforeReport.templateTitle}`,
    metadata: {
      appliedVersion: beforeReport.appliedVersion,
      latestVersion: beforeReport.latestVersion,
      migrationCount: beforeReport.migrationReports.length,
      organizationDriftBefore: beforeReport.organizationDriftCount,
      organizationDriftAfter: afterReport.organizationDriftCount,
      sectionStrategies: input.sectionStrategies,
      officesBehindAfter: afterReport.officesBehindCount,
    },
  });

  revalidatePath('/admin/settings');
  revalidatePath('/admin/template-governance');
  revalidatePath('/admin/onboarding');

  return {
    success: true,
    data: {
      version: afterReport.latestVersion,
      organizationDriftCount: afterReport.organizationDriftCount,
    },
  };
}

export async function rolloutIndustryTemplateToOffices(input: {
  officeIds: string[];
  sectionStrategies: Partial<Record<TemplateSectionKey, TemplateUpgradeStrategy>>;
}) {
  const context = await getStaffContext();
  await requireOrganizationAdmin(context);

  if (input.officeIds.length === 0) {
    return { error: 'Select at least one office to roll out.' };
  }

  const [{ data: organization, error: organizationError }, { data: offices, error: officesError }] =
    await Promise.all([
      context.supabase
        .from('organizations')
        .select('settings')
        .eq('id', context.staff.organization_id)
        .single(),
      context.supabase
        .from('offices')
        .select('id, name, settings')
        .eq('organization_id', context.staff.organization_id)
        .in('id', input.officeIds),
    ]);

  if (organizationError) {
    return { error: organizationError.message };
  }

  if (officesError) {
    return { error: officesError.message };
  }

  const organizationSettings = (organization?.settings as Record<string, unknown> | null) ?? {};
  let updatedOffices = 0;

  for (const office of offices ?? []) {
    const nextSettings = buildOfficeRolloutSettings({
      organizationSettings,
      officeSettings: office.settings ?? {},
      sectionStrategies: input.sectionStrategies,
    });

    const { error } = await context.supabase
      .from('offices')
      .update({ settings: nextSettings })
      .eq('id', office.id);

    if (error) {
      return { error: error.message };
    }

    updatedOffices += 1;
  }

  const { data: snapshotOffices, error: snapshotOfficesError } = await context.supabase
    .from('offices')
    .select('id, name, settings')
    .eq('organization_id', context.staff.organization_id)
    .order('name');

  if (!snapshotOfficesError && snapshotOffices) {
    await recordTemplateHealthSnapshots({
      context,
      organizationSettings,
      offices: snapshotOffices,
      snapshotType: 'office_rollout',
      officeIds: input.officeIds,
    });
  }

  await logAuditEvent(context, {
    actionType: 'template_office_rollout',
    entityType: 'industry_template',
    entityId:
      typeof organizationSettings.platform_template_id === 'string'
        ? organizationSettings.platform_template_id
        : null,
    summary: `Rolled template changes to ${updatedOffices} office${updatedOffices === 1 ? '' : 's'}`,
    metadata: {
      officeIds: input.officeIds,
      sectionStrategies: input.sectionStrategies,
      templateVersion:
        typeof organizationSettings.platform_template_version === 'string'
          ? organizationSettings.platform_template_version
          : null,
    },
  });

  revalidatePath('/admin/template-governance');
  revalidatePath('/admin/offices');
  return {
    success: true,
    data: {
      updatedOffices,
    },
  };
}

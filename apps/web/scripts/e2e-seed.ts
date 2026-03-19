import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { BranchType, OperatingModel } from '@queueflow/shared';
import type { Database, Json } from '../src/lib/supabase/database.types';
import { buildPlatformSelection } from '../src/lib/platform/config';
import {
  buildStarterDeskRecords,
  buildStarterDisplayRecords,
  buildStarterOfficeRecord,
  summarizeStarterSeed,
} from '../src/lib/platform/starter-data';
import { getIndustryTemplateById } from '../src/lib/platform/templates';
import { loadLocalEnv, shouldShowHelp } from './e2e-env';

type Supabase = ReturnType<typeof createServiceClient>;
type DisplaySeedState = {
  id: string;
  name: string;
  screenToken: string;
};

type E2EState = {
  email: string;
  organizationId: string;
  organizationSlug: string;
  officeId: string;
  officeName: string;
  officeSlug: string;
  templateId: string;
  displayScreens: DisplaySeedState[];
};

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function createServiceClient() {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function findUserByEmail(supabase: Supabase, email: string) {
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const existing = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (existing) {
      return existing;
    }

    if (data.users.length < 200) {
      return null;
    }

    page += 1;
  }
}

async function ensureAdminUser(
  supabase: Supabase,
  email: string,
  password: string,
  fullName: string
) {
  const existing = await findUserByEmail(supabase, email);
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: {
        ...(existing.user_metadata ?? {}),
        full_name: fullName,
      },
      email_confirm: true,
    });
    return existing;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  });

  if (error || !data.user) {
    throw error ?? new Error('Failed to create E2E admin user');
  }

  return data.user;
}

async function ensureOrganization(
  supabase: Supabase,
  authUserId: string,
  fullName: string,
  email: string,
  organizationName: string,
  organizationSlug: string
) {
  const { data: existingStaff } = await supabase
    .from('staff')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (existingStaff) {
    const { data: organization, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', existingStaff.organization_id)
      .single();

    if (error || !organization) {
      throw error ?? new Error('Failed to load organization for existing staff');
    }

    await supabase
      .from('staff')
      .update({
        full_name: fullName,
        email,
        role: 'admin',
        is_active: true,
      })
      .eq('id', existingStaff.id);

    return {
      organization,
      staff: existingStaff,
    };
  }

  const { data: existingOrganization } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', organizationSlug)
    .maybeSingle();

  if (existingOrganization) {
    const { data: insertedStaff, error: staffError } = await supabase
      .from('staff')
      .insert({
        auth_user_id: authUserId,
        organization_id: existingOrganization.id,
        full_name: fullName,
        email,
        role: 'admin',
        is_active: true,
      })
      .select()
      .single();

    if (staffError || !insertedStaff) {
      throw staffError ?? new Error('Failed to create staff for existing E2E organization');
    }

    return {
      organization: existingOrganization,
      staff: insertedStaff,
    };
  }

  const { data: organizationId, error: rpcError } = await supabase.rpc(
    'create_organization_with_admin',
    {
      p_org_name: organizationName,
      p_org_slug: organizationSlug,
      p_admin_name: fullName,
      p_admin_email: email,
      p_auth_user_id: authUserId,
    }
  );

  if (rpcError || !organizationId) {
    throw rpcError ?? new Error('Failed to create E2E organization');
  }

  const [{ data: organization, error: organizationError }, { data: staff, error: staffError }] =
    await Promise.all([
      supabase.from('organizations').select('*').eq('id', organizationId).single(),
      supabase.from('staff').select('*').eq('auth_user_id', authUserId).single(),
    ]);

  if (organizationError || !organization) {
    throw organizationError ?? new Error('Failed to load created E2E organization');
  }

  if (staffError || !staff) {
    throw staffError ?? new Error('Failed to load created E2E staff profile');
  }

  return {
    organization,
    staff,
  };
}

async function seedTemplateData(params: {
  supabase: Supabase;
  organizationId: string;
  staffId: string;
  officeName: string;
  timezone: string;
  templateId: string;
  operatingModel: OperatingModel;
  branchType: BranchType;
  createStarterDisplay: boolean;
  seedPriorities: boolean;
  assignAdminOffice: boolean;
  assignAdminDesk: boolean;
  adminStaffRecordId: string;
}) {
  const template = getIndustryTemplateById(params.templateId);
  const starterOffice =
    template.starterOffices.find((office) => office.branchType === params.branchType) ??
    template.starterOffices[0];

  if (!starterOffice) {
    throw new Error('Template is missing starter office data');
  }

  const selection = buildPlatformSelection({
    templateId: template.id,
    operatingModel: params.operatingModel,
    branchType: params.branchType,
  });

  const { data: organization, error: orgError } = await params.supabase
    .from('organizations')
    .select('settings')
    .eq('id', params.organizationId)
    .single();

  if (orgError) {
    throw orgError;
  }

  const currentSettings = (organization?.settings as Record<string, unknown> | null) ?? {};
  const nextSettings = {
    ...currentSettings,
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
  };

  const { error: settingsError } = await params.supabase
    .from('organizations')
    .update({
      settings:
        nextSettings as unknown as Database['public']['Tables']['organizations']['Update']['settings'],
    })
    .eq('id', params.organizationId);

  if (settingsError) {
    throw settingsError;
  }

  const existingOffice = await params.supabase
    .from('offices')
    .select('*')
    .eq('organization_id', params.organizationId)
    .eq('name', params.officeName)
    .maybeSingle();

  if (existingOffice.data) {
    if (params.assignAdminOffice) {
      await params.supabase
        .from('staff')
        .update({ office_id: existingOffice.data.id })
        .eq('id', params.adminStaffRecordId);
    }

    if (params.assignAdminDesk) {
      const { data: firstExistingDesk } = await params.supabase
        .from('desks')
        .select('id')
        .eq('office_id', existingOffice.data.id)
        .order('name')
        .limit(1)
        .maybeSingle();

      if (firstExistingDesk?.id) {
        await params.supabase
          .from('desks')
          .update({ current_staff_id: params.adminStaffRecordId })
          .eq('id', firstExistingDesk.id);
      }
    } else {
      await params.supabase
        .from('desks')
        .update({ current_staff_id: null })
        .eq('current_staff_id', params.adminStaffRecordId);
    }

    const [{ count: deskCount }, { data: existingDisplays }] = await Promise.all([
      params.supabase
        .from('desks')
        .select('id', { count: 'exact', head: true })
        .eq('office_id', existingOffice.data.id),
      params.supabase
        .from('display_screens')
        .select('id, name, screen_token')
        .eq('office_id', existingOffice.data.id)
        .order('name'),
    ]);

    return {
      officeId: existingOffice.data.id,
      officeName: existingOffice.data.name,
      officeSlug: slugify(existingOffice.data.name),
      created: false,
      deskCount: deskCount ?? 0,
      displayCount: existingDisplays?.length ?? 0,
      displayScreens: (existingDisplays ?? []).map((screen) => ({
        id: screen.id,
        name: screen.name,
        screenToken: screen.screen_token,
      })),
      summary: 'Existing office reused',
    };
  }

  const starterOfficeRecord = buildStarterOfficeRecord({
    template,
    starterOffice,
    branchType: params.branchType,
    operatingModel: params.operatingModel,
    officeName: params.officeName,
  });

  const { data: createdOffice, error: officeError } = await params.supabase
    .from('offices')
    .insert({
      organization_id: params.organizationId,
      name: params.officeName,
      timezone: params.timezone || starterOffice.timezone,
      operating_hours: starterOfficeRecord.operatingHours as Json,
      is_active: true,
      settings: starterOfficeRecord.settings as Json,
    })
    .select()
    .single();

  if (officeError || !createdOffice) {
    throw officeError ?? new Error('Failed to create E2E starter office');
  }

  const departmentIdsByCode = new Map<string, string>();
  const serviceIdsByCode = new Map<string, string>();

  for (const department of starterOffice.departments) {
    const { data: createdDepartment, error: departmentError } = await params.supabase
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
      throw departmentError ?? new Error(`Failed to create department ${department.name}`);
    }

    departmentIdsByCode.set(department.code, createdDepartment.id);

    for (const service of department.services) {
      const { data: createdService, error: serviceError } = await params.supabase
        .from('services')
        .insert({
          department_id: createdDepartment.id,
          name: service.name,
          code: service.code,
          description: service.description ?? null,
          estimated_service_time: service.estimatedServiceTime ?? null,
          sort_order: service.sortOrder ?? null,
          is_active: true,
        })
        .select()
        .single();

      if (serviceError || !createdService) {
        throw serviceError ?? new Error(`Failed to create service ${service.name}`);
      }

      serviceIdsByCode.set(service.code, createdService.id);
    }
  }

  const starterDesks = buildStarterDeskRecords({
    starterOffice,
    officeId: createdOffice.id,
    departmentIdsByCode,
    serviceIdsByCode,
  });

  let firstDeskId: string | null = null;

  for (const starterDesk of starterDesks) {
    const { data: createdDesk, error: deskError } = await params.supabase
      .from('desks')
      .insert(starterDesk.desk)
      .select()
      .single();

    if (deskError || !createdDesk) {
      throw deskError ?? new Error(`Failed to create desk ${starterDesk.desk.name}`);
    }

    if (!firstDeskId) {
      firstDeskId = createdDesk.id;
    }

    if (starterDesk.serviceIds.length > 0) {
      const { error: deskServicesError } = await params.supabase.from('desk_services').insert(
        starterDesk.serviceIds.map((serviceId) => ({
          desk_id: createdDesk.id,
          service_id: serviceId,
        }))
      );

      if (deskServicesError) {
        throw deskServicesError;
      }
    }
  }

  for (const schema of template.intakeSchemas) {
    const serviceId = serviceIdsByCode.get(schema.serviceCode);
    if (!serviceId) continue;

    for (const [index, field] of schema.fields.entries()) {
      const { error: fieldError } = await params.supabase.from('intake_form_fields').insert({
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
        throw fieldError;
      }
    }
  }

  if (params.seedPriorities && template.starterPriorities.length > 0) {
    const { data: existingPriorities } = await params.supabase
      .from('priority_categories')
      .select('id')
      .eq('organization_id', params.organizationId)
      .limit(1);

    if (!existingPriorities || existingPriorities.length === 0) {
      const { error: priorityError } = await params.supabase.from('priority_categories').insert(
        template.starterPriorities.map((priority) => ({
          organization_id: params.organizationId,
          name: priority.name,
          icon: priority.icon,
          color: priority.color,
          weight: priority.weight,
          is_active: true,
        }))
      );

      if (priorityError) {
        throw priorityError;
      }
    }
  }

  const starterDisplays = buildStarterDisplayRecords({
    template,
    starterOffice,
    officeId: createdOffice.id,
    officeName: createdOffice.name,
    createStarterDisplay: params.createStarterDisplay,
    generateScreenToken: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16),
  });

  if (starterDisplays.length > 0) {
    const { error: displayError } = await params.supabase
      .from('display_screens')
      .insert(starterDisplays);

    if (displayError) {
      throw displayError;
    }
  }

  const { data: displayScreens } = await params.supabase
    .from('display_screens')
    .select('id, name, screen_token')
    .eq('office_id', createdOffice.id)
    .order('name');

  if (params.assignAdminOffice) {
    await params.supabase
      .from('staff')
      .update({ office_id: createdOffice.id })
      .eq('id', params.adminStaffRecordId);
  }

  if (params.assignAdminDesk && firstDeskId) {
    await params.supabase
      .from('desks')
      .update({ current_staff_id: params.adminStaffRecordId })
      .eq('id', firstDeskId);
  } else {
    await params.supabase
      .from('desks')
      .update({ current_staff_id: null })
      .eq('current_staff_id', params.adminStaffRecordId);
  }

  const starterSeedSummary = summarizeStarterSeed({ starterOffice });

  return {
    officeId: createdOffice.id,
    officeName: createdOffice.name,
    officeSlug: slugify(createdOffice.name),
    created: true,
    deskCount: starterSeedSummary.deskCount,
    displayCount: displayScreens?.length ?? starterDisplays.length,
    displayScreens: (displayScreens ?? []).map((screen) => ({
      id: screen.id,
      name: screen.name,
      screenToken: screen.screen_token,
    })),
    summary: `Created ${starterSeedSummary.departmentCount} departments and ${serviceIdsByCode.size} services`,
  };
}

async function main() {
  loadLocalEnv();

  if (shouldShowHelp()) {
    console.log(`Qflo E2E seed

Required:
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Optional:
  QUEUEFLOW_E2E_EMAIL
  QUEUEFLOW_E2E_PASSWORD
  QUEUEFLOW_E2E_FULL_NAME
  QUEUEFLOW_E2E_ORG_NAME
  QUEUEFLOW_E2E_ORG_SLUG
  QUEUEFLOW_E2E_TEMPLATE_ID
  QUEUEFLOW_E2E_OPERATING_MODEL
  QUEUEFLOW_E2E_BRANCH_TYPE
  QUEUEFLOW_E2E_OFFICE_NAME
  QUEUEFLOW_E2E_TIMEZONE
  QUEUEFLOW_E2E_SEED_PRIORITIES
  QUEUEFLOW_E2E_CREATE_STARTER_DISPLAY
  QUEUEFLOW_E2E_ASSIGN_ADMIN_OFFICE
  QUEUEFLOW_E2E_ASSIGN_ADMIN_DESK
`);
    return;
  }

  const supabase = createServiceClient();

  const email = process.env.QUEUEFLOW_E2E_EMAIL ?? 'e2e-admin@queueflow.local';
  const password = process.env.QUEUEFLOW_E2E_PASSWORD ?? 'Qflo123!';
  const fullName = process.env.QUEUEFLOW_E2E_FULL_NAME ?? 'Qflo E2E Admin';
  const organizationName = process.env.QUEUEFLOW_E2E_ORG_NAME ?? 'Qflo E2E';
  const organizationSlug = process.env.QUEUEFLOW_E2E_ORG_SLUG ?? slugify(organizationName);
  const templateId = process.env.QUEUEFLOW_E2E_TEMPLATE_ID ?? 'bank-branch';
  const operatingModel = (process.env.QUEUEFLOW_E2E_OPERATING_MODEL ??
    'service_routing') as OperatingModel;
  const branchType = (process.env.QUEUEFLOW_E2E_BRANCH_TYPE ?? 'branch_office') as BranchType;
  const officeName = process.env.QUEUEFLOW_E2E_OFFICE_NAME ?? 'E2E Main Branch';
  const timezone = process.env.QUEUEFLOW_E2E_TIMEZONE ?? 'America/Los_Angeles';
  const seedPriorities = (process.env.QUEUEFLOW_E2E_SEED_PRIORITIES ?? 'true') === 'true';
  const createStarterDisplay =
    (process.env.QUEUEFLOW_E2E_CREATE_STARTER_DISPLAY ?? 'true') === 'true';
  const assignAdminOffice = (process.env.QUEUEFLOW_E2E_ASSIGN_ADMIN_OFFICE ?? 'true') === 'true';
  const assignAdminDesk = (process.env.QUEUEFLOW_E2E_ASSIGN_ADMIN_DESK ?? 'false') === 'true';

  const user = await ensureAdminUser(supabase, email, password, fullName);
  const { organization, staff } = await ensureOrganization(
    supabase,
    user.id,
    fullName,
    email,
    organizationName,
    organizationSlug
  );

  const seeded = await seedTemplateData({
    supabase,
    organizationId: organization.id,
    staffId: staff.id,
    officeName,
    timezone,
    templateId,
    operatingModel,
    branchType,
    createStarterDisplay,
    seedPriorities,
    assignAdminOffice,
    assignAdminDesk,
    adminStaffRecordId: staff.id,
  });

  const state: E2EState = {
    email,
    organizationId: organization.id,
    organizationSlug,
    officeId: seeded.officeId,
    officeName: seeded.officeName,
    officeSlug: seeded.officeSlug,
    templateId,
    displayScreens: seeded.displayScreens,
  };

  writeFileSync(resolve(process.cwd(), '.e2e-state.json'), JSON.stringify(state, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        email,
        organizationId: organization.id,
        organizationSlug,
        officeId: seeded.officeId,
        officeName: seeded.officeName,
        officeSlug: seeded.officeSlug,
        templateId,
        createdOffice: seeded.created,
        summary: seeded.summary,
        deskCount: seeded.deskCount,
        displayCount: seeded.displayCount,
        displayScreens: seeded.displayScreens,
        stateFile: '.e2e-state.json',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

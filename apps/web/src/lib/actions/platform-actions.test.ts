import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  revalidatePathMock,
  getStaffContextMock,
  requireOrganizationAdminMock,
  logAuditEventMock,
  recordTemplateHealthSnapshotsMock,
} = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  getStaffContextMock: vi.fn(),
  requireOrganizationAdminMock: vi.fn(),
  logAuditEventMock: vi.fn(),
  recordTemplateHealthSnapshotsMock: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
}));

vi.mock('@/lib/authz', () => ({
  getStaffContext: getStaffContextMock,
  requireOrganizationAdmin: requireOrganizationAdminMock,
}));

vi.mock('@/lib/audit', () => ({
  logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/platform/snapshots', () => ({
  recordTemplateHealthSnapshots: recordTemplateHealthSnapshotsMock,
}));

import {
  applyIndustryTemplateSetup,
  rolloutIndustryTemplateToOffices,
  upgradeIndustryTemplateSettings,
} from './platform-actions';

type TableName =
  | 'organizations'
  | 'offices'
  | 'departments'
  | 'services'
  | 'desks'
  | 'desk_services'
  | 'intake_form_fields'
  | 'priority_categories'
  | 'display_screens'
  | 'restaurant_tables'
  | 'virtual_queue_codes'
  | 'staff';

type RowRecord = Record<string, any>;

class FakeSupabaseBuilder {
  private filters: Array<(row: RowRecord) => boolean> = [];
  private shouldSingle = false;
  private rowLimit: number | null = null;
  private orderField: string | null = null;
  private orderAscending = true;
  private returning = false;
  private insertPayload: RowRecord[] | null = null;
  private updatePayload: RowRecord | null = null;

  constructor(
    private readonly client: FakeSupabaseClient,
    private readonly table: TableName,
    private readonly action: 'select' | 'insert' | 'update'
  ) {}

  select() {
    this.returning = true;
    return this;
  }

  eq(field: string, value: unknown) {
    this.filters.push((row) => row[field] === value);
    return this;
  }

  in(field: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[field]));
    return this;
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderField = field;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  single() {
    this.shouldSingle = true;
    return this;
  }

  setInsertPayload(payload: RowRecord[] | RowRecord) {
    this.insertPayload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  setUpdatePayload(payload: RowRecord) {
    this.updatePayload = payload;
    return this;
  }

  async execute() {
    const tableRows = this.client.tables[this.table];

    if (this.action === 'insert') {
      const inserted = (this.insertPayload ?? []).map((row) => {
        const nextRow = {
          id: row.id ?? this.client.nextId(this.table),
          ...row,
        };
        tableRows.push(nextRow);
        return nextRow;
      });

      return {
        data: this.shouldSingle ? inserted[0] ?? null : this.returning ? inserted : null,
        error: null,
      };
    }

    let rows = tableRows.filter((row) => this.filters.every((filter) => filter(row)));

    if (this.action === 'update') {
      for (const row of rows) {
        Object.assign(row, this.updatePayload ?? {});
      }

      return {
        data: this.shouldSingle ? rows[0] ?? null : this.returning ? rows : null,
        error: null,
      };
    }

    if (this.orderField) {
      rows = [...rows].sort((left, right) => {
        const leftValue = left[this.orderField as string];
        const rightValue = right[this.orderField as string];
        if (leftValue === rightValue) return 0;
        if (leftValue === undefined || leftValue === null) return 1;
        if (rightValue === undefined || rightValue === null) return -1;
        return this.orderAscending
          ? String(leftValue).localeCompare(String(rightValue))
          : String(rightValue).localeCompare(String(leftValue));
      });
    }

    if (this.rowLimit !== null) {
      rows = rows.slice(0, this.rowLimit);
    }

    return {
      data: this.shouldSingle ? rows[0] ?? null : rows,
      error: null,
    };
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class FakeSupabaseClient {
  public tables: Record<TableName, RowRecord[]>;
  private counters = new Map<TableName, number>();

  constructor(seed?: Partial<Record<TableName, RowRecord[]>>) {
    this.tables = {
      organizations: seed?.organizations ? [...seed.organizations] : [],
      offices: seed?.offices ? [...seed.offices] : [],
      departments: seed?.departments ? [...seed.departments] : [],
      services: seed?.services ? [...seed.services] : [],
      desks: seed?.desks ? [...seed.desks] : [],
      desk_services: seed?.desk_services ? [...seed.desk_services] : [],
      intake_form_fields: seed?.intake_form_fields ? [...seed.intake_form_fields] : [],
      priority_categories: seed?.priority_categories ? [...seed.priority_categories] : [],
      display_screens: seed?.display_screens ? [...seed.display_screens] : [],
      restaurant_tables: seed?.restaurant_tables ? [...seed.restaurant_tables] : [],
      virtual_queue_codes: seed?.virtual_queue_codes ? [...seed.virtual_queue_codes] : [],
      staff: seed?.staff ? [...seed.staff] : [],
    };
  }

  nextId(table: TableName) {
    const current = this.counters.get(table) ?? 0;
    const next = current + 1;
    this.counters.set(table, next);
    return `${table}-${next}`;
  }

  from(table: TableName) {
    return {
      select: () => new FakeSupabaseBuilder(this, table, 'select'),
      insert: (payload: RowRecord[] | RowRecord) =>
        new FakeSupabaseBuilder(this, table, 'insert').setInsertPayload(payload),
      update: (payload: RowRecord) =>
        new FakeSupabaseBuilder(this, table, 'update').setUpdatePayload(payload),
    };
  }
}

function createContext(seed?: Partial<Record<TableName, RowRecord[]>>) {
  const supabase = new FakeSupabaseClient(seed);
  return {
    supabase,
    userId: 'user-1',
    staff: {
      id: 'staff-1',
      organization_id: 'org-1',
      office_id: null,
      department_id: null,
      role: 'admin',
      full_name: 'Admin User',
      email: 'admin@example.com',
    },
    accessibleOfficeIds: ['office-1', 'office-2', 'office-3'],
  };
}

describe('platform actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationAdminMock.mockResolvedValue(undefined);
    logAuditEventMock.mockResolvedValue(undefined);
    recordTemplateHealthSnapshotsMock.mockResolvedValue(undefined);
  });

  it('applies an industry template and seeds starter office data end to end', async () => {
    const context = createContext({
      organizations: [{ id: 'org-1', settings: {} }],
    });
    getStaffContextMock.mockResolvedValue(context);

    const result = await applyIndustryTemplateSetup({
      templateId: 'restaurant-waitlist',
      operatingModel: 'waitlist',
      branchType: 'restaurant_floor',
      officeName: 'Harbor Grill',
      timezone: 'America/Los_Angeles',
      createStarterDisplay: false,
      seedPriorities: true,
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          templateId: 'restaurant-waitlist',
          departmentsCreated: 1,
          servicesCreated: 3,
          desksCreated: 2,
          displaysCreated: 0,
        }),
      })
    );

    expect(context.supabase.tables.offices).toHaveLength(1);
    expect(context.supabase.tables.departments).toHaveLength(1);
    expect(context.supabase.tables.services).toHaveLength(3);
    expect(context.supabase.tables.desks).toHaveLength(2);
    expect(context.supabase.tables.desk_services.length).toBeGreaterThanOrEqual(2);
    expect(context.supabase.tables.display_screens).toHaveLength(0);
    expect(context.supabase.tables.priority_categories).toHaveLength(0);
    expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    expect(recordTemplateHealthSnapshotsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotType: 'template_applied',
        officeIds: [expect.any(String)],
      })
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/setup-wizard');
  });

  it('upgrades organization settings, stamps history, and backfills missing office versions', async () => {
    const context = createContext({
      organizations: [
        {
          id: 'org-1',
          settings: {
            platform_template_id: 'bank-branch',
            platform_template_version: '1.0.0',
            platform_vertical: 'bank',
            platform_operating_model: 'service_routing',
            platform_branch_type: 'branch_office',
            platform_queue_policy: { capacityLimit: 50 },
          },
        },
      ],
      offices: [
        { id: 'office-1', name: 'Downtown', organization_id: 'org-1', settings: {} },
        {
          id: 'office-2',
          name: 'Uptown',
          organization_id: 'org-1',
          settings: {
            platform_template_id: 'bank-branch',
            platform_template_version: '1.0.0',
          },
        },
      ],
    });
    getStaffContextMock.mockResolvedValue(context);

    const result = await upgradeIndustryTemplateSettings({
      sectionStrategies: {
        queue_policy: 'adopt_defaults',
        workflow_profile: 'keep_current',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          version: '1.1.0',
        }),
      })
    );

    const organizationSettings = context.supabase.tables.organizations[0]?.settings;
    expect(organizationSettings.platform_template_version).toBe('1.1.0');
    expect(Array.isArray(organizationSettings.platform_migration_history)).toBe(true);
    expect(organizationSettings.platform_migration_history).toHaveLength(1);
    expect(organizationSettings.platform_queue_policy.capacityLimit).toBe(100);
    expect(context.supabase.tables.offices[0]?.settings.platform_template_version).toBe('1.0.0');
    expect(recordTemplateHealthSnapshotsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotType: 'template_upgraded',
      })
    );
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'template_upgraded',
      })
    );
  });

  it('rolls template changes out to selected offices and records rollout history', async () => {
    const context = createContext({
      organizations: [
        {
          id: 'org-1',
          settings: {
            platform_template_id: 'clinic',
            platform_template_version: '1.1.0',
            platform_vertical: 'clinic',
            platform_operating_model: 'appointments_first',
            platform_branch_type: 'community_clinic',
            platform_queue_policy: { capacityLimit: 50 },
          },
        },
      ],
      offices: [
        {
          id: 'office-1',
          name: 'Main Clinic',
          organization_id: 'org-1',
          settings: {
            platform_template_id: 'clinic',
            platform_template_version: '1.0.0',
            platform_queue_policy: { capacityLimit: 25 },
          },
        },
        {
          id: 'office-2',
          name: 'North Clinic',
          organization_id: 'org-1',
          settings: {
            platform_template_id: 'clinic',
            platform_template_version: '1.0.0',
          },
        },
      ],
    });
    getStaffContextMock.mockResolvedValue(context);

    const result = await rolloutIndustryTemplateToOffices({
      officeIds: ['office-1'],
      sectionStrategies: {
        queue_policy: 'adopt_defaults',
        role_policy: 'keep_current',
      },
    });

    expect(result).toEqual({
      success: true,
      data: {
        updatedOffices: 1,
      },
    });

    const updatedOffice = context.supabase.tables.offices.find((office) => office.id === 'office-1');
    const untouchedOffice = context.supabase.tables.offices.find((office) => office.id === 'office-2');

    expect(updatedOffice?.settings.platform_template_version).toBe('1.1.0');
    expect(updatedOffice?.settings.platform_queue_policy).toBeUndefined();
    expect(updatedOffice?.settings.platform_rollout_history).toHaveLength(1);
    expect(untouchedOffice?.settings.platform_template_version).toBe('1.0.0');
    expect(recordTemplateHealthSnapshotsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotType: 'office_rollout',
        officeIds: ['office-1'],
      })
    );
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: 'template_office_rollout',
      })
    );
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/offices');
  });
});

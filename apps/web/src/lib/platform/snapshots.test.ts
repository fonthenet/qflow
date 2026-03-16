import { describe, expect, it } from 'vitest';
import { buildTemplateGovernanceReport } from './governance';
import { buildTemplateHealthSnapshotRows } from './snapshots';

describe('template health snapshot rows', () => {
  it('builds organization and office snapshot rows from governance state', () => {
    const report = buildTemplateGovernanceReport({
      organizationSettings: {
        platform_template_id: 'bank-branch',
        platform_template_version: '1.0.0',
        platform_vertical: 'bank',
        platform_operating_model: 'service_routing',
        platform_branch_type: 'branch_office',
        platform_queue_policy: {
          capacityLimit: 50,
        },
      },
      offices: [
        {
          id: 'office-1',
          name: 'Downtown Branch',
          settings: {
            platform_template_id: 'bank-branch',
            platform_template_version: '1.0.0',
            platform_queue_policy: {
              capacityLimit: 20,
            },
          },
        },
        {
          id: 'office-2',
          name: 'Uptown Branch',
          settings: {
            platform_template_id: 'bank-branch',
            platform_template_version: '1.1.0',
          },
        },
      ],
    });

    const rows = buildTemplateHealthSnapshotRows({
      report,
      context: {
        staff: {
          id: 'staff-1',
          organization_id: 'org-1',
        },
      } as never,
      snapshotType: 'template_upgraded',
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        snapshot_scope: 'organization',
        organization_id: 'org-1',
        template_id: 'bank-branch',
        offices_behind_count: 1,
      })
    );
    expect(rows[1]?.snapshot_scope).toBe('office');
    expect(rows[1]?.office_id).toBe('office-1');
    expect(rows[1]?.offices_behind_count).toBe(1);
    expect(rows[2]?.offices_current_count).toBe(1);
  });

  it('can limit snapshot creation to the offices involved in a rollout', () => {
    const report = buildTemplateGovernanceReport({
      organizationSettings: {
        platform_template_id: 'restaurant-waitlist',
        platform_template_version: '1.0.0',
        platform_vertical: 'restaurant',
        platform_operating_model: 'waitlist',
        platform_branch_type: 'restaurant_floor',
      },
      offices: [
        {
          id: 'office-a',
          name: 'Dining Room',
          settings: {
            platform_template_id: 'restaurant-waitlist',
            platform_template_version: '1.0.0',
          },
        },
        {
          id: 'office-b',
          name: 'Patio',
          settings: {
            platform_template_id: 'restaurant-waitlist',
            platform_template_version: '1.0.0',
          },
        },
      ],
    });

    const rows = buildTemplateHealthSnapshotRows({
      report,
      context: {
        staff: {
          id: 'staff-2',
          organization_id: 'org-2',
        },
      } as never,
      snapshotType: 'office_rollout',
      officeIds: ['office-b'],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.snapshot_scope).toBe('organization');
    expect(rows[1]?.office_id).toBe('office-b');
  });
});

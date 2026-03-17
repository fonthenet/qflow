import { describe, expect, it } from 'vitest';
import { buildStarterDeskRecords, buildStarterDisplayRecords, buildStarterOfficeRecord } from './starter-data';
import { getIndustryTemplateById } from './templates';

describe('starter office seed data', () => {
  it('builds a comprehensive standard starter office record', () => {
    const template = getIndustryTemplateById('standard');
    const starterOffice = template.starterOffices[0]!;

    const record = buildStarterOfficeRecord({
      template,
      starterOffice,
      branchType: starterOffice.branchType,
      operatingModel: 'department_first',
      officeName: 'Central Services',
    });

    expect(record.operatingHours?.monday?.open).toBe('08:00');
    expect(record.settings.platform_template_id).toBe('standard');
    expect(Array.isArray(record.settings.platform_service_areas)).toBe(true);
    expect((record.settings.platform_counter_map as unknown[]).length).toBeGreaterThanOrEqual(4);
  });

  it('seeds restaurant-specific tables and host workflow presets', () => {
    const template = getIndustryTemplateById('restaurant-waitlist');
    const starterOffice = template.starterOffices[0]!;

    const record = buildStarterOfficeRecord({
      template,
      starterOffice,
      branchType: starterOffice.branchType,
      operatingModel: 'waitlist',
      officeName: 'Harbor Grill',
    });

    expect((record.settings.platform_table_presets as unknown[]).length).toBeGreaterThanOrEqual(6);
    expect(record.settings.platform_host_workflow).toEqual(
      expect.objectContaining({
        pagerEnabled: true,
        quoteWaitByZone: true,
      })
    );
  });

  it('maps starter desks to created departments and services', () => {
    const template = getIndustryTemplateById('clinic');
    const starterOffice = template.starterOffices[0]!;
    const departmentIdsByCode = new Map([
      ['R', 'dept-reception'],
      ['T', 'dept-triage'],
      ['C', 'dept-consult'],
    ]);
    const serviceIdsByCode = new Map([
      ['CHECKIN', 'svc-checkin'],
      ['INSURANCE', 'svc-insurance'],
      ['TRIAGE', 'svc-triage'],
      ['CONSULT', 'svc-consult'],
      ['FOLLOWUP', 'svc-followup'],
    ]);

    const desks = buildStarterDeskRecords({
      starterOffice,
      officeId: 'office-1',
      departmentIdsByCode,
      serviceIdsByCode,
    });

    expect(desks).toHaveLength(starterOffice.desks.length);
    expect(desks[0]?.desk.department_id).toBe('dept-reception');
    expect(desks.find((entry) => entry.desk.name === 'triage-room-1')?.serviceIds).toEqual([
      'svc-triage',
    ]);
    expect(desks.find((entry) => entry.desk.name === 'exam-room-2')?.serviceIds).toEqual([
      'svc-consult',
      'svc-followup',
    ]);
  });

  it('prefers explicit display presets when a template ships multiple screens', () => {
    const template = getIndustryTemplateById('standard');
    const starterOffice = template.starterOffices[0]!;

    const displays = buildStarterDisplayRecords({
      template,
      starterOffice,
      officeId: 'office-1',
      officeName: 'Central Services',
      createStarterDisplay: true,
      generateScreenToken: () => 'screen-token',
    });

    expect(displays).toHaveLength(2);
    expect(displays[0]?.name).toBe('Main Display');
    expect(displays[1]?.settings).toEqual(
      expect.objectContaining({
        zone: 'service_area',
      })
    );
  });
});

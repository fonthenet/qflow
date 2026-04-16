import { describe, expect, it } from 'vitest';
import { buildStarterDeskRecords, buildStarterDisplayRecords, buildStarterOfficeRecord } from './starter-data';
import { getIndustryTemplateById } from './templates';

describe('starter office seed data', () => {
  it('builds a comprehensive public-service starter office record', () => {
    const template = getIndustryTemplateById('public-service');
    const starterOffice = template.starterOffices[0]!;

    const record = buildStarterOfficeRecord({
      template,
      starterOffice,
      branchType: starterOffice.branchType,
      operatingModel: 'department_first',
      officeName: 'Central Services',
    });

    expect(record.operatingHours?.monday?.open).toBe('08:00');
    expect(record.settings.platform_template_id).toBe('public-service');
    expect(Array.isArray(record.settings.platform_service_areas)).toBe(true);
    expect((record.settings.platform_service_areas as unknown[]).length).toBeGreaterThanOrEqual(4);
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

    expect(Array.isArray(record.settings.platform_service_areas)).toBe(true);
    expect((record.settings.platform_service_areas as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  it('maps starter desks to created departments and services', () => {
    const template = getIndustryTemplateById('clinic');
    const starterOffice = template.starterOffices[0]!;
    const departmentIdsByCode = new Map([
      ['C', 'dept-consult'],
    ]);
    const serviceIdsByCode = new Map([
      ['CONSULT', 'svc-consult'],
      ['CONTROL', 'svc-control'],
      ['CERT', 'svc-cert'],
    ]);

    const desks = buildStarterDeskRecords({
      starterOffice,
      officeId: 'office-1',
      departmentIdsByCode,
      serviceIdsByCode,
    });

    expect(desks).toHaveLength(starterOffice.desks.length);
    expect(desks[0]?.desk.department_id).toBe('dept-consult');
    expect(desks.find((entry) => entry.desk.name === 'accueil')?.serviceIds).toEqual([
      'svc-consult',
      'svc-control',
      'svc-cert',
    ]);
    expect(desks.find((entry) => entry.desk.name === 'cabinet')?.serviceIds).toEqual([
      'svc-consult',
      'svc-control',
      'svc-cert',
    ]);
  });

  it('prefers explicit display presets when a template ships multiple screens', () => {
    const template = getIndustryTemplateById('public-service');
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
    expect(displays[0]?.name).toBe('Écran Principal');
    expect(displays[1]?.settings).toEqual(
      expect.objectContaining({
        show_next_up: true,
      })
    );
  });
});

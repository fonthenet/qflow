import { describe, expect, it } from 'vitest';
import { buildStarterDeskRecords, buildStarterDisplayRecords, buildStarterOfficeRecord } from './starter-data';
import { getIndustryTemplateById } from './templates';

// Assertions below reflect the current shipped overlays (see vertical-overlays.ts).
// If you change an overlay, update the matching assertions here so drift stays visible.

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

    expect(record.operatingHours?.monday?.open).toBe('09:00');
    expect(record.settings.platform_template_id).toBe('public-service');
    expect(Array.isArray(record.settings.platform_service_areas)).toBe(true);
    expect((record.settings.platform_service_areas as unknown[]).length).toBeGreaterThanOrEqual(3);
  });

  it('seeds restaurant starter office with service areas', () => {
    const template = getIndustryTemplateById('restaurant-waitlist');
    const starterOffice = template.starterOffices[0]!;

    const record = buildStarterOfficeRecord({
      template,
      starterOffice,
      branchType: starterOffice.branchType,
      operatingModel: 'waitlist',
      officeName: 'Harbor Grill',
    });

    expect(record.settings.platform_template_id).toBe('restaurant-waitlist');
    expect(Array.isArray(record.settings.platform_service_areas)).toBe(true);
    expect((record.settings.platform_service_areas as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('maps starter desks to created departments and services', () => {
    const template = getIndustryTemplateById('clinic');
    const starterOffice = template.starterOffices[0]!;
    // Clinic overlay has a single `Consultations` department (code 'C') with
    // CONSULT/CONTROL/CERT services and two desks: reception + exam-room.
    const departmentIdsByCode = new Map([['C', 'dept-consult']]);
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
    expect(desks[0]?.desk.name).toBe('reception');
    expect(desks.find((entry) => entry.desk.name === 'exam-room')?.serviceIds).toEqual([
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

    // public-service overlay ships two displays: Écran Principal + Écran État Civil.
    expect(displays).toHaveLength(starterOffice.displayScreens.length);
    expect(displays[0]?.name).toBe(starterOffice.displayScreens[0]?.name);
    expect(displays[0]?.layout).toBe(starterOffice.displayScreens[0]?.layout ?? template.experienceProfile.display.defaultLayout);
  });
});

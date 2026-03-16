import { describe, expect, it } from 'vitest';
import {
  buildBookingCheckInPath,
  buildBookingPath,
  buildKioskPath,
  getOfficePublicSlug,
  matchesOfficePublicSlug,
} from './office-links';

describe('office public links', () => {
  const office = {
    name: 'Main Branch',
    settings: {
      platform_office_slug: 'main-branch-custom',
    },
  };

  it('prefers configured office slugs', () => {
    expect(getOfficePublicSlug(office)).toBe('main-branch-custom');
    expect(matchesOfficePublicSlug(office, 'main-branch-custom')).toBe(true);
  });

  it('builds public kiosk, booking, and check-in paths', () => {
    expect(buildKioskPath(office)).toBe('/kiosk/main-branch-custom');
    expect(
      buildBookingPath(office, {
        departmentId: 'dept-1',
        serviceId: 'svc-9',
      })
    ).toBe('/book/main-branch-custom?departmentId=dept-1&serviceId=svc-9');
    expect(buildBookingCheckInPath(office)).toBe('/book/main-branch-custom/checkin');
  });

  it('falls back to a slugified office name', () => {
    expect(buildBookingPath({ name: 'Clinic Chifa Main Location' })).toBe(
      '/book/clinic-chifa-main-location'
    );
  });
});

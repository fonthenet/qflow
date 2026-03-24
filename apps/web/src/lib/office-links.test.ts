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
    id: 'office-123',
    name: 'Main Branch',
    settings: {
      platform_office_slug: 'main-branch-custom',
    },
  };

  it('prefers configured office slugs and appends the office id when available', () => {
    expect(getOfficePublicSlug(office)).toBe('main-branch-custom--office-123');
    expect(matchesOfficePublicSlug(office, 'main-branch-custom')).toBe(true);
    expect(matchesOfficePublicSlug(office, 'main-branch-custom--office-123')).toBe(true);
  });

  it('builds public kiosk, booking, and check-in paths', () => {
    expect(buildKioskPath(office)).toBe('/kiosk/main-branch-custom--office-123');
    expect(
      buildBookingPath(office, {
        departmentId: 'dept-1',
        serviceId: 'svc-9',
      })
    ).toBe('/book/main-branch-custom--office-123?departmentId=dept-1&serviceId=svc-9');
    expect(buildBookingCheckInPath(office)).toBe('/book/main-branch-custom--office-123/checkin');
  });

  it('falls back to a slugified office name', () => {
    expect(buildBookingPath({ name: 'Clinic Chifa Main Location' })).toBe(
      '/book/clinic-chifa-main-location'
    );
  });
});

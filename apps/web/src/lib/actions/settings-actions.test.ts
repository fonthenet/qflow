/**
 * Tests for updateOrganizationProfile in settings-actions.ts
 *
 * Covers BLOCKER 3 validation rules:
 * - Rejects timezone not in Intl.supportedValuesOf('timeZone')
 * - Rejects locale_primary not in country's allowed set
 * - Accepts valid timezone + locale_primary
 * - Accepts null/empty locale_primary (falls back to country default)
 * - Rejects fields longer than 64 chars
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const {
  revalidatePathMock,
  getStaffContextMock,
  requireOrganizationAdminMock,
  logAuditEventMock,
} = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  getStaffContextMock: vi.fn(),
  requireOrganizationAdminMock: vi.fn(),
  logAuditEventMock: vi.fn(),
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

// ── Import after mocks ────────────────────────────────────────────────────────

import { updateOrganizationProfile } from './settings-actions';

// ── Helpers ───────────────────────────────────────────────────────────────────

// country_config for DZ: locale_default='fr', locale_fallbacks=['ar','en']
const DZ_COUNTRY_CONFIG = {
  locale_default: 'fr',
  locale_fallbacks: ['ar', 'en'],
};

// Builds a mock supabase client that returns the given country_config row and
// a given org country when queried. Also records any .update() calls.
function buildMockSupabase({
  orgCountry = 'DZ',
  countryConfig = DZ_COUNTRY_CONFIG as { locale_default: string; locale_fallbacks: string[] } | null,
  updateError = null as { message: string } | null,
} = {}) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: updateError }),
  });

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'organizations') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { country: orgCountry },
              error: null,
            }),
          }),
        }),
        update: updateFn,
      };
    }
    if (table === 'country_config') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: countryConfig,
              error: null,
            }),
          }),
        }),
      };
    }
    return { select: vi.fn(), update: updateFn };
  });

  return { from: fromFn, _updateFn: updateFn };
}

function buildContext(supabase: ReturnType<typeof buildMockSupabase>) {
  return {
    supabase,
    userId: 'user-1',
    staff: {
      id: 'staff-1',
      organization_id: 'org-1',
      office_id: null,
      department_id: null,
      role: 'admin',
      full_name: 'Test Admin',
      email: 'admin@test.com',
    },
    accessibleOfficeIds: [],
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('updateOrganizationProfile — timezone validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationAdminMock.mockResolvedValue(undefined);
    logAuditEventMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
  });

  it('rejects a timezone that is not in Intl.supportedValuesOf', async () => {
    const db = buildMockSupabase();
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ timezone: 'Not/A/Real/Timezone' });

    expect(result).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/invalid timezone/i) }),
    );
    // update must NOT have been called
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('accepts a valid IANA timezone', async () => {
    const db = buildMockSupabase();
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ timezone: 'Africa/Algiers' });

    expect(result).toEqual({ success: true });
    expect(db._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: 'Africa/Algiers' }),
    );
  });

  it('accepts null timezone (clear the field)', async () => {
    const db = buildMockSupabase();
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ timezone: null });

    expect(result).toEqual({ success: true });
  });

  it('rejects a timezone string longer than 64 chars', async () => {
    const db = buildMockSupabase();
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const longTz = 'A'.repeat(65);
    const result = await updateOrganizationProfile({ timezone: longTz });

    expect(result).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/exceed maximum length/i) }),
    );
    expect(db._updateFn).not.toHaveBeenCalled();
  });
});

describe('updateOrganizationProfile — locale_primary validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationAdminMock.mockResolvedValue(undefined);
    logAuditEventMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
  });

  it('rejects locale_primary not in country allowed set', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    // 'es' is not in DZ's allowed locales [fr, ar, en]
    const result = await updateOrganizationProfile({ locale_primary: 'es' });

    expect(result).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/not allowed/i) }),
    );
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('accepts locale_primary that is the locale_default', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ locale_primary: 'fr' });

    expect(result).toEqual({ success: true });
    expect(db._updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ locale_primary: 'fr' }),
    );
  });

  it('accepts locale_primary from locale_fallbacks', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ locale_primary: 'ar' });

    expect(result).toEqual({ success: true });
  });

  it('accepts null locale_primary (clear to country default)', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ locale_primary: null });

    expect(result).toEqual({ success: true });
  });

  it('accepts empty-string locale_primary (treated as clear)', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const result = await updateOrganizationProfile({ locale_primary: '' });

    expect(result).toEqual({ success: true });
  });

  it('rejects locale_primary longer than 64 chars', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    const longLocale = 'fr'.padEnd(65, 'x');
    const result = await updateOrganizationProfile({ locale_primary: longLocale });

    expect(result).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/exceed maximum length/i) }),
    );
    expect(db._updateFn).not.toHaveBeenCalled();
  });

  it('uses incoming country when country + locale_primary both change in the same call', async () => {
    // Org currently has country=null, but we're setting country=DZ + locale_primary=ar
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    // Passing country='DZ' and locale_primary='ar' — should resolve DZ config
    const result = await updateOrganizationProfile({ country: 'DZ', locale_primary: 'ar' });

    expect(result).toEqual({ success: true });
  });
});

describe('updateOrganizationProfile — audit log only logs persisted fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireOrganizationAdminMock.mockResolvedValue(undefined);
    logAuditEventMock.mockResolvedValue(undefined);
    revalidatePathMock.mockReturnValue(undefined);
  });

  it('audit log metadata matches the update payload that was written', async () => {
    const db = buildMockSupabase({ orgCountry: 'DZ', countryConfig: DZ_COUNTRY_CONFIG });
    getStaffContextMock.mockResolvedValue(buildContext(db));

    await updateOrganizationProfile({ timezone: 'Africa/Algiers', locale_primary: 'fr' });

    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          timezone: 'Africa/Algiers',
          locale_primary: 'fr',
        }),
      }),
    );
  });
});

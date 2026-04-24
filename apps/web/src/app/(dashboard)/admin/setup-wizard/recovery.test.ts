import { describe, expect, it } from 'vitest';
import { buildBrokenStateRecovery } from './recovery';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseConfirmedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform_template_state: 'template_confirmed',
    platform_template_id: 'clinic-standard',
    platform_template_version: '1.0.0',
    platform_vertical: 'healthcare',
    platform_operating_model: 'queue',
    platform_branch_type: 'main',
    platform_template_confirmed_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite 1: recovery must NOT fire when trial keys are absent
// ---------------------------------------------------------------------------
describe('buildBrokenStateRecovery — Station-created org (no trial keys)', () => {
  it('does NOT fire when officeCount is 0 but platform_trial_template_id is absent', () => {
    const settings = baseConfirmedSettings();
    // Deliberately no platform_trial_* keys — this is the Station path.

    const result = buildBrokenStateRecovery(
      settings,
      'My Clinic',
      'Africa/Algiers',
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(false);
    expect((result as any).reason).toMatch(/platform_trial_template_id is absent/);
  });

  it('does NOT fire when platform_trial_template_id is an empty string', () => {
    const settings = baseConfirmedSettings({ platform_trial_template_id: '' });

    const result = buildBrokenStateRecovery(
      settings,
      'My Clinic',
      null,
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(false);
  });

  it('does NOT fire when platform_trial_template_id is null', () => {
    const settings = baseConfirmedSettings({ platform_trial_template_id: null });

    const result = buildBrokenStateRecovery(
      settings,
      'My Clinic',
      null,
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(false);
  });

  it('does NOT fire when platform_trial_template_id is a non-string truthy value', () => {
    const settings = baseConfirmedSettings({ platform_trial_template_id: 42 });

    const result = buildBrokenStateRecovery(
      settings,
      'My Clinic',
      null,
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 2: recovery MUST NOT fire when officeCount > 0 (healthy org)
// ---------------------------------------------------------------------------
describe('buildBrokenStateRecovery — healthy confirmed org with offices', () => {
  it('does NOT fire when officeCount > 0 even if trial keys exist', () => {
    const settings = baseConfirmedSettings({
      platform_trial_template_id: 'restaurant-waitlist',
    });

    const result = buildBrokenStateRecovery(
      settings,
      'Healthy Org',
      'UTC',
      'template_confirmed',
      1,
    );

    expect(result.shouldRecover).toBe(false);
  });

  it('does NOT fire when lifecycle state is not template_confirmed', () => {
    const settings = {
      platform_template_state: 'template_trial_state',
      platform_trial_template_id: 'restaurant-waitlist',
    };

    const result = buildBrokenStateRecovery(
      settings,
      'Healthy Org',
      'UTC',
      'template_trial_state',
      0,
    );

    expect(result.shouldRecover).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: recovery DOES fire when both conditions are met
// ---------------------------------------------------------------------------
describe('buildBrokenStateRecovery — portal preview zombie state', () => {
  it('fires when officeCount is 0 AND platform_trial_template_id is a truthy string', () => {
    // Use a settings object without any permanent template keys so the trial key
    // is the sole source of truth (simulates a mid-confirm zombie where the
    // permanent keys were never fully written).
    const settings: Record<string, unknown> = {
      platform_template_state: 'template_confirmed',
      platform_template_confirmed_at: '2026-01-01T00:00:00Z',
      platform_trial_template_id: 'restaurant-waitlist',
      platform_trial_template_version: '2.0.0',
      platform_trial_vertical: 'food-beverage',
      platform_trial_operating_model: 'waitlist',
      platform_trial_branch_type: 'standalone',
      platform_trial_office_name: 'My Restaurant',
      platform_trial_timezone: 'Europe/Paris',
    };

    const result = buildBrokenStateRecovery(
      settings,
      'My Restaurant',
      'Europe/Paris',
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return; // type narrowing

    const { fixedSettings } = result;
    expect(fixedSettings.platform_template_state).toBe('template_trial_state');
    // confirmed marker must be cleared
    expect(fixedSettings.platform_template_confirmed_at).toBeUndefined();
    // trial key restored (falls through to the trial key itself since no permanent key)
    expect(fixedSettings.platform_trial_template_id).toBe('restaurant-waitlist');
    expect(fixedSettings.platform_trial_seed_priorities).toBe(true);
  });

  it('prefers permanent keys over trial keys when both exist', () => {
    const settings = baseConfirmedSettings({
      platform_template_id: 'clinic-standard',       // permanent (post-confirm)
      platform_trial_template_id: 'restaurant-waitlist', // leftover trial (stale)
    });

    const result = buildBrokenStateRecovery(
      settings,
      'My Org',
      null,
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return;

    // Permanent key wins
    expect(result.fixedSettings.platform_trial_template_id).toBe('clinic-standard');
  });

  it('falls back to org name when platform_trial_office_name is absent', () => {
    const settings = baseConfirmedSettings({
      platform_trial_template_id: 'salon-walk-in',
    });

    const result = buildBrokenStateRecovery(
      settings,
      'Acme Salon',
      'Africa/Algiers',
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return;

    expect(result.fixedSettings.platform_trial_office_name).toBe('Acme Salon');
  });

  it('falls back to org timezone when platform_trial_timezone is absent', () => {
    const settings = baseConfirmedSettings({
      platform_trial_template_id: 'salon-walk-in',
    });

    const result = buildBrokenStateRecovery(
      settings,
      'Acme Salon',
      'Africa/Algiers',
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return;

    expect(result.fixedSettings.platform_trial_timezone).toBe('Africa/Algiers');
  });

  it('falls back to UTC when neither trial timezone nor org timezone exist', () => {
    const settings = baseConfirmedSettings({
      platform_trial_template_id: 'salon-walk-in',
    });

    const result = buildBrokenStateRecovery(
      settings,
      'Acme Salon',
      null,   // no org timezone
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return;

    expect(result.fixedSettings.platform_trial_timezone).toBe('UTC');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: belt-and-suspenders — no undefined values in fixedSettings
// ---------------------------------------------------------------------------
describe('buildBrokenStateRecovery — no undefined written into settings', () => {
  it('writes null instead of undefined for fields that cannot be resolved', () => {
    // Minimal settings: only the required trial key; everything else absent.
    const settings: Record<string, unknown> = {
      platform_template_state: 'template_confirmed',
      platform_trial_template_id: 'bank-queue',
      // No permanent keys, no other trial keys
    };

    const result = buildBrokenStateRecovery(
      settings,
      'National Bank',
      null,
      'template_confirmed',
      0,
    );

    expect(result.shouldRecover).toBe(true);
    if (!result.shouldRecover) return;

    const { fixedSettings } = result;

    // None of the values should be undefined
    for (const [key, value] of Object.entries(fixedSettings)) {
      expect(
        value,
        `Expected key "${key}" to not be undefined`,
      ).not.toBeUndefined();
    }

    // Specifically verify fields that had no source resolve to null
    expect(fixedSettings.platform_trial_template_version).toBeNull();
    expect(fixedSettings.platform_trial_vertical).toBeNull();
    expect(fixedSettings.platform_trial_operating_model).toBeNull();
    expect(fixedSettings.platform_trial_branch_type).toBeNull();
    // Office name falls back to org name, so not null
    expect(fixedSettings.platform_trial_office_name).toBe('National Bank');
    // Timezone falls back to 'UTC', so not null
    expect(fixedSettings.platform_trial_timezone).toBe('UTC');
  });
});

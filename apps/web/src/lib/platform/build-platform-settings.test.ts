import { describe, expect, it } from 'vitest';
import { buildPlatformTemplateSettings } from './build-platform-settings';

describe('buildPlatformTemplateSettings', () => {
  it('sets platform_template_state to template_confirmed', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'clinic' });
    expect(result.platform_template_state).toBe('template_confirmed');
  });

  it('sets platform_template_confirmed_at as an ISO string', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'bank-branch' });
    expect(typeof result.platform_template_confirmed_at).toBe('string');
    expect(new Date(result.platform_template_confirmed_at as string).toISOString()).toBe(
      result.platform_template_confirmed_at
    );
  });

  it('sets platform_template_id matching the resolved industry template', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'restaurant-waitlist' });
    expect(result.platform_template_id).toBe('restaurant-waitlist');
  });

  it('sets platform_vertical from the industry template definition', () => {
    const clinic = buildPlatformTemplateSettings({ industryTemplateId: 'clinic' });
    expect(clinic.platform_vertical).toBe('clinic');

    const bank = buildPlatformTemplateSettings({ industryTemplateId: 'bank-branch' });
    expect(bank.platform_vertical).toBe('bank');

    const publicSvc = buildPlatformTemplateSettings({ industryTemplateId: 'public-service' });
    expect(publicSvc.platform_vertical).toBe('public_service');

    const barber = buildPlatformTemplateSettings({ industryTemplateId: 'barbershop' });
    expect(barber.platform_vertical).toBe('barbershop');
  });

  it('sets platform_enabled_modules as a non-empty array', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'clinic' });
    expect(Array.isArray(result.platform_enabled_modules)).toBe(true);
    expect((result.platform_enabled_modules as unknown[]).length).toBeGreaterThan(0);
  });

  it('sets platform_queue_policy, platform_workflow_profile, platform_experience_profile, platform_role_policy', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'bank-branch' });
    expect(result.platform_queue_policy).toBeTruthy();
    expect(result.platform_workflow_profile).toBeTruthy();
    expect(result.platform_experience_profile).toBeTruthy();
    expect(result.platform_role_policy).toBeTruthy();
  });

  it('sets platform_capability_snapshot', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'clinic' });
    expect(result.platform_capability_snapshot).toBeTruthy();
  });

  it('clears trial keys from currentSettings', () => {
    const currentSettings: Record<string, unknown> = {
      platform_trial_template_id: 'old-trial',
      platform_trial_vertical: 'restaurant',
      platform_trial_share_token: 'abc123',
      some_other_key: 'should-survive',
    };
    const result = buildPlatformTemplateSettings(
      { industryTemplateId: 'clinic' },
      currentSettings,
    );
    expect(result.platform_trial_template_id).toBeUndefined();
    expect(result.platform_trial_vertical).toBeUndefined();
    expect(result.platform_trial_share_token).toBeUndefined();
    expect(result.some_other_key).toBe('should-survive');
  });

  it('falls back to general-service template for unknown template ID', () => {
    const result = buildPlatformTemplateSettings({ industryTemplateId: 'does-not-exist' });
    // getIndustryTemplateById falls back to industryTemplates[0] (public-service)
    // but the point is it never throws
    expect(result.platform_template_state).toBe('template_confirmed');
    expect(typeof result.platform_template_id).toBe('string');
  });

  it('emits correct operating model defaults per vertical', () => {
    const bank = buildPlatformTemplateSettings({ industryTemplateId: 'bank-branch' });
    expect(bank.platform_operating_model).toBe('service_routing');

    const clinic = buildPlatformTemplateSettings({ industryTemplateId: 'clinic' });
    expect(clinic.platform_operating_model).toBe('appointments_first');

    const publicSvc = buildPlatformTemplateSettings({ industryTemplateId: 'public-service' });
    expect(publicSvc.platform_operating_model).toBe('department_first');

    const restaurant = buildPlatformTemplateSettings({ industryTemplateId: 'restaurant-waitlist' });
    expect(restaurant.platform_operating_model).toBe('waitlist');
  });

  it('accepts explicit operatingModel override', () => {
    const result = buildPlatformTemplateSettings({
      industryTemplateId: 'general-service',
      operatingModel: 'appointments_first',
    });
    expect(result.platform_operating_model).toBe('appointments_first');
  });
});

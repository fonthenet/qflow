import { describe, expect, it } from 'vitest';
import { resolveIndustryTemplateId, resolveVerticalFromTemplate } from './template-mapping';

describe('resolveIndustryTemplateId', () => {
  it('resolves subtype-level overrides first', () => {
    // medical subtypes all map to clinic
    expect(resolveIndustryTemplateId('medical', 'medical-gp')).toBe('clinic');
    expect(resolveIndustryTemplateId('medical', 'medical-dental')).toBe('clinic');
    expect(resolveIndustryTemplateId('medical', 'medical-pharmacy')).toBe('clinic');
  });

  it('resolves restaurant subtypes to restaurant-waitlist', () => {
    expect(resolveIndustryTemplateId('restaurant', 'restaurant-full')).toBe('restaurant-waitlist');
    expect(resolveIndustryTemplateId('restaurant', 'restaurant-cafe')).toBe('restaurant-waitlist');
  });

  it('resolves bank subtypes to bank-branch', () => {
    expect(resolveIndustryTemplateId('bank', 'bank-full')).toBe('bank-branch');
    expect(resolveIndustryTemplateId('bank', 'bank-small')).toBe('bank-branch');
  });

  it('resolves personal-care subtypes correctly', () => {
    expect(resolveIndustryTemplateId('retail', 'retail-salon')).toBe('barbershop');
    expect(resolveIndustryTemplateId('retail', 'retail-barber')).toBe('barbershop');
    expect(resolveIndustryTemplateId('retail', 'retail-store')).toBe('general-service');
  });

  it('resolves public subtypes to public-service', () => {
    expect(resolveIndustryTemplateId('public', 'public-docs')).toBe('public-service');
    expect(resolveIndustryTemplateId('public', 'public-municipal')).toBe('public-service');
  });

  it('falls back to template-level mapping when subtype is null', () => {
    expect(resolveIndustryTemplateId('restaurant', null)).toBe('restaurant-waitlist');
    expect(resolveIndustryTemplateId('medical', null)).toBe('clinic');
    expect(resolveIndustryTemplateId('bank', null)).toBe('bank-branch');
    expect(resolveIndustryTemplateId('public', null)).toBe('public-service');
    expect(resolveIndustryTemplateId('retail', null)).toBe('general-service');
  });

  it('falls back to general-service for unknown inputs', () => {
    expect(resolveIndustryTemplateId(null, null)).toBe('general-service');
    expect(resolveIndustryTemplateId(undefined, undefined)).toBe('general-service');
    expect(resolveIndustryTemplateId('unknown-template', 'unknown-subtype')).toBe('general-service');
  });

  it('template-level mapping without subtype', () => {
    expect(resolveIndustryTemplateId('restaurant')).toBe('restaurant-waitlist');
    expect(resolveIndustryTemplateId('medical')).toBe('clinic');
  });
});

describe('resolveVerticalFromTemplate', () => {
  it('resolves subtype-level vertical overrides first', () => {
    // Values must match the slug column in the verticals FK table (hyphens, not underscores)
    expect(resolveVerticalFromTemplate('retail', 'retail-salon')).toBe('salon');
    expect(resolveVerticalFromTemplate('retail', 'retail-barber')).toBe('barber');
    expect(resolveVerticalFromTemplate('retail', 'retail-store')).toBe('retail');
    expect(resolveVerticalFromTemplate('medical', 'medical-gp')).toBe('clinic');
    expect(resolveVerticalFromTemplate('public', 'public-docs')).toBe('public-service');
  });

  it('falls back to template-level vertical when subtype is null', () => {
    expect(resolveVerticalFromTemplate('restaurant', null)).toBe('restaurant');
    expect(resolveVerticalFromTemplate('medical', null)).toBe('clinic');
    expect(resolveVerticalFromTemplate('bank', null)).toBe('bank');
    expect(resolveVerticalFromTemplate('retail', null)).toBe('retail');
    expect(resolveVerticalFromTemplate('public', null)).toBe('public-service');
  });

  it('returns null for unknown inputs', () => {
    expect(resolveVerticalFromTemplate(null, null)).toBeNull();
    expect(resolveVerticalFromTemplate(undefined, undefined)).toBeNull();
    expect(resolveVerticalFromTemplate('unknown', 'unknown-sub')).toBeNull();
  });
});

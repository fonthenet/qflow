import { expect, test } from '@playwright/test';
import { hasE2EAuth, loginAsAdmin } from './helpers';

test.describe('Admin Browser Smoke', () => {
  test.skip(!hasE2EAuth, 'Set QUEUEFLOW_E2E_EMAIL and QUEUEFLOW_E2E_PASSWORD to run browser E2E tests.');

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('loads platform onboarding and updates the review panel', async ({ page }) => {
    await page.goto('/admin/onboarding');

    await expect(page.getByRole('heading', { name: 'Platform Onboarding' })).toBeVisible();
    await page.getByLabel('Industry Template').selectOption('restaurant-waitlist');

    await expect(page.getByText('Set up a guest waitlist')).toBeVisible();
    await expect(page.getByText(/Table for 1-2/)).toBeVisible();
    await expect(page.getByLabel('Create starter display screen')).not.toBeChecked();
    await expect(page.getByLabel('Seed starter priorities')).not.toBeChecked();
  });

  test('loads template governance for an admin user', async ({ page }) => {
    await page.goto('/admin/template-governance');

    await expect(page.getByRole('heading', { name: 'Template Governance' })).toBeVisible();
    await expect(page.getByText('Version Status')).toBeVisible();
    await expect(page.getByText('Organization Upgrade Plan')).toBeVisible();
  });

  test('loads analytics and applies read-only filters', async ({ page }) => {
    await page.goto('/admin/analytics');

    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
    await page.getByLabel('Date Range').selectOption('last7');

    const officeFilter = page.getByLabel('Office Filter');
    const officeCount = await officeFilter.locator('option').count();
    if (officeCount > 1) {
      const firstOfficeValue = await officeFilter.locator('option').nth(1).getAttribute('value');
      if (firstOfficeValue) {
        await officeFilter.selectOption(firstOfficeValue);
      }
    }

    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.getByLabel('Date Range')).toHaveValue('last7');
    await expect(page.getByText('Template Health')).toBeVisible();
    await expect(page.getByText('Vertical KPIs')).toBeVisible();
  });
});

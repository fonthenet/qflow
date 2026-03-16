import { expect, test } from '@playwright/test';
import { allowMutations, hasE2EAuth, loginAsAdmin, uniqueE2EName } from './helpers';

test.describe('Admin Browser Mutations', () => {
  test.skip(
    !hasE2EAuth || !allowMutations,
    'Set QUEUEFLOW_E2E_EMAIL, QUEUEFLOW_E2E_PASSWORD, and QUEUEFLOW_E2E_ALLOW_MUTATIONS=true to run mutating E2E tests.'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('can apply an industry template from onboarding', async ({ page }) => {
    await page.goto('/admin/onboarding');

    await expect(page.getByRole('heading', { name: 'Platform Onboarding' })).toBeVisible();
    await page.getByLabel('Industry Template').selectOption('restaurant-waitlist');
    await page.getByLabel('Starter Office Name').fill(uniqueE2EName('E2E Waitlist Branch'));
    await page.getByRole('button', { name: 'Apply Template' }).click();

    await expect(page.getByText(/Template applied\. Created \d+ departments and \d+ services\./)).toBeVisible();
  });

  test('can apply an organization upgrade and roll it out to offices', async ({ page }) => {
    await page.goto('/admin/template-governance');

    await expect(page.getByRole('heading', { name: 'Template Governance' })).toBeVisible();
    await page.getByRole('button', { name: /Apply Organization Upgrade/i }).click();
    await expect(page.getByText(/Template governance applied\. Organization drift is now \d+\./)).toBeVisible();

    const officeCheckboxes = page.locator('input[aria-label^="Select office "]');
    const officeCount = await officeCheckboxes.count();
    test.skip(officeCount === 0, 'No offices are available to roll out in the configured test tenant.');

    await officeCheckboxes.first().check();
    await page.getByRole('button', { name: /Roll Out To Selected Offices/i }).click();
    await expect(page.getByText(/Rolled template changes to \d+ office/)).toBeVisible();
  });
});

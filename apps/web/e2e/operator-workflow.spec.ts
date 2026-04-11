import { expect, test, type Page } from '@playwright/test';
import { hasE2EAuth, loginAsAdmin } from './helpers';

async function ensureDeskAssigned(page: Page) {
  await page.goto('/desk');

  const selectorHeading = page.getByRole('heading', { name: 'Select Your Desk' });
  if (await selectorHeading.isVisible()) {
    await page.locator('button[aria-label^="Select desk "]').first().click();
    await page.getByRole('button', { name: 'Start Operating' }).click();
  }
}

test.describe('Operator Workflow', () => {
  test.skip(
    !hasE2EAuth,
    'Set QUEUEFLOW_E2E_EMAIL and QUEUEFLOW_E2E_PASSWORD to run browser E2E tests.'
  );

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('admin can access the offices list', async ({ page }) => {
    // loginAsAdmin already navigates to /admin/offices
    await expect(page).toHaveURL(/\/admin\/offices$/);
    await expect(page.getByRole('heading', { name: /Offices/i })).toBeVisible();
  });

  test('admin can navigate to the calendar view', async ({ page }) => {
    await page.goto('/admin/calendar');

    // The calendar view should load with at least the page heading or calendar structure
    await expect(page.locator('[class*="calendar"], h1, h2').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('admin can navigate to the bookings view', async ({ page }) => {
    await page.goto('/admin/bookings');

    // Bookings page should load
    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
  });

  test('admin can navigate to the overview dashboard', async ({ page }) => {
    await page.goto('/admin/overview');

    await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
  });

  test('operator desk page loads and shows desk selector or desk panel', async ({ page }) => {
    await page.goto('/desk');

    // Should show either the desk selector (if no desk assigned) or the desk panel
    const deskSelector = page.getByRole('heading', { name: 'Select Your Desk' });
    const deskPanel = page.getByRole('button', { name: /Call Next/ });
    const visitComplete = page.getByRole('heading', { name: 'Visit Complete' });
    const startServing = page.getByRole('button', { name: 'Start Serving' });
    const markServed = page.getByRole('button', { name: 'Mark Served' });
    const noOffice = page.getByText('No Office Assigned');

    // At least one of these states should be visible
    await expect(
      deskSelector
        .or(deskPanel)
        .or(visitComplete)
        .or(startServing)
        .or(markServed)
        .or(noOffice)
    ).toBeVisible({ timeout: 15_000 });
  });

  test('operator can reach the desk panel after selecting a desk', async ({ page }) => {
    await ensureDeskAssigned(page);

    // After desk assignment, the desk panel should be visible with operator controls
    const callNext = page.getByRole('button', { name: /Call Next/ });
    const startServing = page.getByRole('button', { name: 'Start Serving' });
    const markServed = page.getByRole('button', { name: 'Mark Served' });
    const visitComplete = page.getByRole('heading', { name: 'Visit Complete' });

    // One of the desk states should be visible
    await expect(
      callNext.or(startServing).or(markServed).or(visitComplete)
    ).toBeVisible({ timeout: 15_000 });
  });
});

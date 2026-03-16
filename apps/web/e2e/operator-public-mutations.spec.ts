import { expect, test, type Page } from '@playwright/test';
import {
  allowMutations,
  getNextBookableDate,
  getOfficeSlug,
  hasE2EAuth,
  loginAsAdmin,
} from './helpers';

const officeSlug = getOfficeSlug();

async function ensureDeskAssigned(page: Page, departmentName: string) {
  await page.goto('/desk');

  const selectorHeading = page.getByRole('heading', { name: 'Select Your Desk' });
  if (await selectorHeading.isVisible()) {
    const matchingDesk = page.locator(`button[aria-label*="in ${departmentName}"]`).first();
    if (await matchingDesk.isVisible()) {
      await matchingDesk.click();
    } else {
      await page.locator('button[aria-label^="Select desk "]').first().click();
    }
    await page.getByRole('button', { name: 'Start Operating' }).click();
  }
}

async function settleDeskToIdle(page: Page) {
  const markServed = page.getByRole('button', { name: 'Mark Served' });
  if (await markServed.isVisible()) {
    await markServed.click();
    await expect(page.getByText(/Visit Complete|Customer marked as served/)).toBeVisible();
    return;
  }

  const startServing = page.getByRole('button', { name: 'Start Serving' });
  if (await startServing.isVisible()) {
    await startServing.click();
    await expect(markServed).toBeVisible();
    await markServed.click();
    await expect(page.getByText(/Visit Complete|Customer marked as served/)).toBeVisible();
  }
}

test.describe('Operator + Public Browser Mutations', () => {
  test.skip(
    !hasE2EAuth || !allowMutations,
    'Set QUEUEFLOW_E2E_EMAIL, QUEUEFLOW_E2E_PASSWORD, and QUEUEFLOW_E2E_ALLOW_MUTATIONS=true to run mutating E2E tests.'
  );

  test('can create a kiosk ticket and complete it at the desk', async ({ page }) => {
    await page.goto(`/kiosk/${officeSlug}`);

    await expect(page.getByText('Please select a department')).toBeVisible();
    const firstDepartmentButton = page.locator('button').first();
    const selectedDepartmentName =
      ((await firstDepartmentButton.locator('h3').textContent()) ?? '').trim();
    await firstDepartmentButton.click();
    await expect(page.getByText('Select a service')).toBeVisible();
    await page.locator('button').first().click();

    const normalPriority = page.getByRole('button', { name: 'Normal' });
    if (await normalPriority.isVisible()) {
      await normalPriority.click();
    }

    await expect(page.getByText('Your Ticket')).toBeVisible();

    await loginAsAdmin(page);
    await ensureDeskAssigned(page, selectedDepartmentName);
    await settleDeskToIdle(page);

    const callNext = page.getByRole('button', { name: /Call Next/ });
    await expect(callNext).toBeEnabled();
    await callNext.click();

    await expect(page.getByRole('button', { name: 'Start Serving' })).toBeVisible();
    await page.getByRole('button', { name: 'Start Serving' }).click();

    await expect(page.getByRole('button', { name: 'Mark Served' })).toBeVisible();
    await page.getByRole('button', { name: 'Mark Served' }).click();

    await expect(page.getByRole('heading', { name: 'Visit Complete' })).toBeVisible();
  });

  test('can submit a public appointment booking', async ({ page }) => {
    await page.goto(`/book/${officeSlug}`);

    await expect(page.getByText('Book an Appointment')).toBeVisible();
    await page.locator('button').first().click();

    await expect(page.getByText('Select a service')).toBeVisible();
    await page.locator('button').first().click();

    await page.locator('input[type="date"]').fill(getNextBookableDate());
    await page.getByRole('button', { name: 'Continue' }).click();

    const firstSlot = page.locator('button').filter({ hasText: /AM|PM/ }).first();
    await expect(firstSlot).toBeVisible();
    await firstSlot.click();

    await expect(page.getByText('Your Information')).toBeVisible();
    await page.getByPlaceholder('Enter your full name').fill('QueueFlow E2E Customer');
    await page.getByPlaceholder('Enter your phone number').fill('5550001234');
    await page.getByPlaceholder('Enter your email address').fill('customer+e2e@queueflow.local');
    await page.getByRole('button', { name: 'Review Appointment' }).click();

    await expect(page.getByText('Confirm Appointment')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Booking' }).click();

    await expect(page.getByText('Appointment Confirmed!')).toBeVisible();
  });
});

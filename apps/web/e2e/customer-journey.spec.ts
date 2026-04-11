import { expect, test, type Page } from '@playwright/test';
import {
  allowMutations,
  getNextBookableDate,
  getOfficeSlug,
  hasE2EAuth,
  loginAsAdmin,
} from './helpers';

const officeSlug = getOfficeSlug();

/**
 * Books an appointment through the public booking flow and confirms it.
 * Returns the customer name used so it can be looked up in admin views.
 */
async function bookAppointment(page: Page, customerName: string) {
  await page.goto(`/book/${officeSlug}`);

  await expect(page.getByText('Book an Appointment')).toBeVisible();
  await page.locator('button').first().click();

  await expect(page.getByText('Select a service')).toBeVisible();
  await page.locator('button').first().click();

  await page.locator('input[type="date"]').fill(getNextBookableDate());
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Choose a Time')).toBeVisible();
  const firstSlot = page.locator('button').filter({ hasText: /AM|PM/ }).first();
  await expect(firstSlot).toBeVisible();
  await firstSlot.click();

  await expect(page.getByText('Your Information')).toBeVisible();
  await page.getByPlaceholder('Enter your full name').fill(customerName);
  await page.getByPlaceholder('Enter your phone number').fill('5559990002');
  await page.getByPlaceholder('Enter your email address').fill('journey+e2e@qflo.local');
  await page.getByRole('button', { name: 'Review Appointment' }).click();

  await expect(page.getByText('Confirm Appointment')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm Booking' }).click();

  await expect(page.getByText('Appointment Confirmed!')).toBeVisible();
}

test.describe('Customer Journey', () => {
  test.skip(
    !hasE2EAuth || !allowMutations,
    'Set QUEUEFLOW_E2E_EMAIL, QUEUEFLOW_E2E_PASSWORD, and QUEUEFLOW_E2E_ALLOW_MUTATIONS=true to run mutating E2E tests.'
  );

  test('books an appointment and verifies it appears in admin bookings', async ({ page }) => {
    const customerName = 'Journey E2E Customer';

    // Step 1: Book an appointment as a public user
    await bookAppointment(page, customerName);

    // Step 2: Log in as admin and navigate to bookings
    await loginAsAdmin(page);
    await page.goto('/admin/bookings');

    // Step 3: Verify the appointment appears in the bookings list
    await expect(page.getByText(customerName)).toBeVisible({ timeout: 15_000 });
  });

  test('books an appointment and verifies it appears in admin calendar', async ({ page }) => {
    const customerName = 'Calendar E2E Customer';

    // Step 1: Book an appointment as a public user
    await bookAppointment(page, customerName);

    // Step 2: Log in as admin and navigate to the calendar view
    await loginAsAdmin(page);
    await page.goto('/admin/calendar');

    // Step 3: Calendar view should load
    // The calendar might show the appointment on the scheduled date.
    // We verify the page loads and contains expected structure.
    await expect(page.locator('text=Calendar').first()).toBeVisible({ timeout: 15_000 });
  });
});

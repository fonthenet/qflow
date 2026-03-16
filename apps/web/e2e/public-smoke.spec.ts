import { expect, test } from '@playwright/test';
import { getDisplayPath, getNextBookableDate, getOfficeSlug } from './helpers';

const officeSlug = getOfficeSlug();
const displayPath = getDisplayPath();

test.describe('Public Flow Smoke', () => {
  test('loads kiosk and reaches the service or priority flow', async ({ page }) => {
    await page.goto(`/kiosk/${officeSlug}`);

    await expect(page.getByText('Please select a department')).toBeVisible();
    await page.locator('button').first().click();

    await expect(page.getByText('Select a service')).toBeVisible();
    await page.locator('button').first().click();

    const priorityHeading = page.getByRole('heading', { name: 'Select Priority' });
    const ticketHeading = page.getByText('Your Ticket');
    const reachedPriority = await priorityHeading.isVisible();

    if (reachedPriority) {
      await expect(priorityHeading).toBeVisible();
    } else {
      await expect(ticketHeading).toBeVisible();
    }
  });

  test('loads booking and shows available time slots', async ({ page }) => {
    await page.goto(`/book/${officeSlug}`);

    await expect(page.getByText('Book an Appointment')).toBeVisible();
    await page.locator('button').first().click();

    await expect(page.getByText('Select a service')).toBeVisible();
    await page.locator('button').first().click();

    await page.locator('input[type="date"]').fill(getNextBookableDate());
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Choose a Time')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /AM|PM/ }).first()).toBeVisible();
  });

  test.skip(!displayPath, 'Run the E2E seed command first so a display token is available.');

  test('loads the public display board', async ({ page }) => {
    await page.goto(displayPath!);

    await expect(page.getByText('Now Serving')).toBeVisible();
    await expect(page.getByText('Queue Status')).toBeVisible();
  });
});

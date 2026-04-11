import { expect, test } from '@playwright/test';
import { getNextBookableDate, getOfficeSlug } from './helpers';

const officeSlug = getOfficeSlug();

test.describe('Public Booking Flow', () => {
  test('loads the booking page and shows the department selector', async ({ page }) => {
    await page.goto(`/book/${officeSlug}`);

    await expect(page.getByText('Book an Appointment')).toBeVisible();
    // At least one department button should be visible
    await expect(page.locator('button').first()).toBeVisible();
  });

  test('navigates through department and service selection', async ({ page }) => {
    await page.goto(`/book/${officeSlug}`);

    await expect(page.getByText('Book an Appointment')).toBeVisible();

    // Select first department
    await page.locator('button').first().click();
    await expect(page.getByText('Select a service')).toBeVisible();

    // Select first service
    await page.locator('button').first().click();

    // Should now show date picker
    await expect(page.locator('input[type="date"]')).toBeVisible();
  });

  test('selects a date and shows available time slots', async ({ page }) => {
    await page.goto(`/book/${officeSlug}`);

    await expect(page.getByText('Book an Appointment')).toBeVisible();
    await page.locator('button').first().click();

    await expect(page.getByText('Select a service')).toBeVisible();
    await page.locator('button').first().click();

    // Fill in a bookable date (next non-Sunday weekday)
    await page.locator('input[type="date"]').fill(getNextBookableDate());
    await page.getByRole('button', { name: 'Continue' }).click();

    // Time slot selection should appear
    await expect(page.getByText('Choose a Time')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /AM|PM/ }).first()).toBeVisible();
  });

  test('selects a time slot and reaches the customer info form', async ({ page }) => {
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

    // Should reach the customer information form
    await expect(page.getByText('Your Information')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your full name')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your phone number')).toBeVisible();
  });

  test('fills customer details and reaches the review step', async ({ page }) => {
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
    await page.getByPlaceholder('Enter your full name').fill('Booking Flow E2E');
    await page.getByPlaceholder('Enter your phone number').fill('5559990001');
    await page.getByPlaceholder('Enter your email address').fill('booking-flow+e2e@qflo.local');
    await page.getByRole('button', { name: 'Review Appointment' }).click();

    // Should reach the confirmation review step
    await expect(page.getByText('Confirm Appointment')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm Booking' })).toBeVisible();
  });
});

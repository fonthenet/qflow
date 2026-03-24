import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const hasE2EAuth =
  Boolean(process.env.QUEUEFLOW_E2E_EMAIL) && Boolean(process.env.QUEUEFLOW_E2E_PASSWORD);
export const allowMutations = process.env.QUEUEFLOW_E2E_ALLOW_MUTATIONS === 'true';

type E2EState = {
  officeName?: string;
  officeSlug?: string;
  displayScreens?: Array<{
    id: string;
    name: string;
    screenToken: string;
  }>;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function loadE2EState(): E2EState | null {
  const stateFile = resolve(process.cwd(), '.e2e-state.json');
  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')) as E2EState;
  } catch {
    return null;
  }
}

export const e2eState = loadE2EState();

export async function loginAsAdmin(page: Page) {
  if (!hasE2EAuth) {
    throw new Error(
      'Missing QUEUEFLOW_E2E_EMAIL or QUEUEFLOW_E2E_PASSWORD. Provide a dedicated admin test account.'
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.QUEUEFLOW_E2E_EMAIL!);
  await page.getByLabel('Password').fill(process.env.QUEUEFLOW_E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/admin\/offices$/);
}

export function uniqueE2EName(prefix: string) {
  const token = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${prefix} ${token}`;
}

export function getOfficeSlug() {
  return (
    process.env.QUEUEFLOW_E2E_OFFICE_SLUG ??
    e2eState?.officeSlug ??
    slugify(process.env.QUEUEFLOW_E2E_OFFICE_NAME ?? 'E2E Main Branch')
  );
}

export function getDisplayPath() {
  const screenToken = process.env.QUEUEFLOW_E2E_DISPLAY_TOKEN ?? e2eState?.displayScreens?.[0]?.screenToken;
  return screenToken ? `/d/${screenToken}` : null;
}

function toLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getNextBookableDate(from = new Date()) {
  const candidate = new Date(from);
  candidate.setDate(candidate.getDate() + 1);

  while (candidate.getDay() === 0) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return toLocalDateInput(candidate);
}

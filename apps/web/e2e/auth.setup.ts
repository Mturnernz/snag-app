import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SUPERVISOR_STATE } from './auth-state';

// Signs in once per run and saves the session for every authenticated spec to
// reuse.
//
// Before this, each portal spec logged in from scratch in a beforeEach. At
// three browser projects that was ~40 sign-ins a run, which Supabase Auth rate
// -limits — and the failure is invisible, because `loginAction` maps every
// signInWithPassword error to "Incorrect email or password." The symptom was a
// test partway through the run finding itself back on /login for no reason
// anything on the page could explain.
//
// One sign-in per run also makes the suite meaningfully faster: a login is a
// server action plus two Supabase round trips, repeated for every test.

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

setup('sign in as a supervisor', async ({ page }) => {
  setup.skip(!EMAIL || !PASSWORD, 'set E2E_EMAIL and E2E_PASSWORD to run authenticated specs');
  setup.setTimeout(90_000);

  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.getByRole('button', { name: /log in/i }).click();

  // Signing in is a server action plus a Supabase round trip, so it needs more
  // than the default expect timeout on a loaded machine.
  await expect(page, 'login should land on the dashboard').toHaveURL(/\/dashboard/, {
    timeout: 60_000,
  });

  fs.mkdirSync(path.dirname(SUPERVISOR_STATE), { recursive: true });
  await page.context().storageState({ path: SUPERVISOR_STATE });
});

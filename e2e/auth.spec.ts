import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * The account flows — sign in and out, a failed sign-in, password reset, and
 * deleting an account — driven through the browser. The sign-up flow itself is
 * emailed-code verified and a test can't read that inbox, so accounts are made
 * through the API, as in flows.spec.ts.
 *
 * Nothing here needs a real email: with no RESEND_API_KEY the mailer only logs
 * the reset link, so the reset token is read back out of `verifications`, where
 * better-auth stores it as `reset-password:<token>`.
 *
 * Each test removes the account it made, so the database is left as it was.
 */

const run = Date.now().toString(36);
const PASSWORD = 'e2e-password-long-enough';
const NEW_PASSWORD = 'e2e-a-different-password';

if (existsSync('.env')) process.loadEnvFile('.env');

type Account = { email: string; handle: string };

/** Creates an account through the API and leaves `page` signed out. */
async function createAccount(page: Page, name: string): Promise<Account> {
  const handle = `e2e-${name}-${run}-${Math.random().toString(36).slice(2, 6)}`;
  const email = `${handle}@example.test`;
  const created = await page.request.post('/api/auth/sign-up/email', {
    data: { email, password: PASSWORD, name, handle },
  });
  expect(created.ok()).toBe(true);
  await page.context().clearCookies();
  return { email, handle };
}

async function signInThroughForm(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await page.getByRole('tab', { name: 'Sign in' }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('form button[type="submit"]').click();
}

/** Best-effort teardown: signs in over the API and deletes the account. */
async function removeAccount(page: Page, email: string, passwords: string[]): Promise<void> {
  for (const password of passwords) {
    const res = await page.request.post('/api/auth/sign-in/email', { data: { email, password } });
    if (!res.ok()) continue;
    await page.request.post('/api/auth/delete-user', { data: { password } });
    return;
  }
}

async function latestResetToken(email: string): Promise<string> {
  const sql = postgres(process.env['DATABASE_URL'] ?? '', { max: 1 });
  try {
    const rows = await sql<{ identifier: string }[]>`
      select v.identifier from verifications v
      join users u on u.id = v.value
      where u.email = ${email} and v.identifier like 'reset-password:%'
      order by v.created_at desc limit 1`;
    const row = rows[0];
    if (!row) throw new Error(`no reset token was created for ${email}`);
    return row.identifier.slice('reset-password:'.length);
  } finally {
    await sql.end();
  }
}

test('sign in with an existing account, then sign out', async ({ page }) => {
  const account = await createAccount(page, 'signin');
  try {
    await signInThroughForm(page, account.email, PASSWORD);
    await expect(page).toHaveURL(`/${account.handle}`);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();

    // Signed out, the settings page is no longer reachable.
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);
  } finally {
    await removeAccount(page, account.email, [PASSWORD]);
  }
});

test('a failed sign-in does not reveal whether the account exists', async ({ page }) => {
  const account = await createAccount(page, 'badpw');
  try {
    await signInThroughForm(page, account.email, 'not-the-password');
    const wrongPassword = await page.locator('p.bad').innerText();
    await expect(page).toHaveURL(/\/signin/);

    await signInThroughForm(page, `nobody-${account.handle}@example.test`, 'not-the-password');
    await expect(page.locator('p.bad')).toBeVisible();
    const unknownEmail = await page.locator('p.bad').innerText();

    expect(unknownEmail).toBe(wrongPassword);
  } finally {
    await removeAccount(page, account.email, [PASSWORD]);
  }
});

test('reset a forgotten password and sign in with the new one', async ({ page }) => {
  const account = await createAccount(page, 'reset');
  try {
    await page.goto('/signin');
    await page.getByRole('tab', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.getByLabel('Email', { exact: true }).fill(account.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(`If ${account.email} has an account`)).toBeVisible();

    const token = await latestResetToken(account.email);
    await page.goto(`/reset-password?token=${encodeURIComponent(token)}`);
    await page.getByLabel('New password').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('heading', { name: 'Password changed' })).toBeVisible();

    // The old password is dead; the new one works.
    await signInThroughForm(page, account.email, PASSWORD);
    await expect(page.locator('p.bad')).toBeVisible();
    await signInThroughForm(page, account.email, NEW_PASSWORD);
    await expect(page).toHaveURL(`/${account.handle}`);
  } finally {
    await removeAccount(page, account.email, [NEW_PASSWORD, PASSWORD]);
  }
});

test('a reset link without a valid token is refused', async ({ page }) => {
  await page.goto('/reset-password?error=INVALID_TOKEN');
  await expect(page.getByText('That link is invalid or has expired.')).toBeVisible();
});

test('delete an account from settings', async ({ page }) => {
  const account = await createAccount(page, 'delete');
  try {
    await signInThroughForm(page, account.email, PASSWORD);
    await expect(page).toHaveURL(`/${account.handle}`);

    await page.goto('/settings');
    await page.getByLabel('Password').fill(PASSWORD);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page).toHaveURL('/');

    // Gone: the credentials no longer work.
    const res = await page.request.post('/api/auth/sign-in/email', {
      data: { email: account.email, password: PASSWORD },
    });
    expect(res.ok()).toBe(false);
  } finally {
    await removeAccount(page, account.email, [PASSWORD]);
  }
});
